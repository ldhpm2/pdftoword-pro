import { GoogleGenAI } from "@google/genai";

/**
 * Gemini AI Service Module
 * Xử lý công thức toán học bằng Gemini API
 */

export interface ModelInfo {
    id: string;
    name: string;
    desc: string;
    badge: string;
}

const MODELS: ModelInfo[] = [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Nhanh, tiết kiệm quota', badge: 'Default' },
    { id: 'gemini-2.0-pro-exp-02-05', name: 'Gemini 2.0 Pro', desc: 'Chính xác hơn, tốn quota', badge: 'Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Dự phòng, ổn định', badge: 'Backup' }
];

const STORAGE_KEY_API = 'gemini_api_key';
const STORAGE_KEY_MODEL = 'gemini_model';

export const GeminiService = {
    getApiKey(): string {
        return localStorage.getItem(STORAGE_KEY_API) || (process.env as any).GEMINI_API_KEY || '';
    },

    setApiKey(key: string): void {
        localStorage.setItem(STORAGE_KEY_API, key.trim());
    },

    hasApiKey(): boolean {
        return !!this.getApiKey();
    },

    getSelectedModel(): string {
        return localStorage.getItem(STORAGE_KEY_MODEL) || MODELS[0].id;
    },

    setSelectedModel(modelId: string): void {
        localStorage.setItem(STORAGE_KEY_MODEL, modelId);
    },

    getModelList(): ModelInfo[] {
        return MODELS;
    },

    async validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
        try {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.generateContent({
                model: MODELS[0].id,
                contents: "Say OK",
            });
            if (response.text) {
                return { valid: true };
            }
            return { valid: false, error: 'Không nhận được phản hồi' };
        } catch (error: any) {
            return { valid: false, error: error.message || 'API key không hợp lệ' };
        }
    },

    async processMathFormulas(rawText: string, onProgress?: (pct: number, msg: string) => void): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) throw new Error('API_KEY_MISSING');

        if (onProgress) onProgress(10, 'Đang chuẩn bị dữ liệu gửi tới Gemini AI...');

        const ai = new GoogleGenAI({ apiKey });
        const modelId = this.getSelectedModel();

        const MAX_CHUNK = 15000;
        const chunks = this.splitIntoChunks(rawText, MAX_CHUNK);
        let processedTexts: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
            if (onProgress) {
                const pct = 10 + Math.round(((i + 1) / chunks.length) * 80);
                onProgress(pct, `Gemini AI đang xử lý phần ${i + 1}/${chunks.length}...`);
            }

            const prompt = this.buildMathPrompt(chunks[i]);
            const response = await ai.models.generateContent({
                model: modelId,
                contents: prompt,
                config: {
                    temperature: 0.1,
                    topP: 0.95,
                }
            });
            processedTexts.push(this.cleanGeminiResponse(response.text || ''));
        }

        return processedTexts.join('\n\n');
    },

    buildMathPrompt(text: string): string {
        return `Bạn là chuyên gia xử lý văn bản OCR đề thi Toán Việt Nam. Sửa lỗi chính tả và chuẩn hóa LaTeX cho văn bản OCR sau.

QUY TẮC QUAN TRỌNG:
1. GIỮ NGUYÊN NỘI DUNG: Không được thay đổi thứ tự, không gộp đoạn văn, không tự ý thêm bớt nội dung, KHÔNG được diễn giải lại (paraphrase). Phải gõ lại đúng 100% các câu từ văn bản gốc.
2. GIỮ NGUYÊN CẤU TRÚC: Giữ nguyên định dạng danh sách, bảng biểu và các đáp án A, B, C, D.
3. GIỮ NGUYÊN CÁC KÝ TỰ ĐỊNH DẠNG: Giữ nguyên các dấu ** (bold) và * (italic) nếu có trong văn bản gốc.
3. CHUẨN HÓA TOÁN HỌC: Nhận dạng và chuyển TẤT CẢ công thức toán sang LaTeX chuẩn và LUÔN LUÔN đặt trong cặp dấu $...$:
   - Ví dụ: $y = -4x - 5$, $\\sqrt{x^2 + 1}$, $\\int_{0}^{1} x dx$
   - KHÔNG sử dụng $$...$$, \\[...\\], hay \\(...\\). CHỈ sử dụng duy nhất định dạng $...$ cho mọi công thức.
4. Sửa lỗi chính tả tiếng Việt (giữ nguyên ý nghĩa).
5. Chuẩn hóa ký hiệu LaTeX:
   - Góc: dùng \\widehat{ABC} thay vì ∠ABC
   - Hệ phương trình: dùng \\begin{cases}...\\end{cases}
   - Phân số: dùng \\frac{tử}{mẫu}
   - Căn: dùng \\sqrt{} hoặc \\sqrt[n]{}
   - Tập hợp: dùng \\mathbb{R}, \\mathbb{N}, v.v.
6. Lỗi OCR thường gặp cần sửa:
   - "—", "–" → dấu trừ "$-$"
   - "V" hoặc "v" + số → $\\sqrt{}$
   - "Ñ", ký tự lạ trong ngữ cảnh toán → ký hiệu tập hợp phù hợp
   - "x^" thiếu mũ → bổ sung (thường là $x^2$)
   - "D=" → tập xác định, format: $D = ...$
7. Giữ format Markdown (## heading, **bold**, danh sách)
8. CHỈ trả về text đã sửa. KHÔNG giải thích.
9. GIỮ NGUYÊN 100% các placeholder hình ảnh có dạng [[IMG:số:số]] — KHÔNG xóa, KHÔNG sửa, KHÔNG di chuyển chúng.

VĂN BẢN:
${text}`;
    },

    cleanGeminiResponse(response: string): string {
        let cleaned = response.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
        }
        return cleaned.trim();
    },

    splitIntoChunks(text: string, maxLength: number): string[] {
        if (text.length <= maxLength) return [text];
        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }
            let splitAt = maxLength;
            const searchArea = remaining.substring(Math.max(0, maxLength - 500), maxLength);
            const pageSep = searchArea.lastIndexOf('--- Trang');
            if (pageSep !== -1) {
                splitAt = Math.max(0, maxLength - 500) + pageSep;
            } else {
                const doubleNl = searchArea.lastIndexOf('\n\n');
                if (doubleNl !== -1) {
                    splitAt = Math.max(0, maxLength - 500) + doubleNl;
                } else {
                    const singleNl = searchArea.lastIndexOf('\n');
                    if (singleNl !== -1) {
                        splitAt = Math.max(0, maxLength - 500) + singleNl;
                    }
                }
            }
            chunks.push(remaining.substring(0, splitAt));
            remaining = remaining.substring(splitAt).trimStart();
        }
        return chunks;
    }
};
