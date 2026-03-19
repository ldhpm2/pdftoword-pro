import * as pdfjsLib from 'pdfjs-dist';
import * as Tesseract from 'tesseract.js';

/**
 * PDF Processor Module
 * Trích xuất text từ PDF dùng PDF.js
 * OCR cho PDF ảnh dùng Tesseract.js
 */

export interface ProcessResult {
    text: string;
    pageCount: number;
    pages: any[];
    hasText: boolean;
    method: string;
    confidence?: number;
    processingTime?: number;
    fileName?: string;
    fileSize?: number;
    success?: boolean;
    error?: string;
}

export const PdfProcessor = {
    pdfjsInitialized: false,

    initPdfJs() {
        if (!this.pdfjsInitialized) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
            this.pdfjsInitialized = true;
        }
    },

    async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Không thể đọc file'));
            reader.readAsArrayBuffer(file);
        });
    },

    async renderPageToCanvas(page: any, scale = 2.0) {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        return { canvas, viewport, ctx };
    },

    getTextBoxes(textContent: any, viewport: any) {
        const boxes: any[] = [];
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const x = tx[4];
            const y = tx[5] - Math.abs(item.height * viewport.scale);
            const w = Math.abs(item.width * viewport.scale);
            const h = Math.abs(item.height * viewport.scale) + 4;
            if (w > 0 && h > 0) {
                boxes.push({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 });
            }
        }
        return boxes;
    },

    isWhitePixel(r: number, g: number, b: number, threshold = 245) {
        return r >= threshold && g >= threshold && b >= threshold;
    },

    isCoveredByText(cx: number, cy: number, cw: number, ch: number, textBoxes: any[]) {
        for (const box of textBoxes) {
            if (cx < box.x + box.w && cx + cw > box.x &&
                cy < box.y + box.h && cy + ch > box.y) {
                return true;
            }
        }
        return false;
    },

    detectImageRegions(canvas: HTMLCanvasElement, textBoxes: any[], options: any = {}) {
        const {
            gridSize = 6,
            minWidthPx = 60,
            minHeightPx = 40,
            minAreaRatio = 0.008,
            paddingPx = 10,
            whiteThreshold = 240
        } = options;

        const W = canvas.width;
        const H = canvas.height;
        const minArea = W * H * minAreaRatio;

        const ctx = canvas.getContext('2d')!;
        const imageData = ctx.getImageData(0, 0, W, H);
        const pixels = imageData.data;

        const cols = Math.ceil(W / gridSize);
        const rows = Math.ceil(H / gridSize);

        const contentMask = new Uint8Array(cols * rows);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellX = c * gridSize;
                const cellY = r * gridSize;
                const cellW = Math.min(gridSize, W - cellX);
                const cellH = Math.min(gridSize, H - cellY);

                if (this.isCoveredByText(cellX, cellY, cellW, cellH, textBoxes)) continue;

                let nonWhiteCount = 0;
                const sampleStep = Math.max(1, Math.floor(gridSize / 3));
                for (let dy = 0; dy < cellH; dy += sampleStep) {
                    for (let dx = 0; dx < cellW; dx += sampleStep) {
                        const px = cellX + dx;
                        const py = cellY + dy;
                        if (px >= W || py >= H) continue;
                        const idx = (py * W + px) * 4;
                        const R = pixels[idx], G = pixels[idx + 1], B = pixels[idx + 2], A = pixels[idx + 3];
                        if (A < 10) continue;
                        if (!this.isWhitePixel(R, G, B, whiteThreshold)) {
                            nonWhiteCount++;
                        }
                    }
                }

                const totalSamples = Math.ceil(cellH / sampleStep) * Math.ceil(cellW / sampleStep);
                if (nonWhiteCount / totalSamples >= 0.2) {
                    contentMask[r * cols + c] = 1;
                }
            }
        }

        const visited = new Uint8Array(cols * rows);
        const regions: any[] = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!contentMask[r * cols + c] || visited[r * cols + c]) continue;

                const queue: [number, number][] = [[r, c]];
                visited[r * cols + c] = 1;
                let minR = r, maxR = r, minC = c, maxC = c;
                let cellCount = 0;

                while (queue.length > 0) {
                    const [cr, cc] = queue.shift()!;
                    cellCount++;
                    if (cr < minR) minR = cr;
                    if (cr > maxR) maxR = cr;
                    if (cc < minC) minC = cc;
                    if (cc > maxC) maxC = cc;

                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            const nr = cr + dr, nc = cc + dc;
                            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
                                && contentMask[nr * cols + nc]
                                && !visited[nr * cols + nc]) {
                                visited[nr * cols + nc] = 1;
                                queue.push([nr, nc]);
                            }
                        }
                    }
                }

                const rx = Math.max(0, minC * gridSize - paddingPx);
                const ry = Math.max(0, minR * gridSize - paddingPx);
                const rw = Math.min(W - rx, (maxC - minC + 1) * gridSize + paddingPx * 2);
                const rh = Math.min(H - ry, (maxR - minR + 1) * gridSize + paddingPx * 2);
                const area = cellCount * gridSize * gridSize;

                if (area >= minArea && rw >= minWidthPx && rh >= minHeightPx) {
                    regions.push({ x: rx, y: ry, width: rw, height: rh });
                }
            }
        }

        return this.mergeOverlappingRegions(regions, paddingPx * 2);
    },

    mergeOverlappingRegions(regions: any[], gap = 20) {
        if (regions.length === 0) return [];

        let merged = [...regions];
        let changed = true;

        while (changed) {
            changed = false;
            const result: any[] = [];
            const used = new Array(merged.length).fill(false);

            for (let i = 0; i < merged.length; i++) {
                if (used[i]) continue;
                let a = merged[i];

                for (let j = i + 1; j < merged.length; j++) {
                    if (used[j]) continue;
                    const b = merged[j];

                    const overlapX = a.x < b.x + b.width + gap && a.x + a.width + gap > b.x;
                    const overlapY = a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

                    if (overlapX && overlapY) {
                        const nx = Math.min(a.x, b.x);
                        const ny = Math.min(a.y, b.y);
                        const nw = Math.max(a.x + a.width, b.x + b.width) - nx;
                        const nh = Math.max(a.y + a.height, b.y + b.height) - ny;
                        a = { x: nx, y: ny, width: nw, height: nh };
                        used[j] = true;
                        changed = true;
                    }
                }

                result.push(a);
            }
            merged = result;
        }

        return merged;
    },

    async cropCanvasRegion(canvas: HTMLCanvasElement, { x, y, width, height }: any): Promise<Blob | null> {
        return new Promise((resolve) => {
            const offscreen = document.createElement('canvas');
            offscreen.width = Math.max(1, width);
            offscreen.height = Math.max(1, height);
            const ctx = offscreen.getContext('2d')!;
            ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
            offscreen.toBlob(blob => resolve(blob), 'image/png', 0.95);
        });
    },

    async blobToUint8Array(blob: Blob): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(new Uint8Array(e.target!.result as ArrayBuffer));
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    },

    async extractImages(file: File, onProgress?: (pct: number, msg: string) => void): Promise<any[]> {
        this.initPdfJs();
        const SCALE = 2.5;

        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageCount = pdf.numPages;
        const allImages: any[] = [];
        let globalId = 0;

        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            if (onProgress) onProgress(
                Math.round((pageNum / pageCount) * 100),
                `Phân tích hình ảnh trang ${pageNum}/${pageCount}...`
            );

            try {
                const page = await pdf.getPage(pageNum);
                const { canvas, viewport } = await this.renderPageToCanvas(page, SCALE);
                const textContent = await page.getTextContent();
                const textBoxes = this.getTextBoxes(textContent, viewport);
                const regions = this.detectImageRegions(canvas, textBoxes);

                for (const region of regions) {
                    const blob = await this.cropCanvasRegion(canvas, region);
                    if (!blob || blob.size < 800) continue;

                    const uint8 = await this.blobToUint8Array(blob);
                    globalId++;

                    const wPx = Math.min(Math.round(region.width / SCALE), 500);
                    const hPx = Math.min(Math.round(region.height / SCALE), 650);

                    allImages.push({
                        pageNum,
                        id: globalId,
                        placeholder: `[[IMG:${pageNum}:${globalId}]]`,
                        data: uint8,
                        width: wPx,
                        height: hPx,
                        relY: region.y / canvas.height
                    });
                }
            } catch (e) {
                console.warn(`Trang ${pageNum} lỗi:`, e);
            }
        }

        return allImages;
    },

    async extractText(file: File, onProgress?: (pct: number) => void): Promise<any> {
        this.initPdfJs();

        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageCount = pdf.numPages;
        const pages: any[] = [];
        let fullText = '';
        let hasText = false;

        for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });
            const pageHeight = viewport.height;

            let pageText = '';
            let lastY: number | null = null;
            const lineYPositions: number[] = [];
            let currentLineY: number | null = null;

            for (const item of textContent.items as any[]) {
                if (item.str === undefined) continue;

                const transform = item.transform;
                const x = transform ? transform[4] : 0;
                const y = transform ? transform[5] : null;
                const fontSize = transform ? Math.abs(transform[0]) : 12;
                const fontName = item.fontName || '';
                const isBold = fontName.toLowerCase().includes('bold');
                const isItalic = fontName.toLowerCase().includes('italic');

                let str = item.str;
                if (isBold && isItalic) str = `***${str}***`;
                else if (isBold) str = `**${str}**`;
                else if (isItalic) str = `*${str}*`;

                if (lastY !== null && y !== null && Math.abs(lastY - y) > 5) {
                    pageText += '\n';
                    if (currentLineY !== null) {
                        lineYPositions.push(1 - (currentLineY / pageHeight));
                    }
                    currentLineY = y;
                } else if (lastY !== null && pageText.length > 0 && !pageText.endsWith('\n')) {
                    if (item.str.trim()) {
                        // Check for large horizontal gap
                        const lastItem = (textContent.items as any[])[(textContent.items as any[]).indexOf(item) - 1];
                        const lastX = lastItem?.transform ? lastItem.transform[4] + (lastItem.width || 0) : x;
                        if (x - lastX > 20) {
                            pageText += '    '; // Add some spaces for horizontal gap
                        } else {
                            pageText += ' ';
                        }
                    }
                }

                if (currentLineY === null && y !== null) {
                    currentLineY = y;
                }

                pageText += str;
                lastY = y;

                if (item.str.trim()) {
                    hasText = true;
                }
            }

            if (currentLineY !== null) {
                lineYPositions.push(1 - (currentLineY / pageHeight));
            }

            pages.push({
                pageNumber: i,
                text: pageText.trim(),
                lineYPositions
            });

            fullText += (i > 1 ? '\n\n--- Trang ' + i + ' ---\n\n' : '') + pageText.trim();

            if (onProgress) {
                onProgress(Math.round((i / pageCount) * 100));
            }
        }

        return {
            text: fullText,
            pageCount,
            pages,
            hasText,
            method: 'pdf.js'
        };
    },

    async ocrProcess(file: File, language = 'vie+eng', onProgress?: (pct: number, msg: string) => void): Promise<any> {
        this.initPdfJs();

        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageCount = pdf.numPages;
        const pages: any[] = [];
        let fullText = '';
        let totalConfidence = 0;

        if (onProgress) onProgress(5, 'Khởi tạo OCR engine...');

        const worker = await Tesseract.createWorker(language);

        for (let i = 1; i <= pageCount; i++) {
            if (onProgress) {
                const pct = Math.round(10 + (i / pageCount) * 85);
                onProgress(pct, `OCR đang xử lý trang ${i}/${pageCount}...`);
            }

            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvasContext: ctx, viewport }).promise;

            const { data } = await worker.recognize(canvas);

            pages.push({
                pageNumber: i,
                text: data.text.trim(),
                confidence: data.confidence
            });

            fullText += (i > 1 ? '\n\n--- Trang ' + i + ' ---\n\n' : '') + data.text.trim();
            totalConfidence += data.confidence;
        }

        await worker.terminate();

        if (onProgress) onProgress(100, 'Hoàn tất OCR!');

        return {
            text: fullText,
            pageCount,
            pages,
            hasText: fullText.trim().length > 0,
            confidence: Math.round(totalConfidence / pageCount),
            method: 'tesseract.js'
        };
    },

    async autoProcess(file: File, options: any = {}, onProgress?: (pct: number, msg: string) => void): Promise<ProcessResult> {
        const startTime = Date.now();

        if (options.forceOcr) {
            if (onProgress) onProgress(5, 'Bắt đầu OCR...');
            const result = await this.ocrProcess(file, options.language || 'vie+eng', onProgress);
            result.processingTime = Date.now() - startTime;
            return result;
        }

        if (onProgress) onProgress(10, 'Đang trích xuất text...');
        const textResult = await this.extractText(file, (pct) => {
            if (onProgress) onProgress(10 + Math.round(pct * 0.4), 'Đang trích xuất text...');
        });

        const textLength = textResult.text.replace(/\s/g, '').length;
        const hasEnoughText = textLength > (textResult.pageCount * 20);

        if (hasEnoughText) {
            textResult.processingTime = Date.now() - startTime;
            textResult.confidence = 99;
            if (onProgress) onProgress(100, 'Trích xuất hoàn tất!');
            return textResult;
        }

        if (onProgress) onProgress(50, 'PDF dạng ảnh, chuyển sang OCR...');
        const ocrResult = await this.ocrProcess(file, options.language || 'vie+eng', (pct, msg) => {
            if (onProgress) onProgress(50 + Math.round(pct * 0.5), msg);
        });

        ocrResult.processingTime = Date.now() - startTime;
        return ocrResult;
    },

    async processBatch(files: File[], options: any = {}, onProgress?: (fi: number, total: number, pct: number, msg: string) => void): Promise<ProcessResult[]> {
        const results: ProcessResult[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            try {
                const result = await this.autoProcess(file, options, (pct, msg) => {
                    if (onProgress) {
                        onProgress(i, files.length, pct, `[${i + 1}/${files.length}] ${file.name}: ${msg || ''}`);
                    }
                });

                result.fileName = file.name;
                result.fileSize = file.size;
                result.success = true;
                results.push(result);
            } catch (error: any) {
                results.push({
                    fileName: file.name,
                    fileSize: file.size,
                    success: false,
                    error: error.message,
                    text: '',
                    pageCount: 0,
                    pages: [],
                    hasText: false,
                    method: 'error'
                });
            }
        }

        return results;
    },

    formatFileSize(bytes: number) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
};
