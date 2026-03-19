import * as docx from 'docx';
import { saveAs } from 'file-saver';

/**
 * Word Exporter Module
 * Supports real Word Math objects (OXML)
 */

const latexSymbols: { [key: string]: string } = {
    "\\Delta": "Δ", "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε", "\\varepsilon": "ε",
    "\\zeta": "ζ", "\\eta": "η", "\\pi": "π", "\\Pi": "Π", "\\infty": "∞", "\\theta": "θ", "\\Theta": "Θ",
    "\\lambda": "λ", "\\Lambda": "Λ", "\\sigma": "σ", "\\Sigma": "Σ", "\\Omega": "Ω", "\\omega": "ω",
    "\\mu": "μ", "\\phi": "φ", "\\varphi": "φ", "\\Phi": "Φ", "\\psi": "ψ", "\\Psi": "Ψ", "\\rho": "ρ", "\\tau": "τ",
    "\\le": "≤", "\\leq": "≤", "\\ge": "≥", "\\geq": "≥", "\\ne": "≠", "\\neq": "≠",
    "\\approx": "≈", "\\pm": "±", "\\mp": "∓", "\\equiv": "≡",
    "\\times": "×", "\\cdot": "·", "\\div": "÷", "\\ast": "*",
    "\\rightarrow": "→", "\\Rightarrow": "⇒", "\\Leftrightarrow": "⇔", "\\leftrightarrow": "↔",
    "\\in": "∈", "\\subset": "⊂", "\\subseteq": "⊆", "\\cup": "∪", "\\cap": "∩", "\\notin": "∉", "\\emptyset": "∅",
    "\\forall": "∀", "\\exists": "∃", "\\partial": "∂", "\\nabla": "∇",
    "\\perp": "⊥", "\\parallel": "∥", "\\angle": "∠", "\\triangle": "△",
    "\\degrees": "°", "\\circ": "°", "\\deg": "°",
    "\\mathbb{N}": "ℕ", "\\mathbb{Z}": "ℤ", "\\mathbb{Q}": "ℚ", "\\mathbb{R}": "ℝ", "\\mathbb{C}": "ℂ",
    "\\sin": "sin", "\\cos": "cos", "\\tan": "tan", "\\cot": "cot",
    "\\arcsin": "arcsin", "\\arccos": "arccos", "\\arctan": "arctan",
    "\\ln": "ln", "\\log": "log", "\\lim": "lim", "\\min": "min", "\\max": "max", "\\exp": "exp",
    "\\sum": "∑", "\\int": "∫", "\\prod": "∏", "\\coprod": "∐", "\\oint": "∮",
    "\\sqrt": "√",
    "\\to": "→", "\\quad": "  ", "\\qquad": "    ", "\\;": " ", "\\,": " ", "\\!": ""
};

const sortedSymbolKeys = Object.keys(latexSymbols).sort((a, b) => b.length - a.length);

export const WordExporter = {
    extractBracedContent(text: string, startIndex: number) {
        if (text[startIndex] !== '{') return null;
        let depth = 0;
        for (let i = startIndex; i < text.length; i++) {
            if (text[i] === '{') depth++;
            if (text[i] === '}') depth--;
            if (depth === 0) {
                return { content: text.substring(startIndex + 1, i), newIndex: i + 1 };
            }
        }
        return null;
    },

    parseLatexRecursive(latex: string): any[] {
        const nodes: any[] = [];
        let i = 0;
        let textBuffer = "";

        const flushBuffer = () => {
            if (textBuffer) {
                let processed = textBuffer;
                sortedSymbolKeys.forEach(key => {
                    if (processed.includes(key)) {
                        processed = processed.split(key).join(latexSymbols[key]);
                    }
                });
                processed = processed.replace(/\\/g, "");
                if (processed.length > 0) {
                    nodes.push(new docx.MathRun(processed));
                }
                textBuffer = "";
            }
        };

        while (i < latex.length) {
            const char = latex[i];

            if (char === '\\') {
                flushBuffer();
                const remainder = latex.substring(i);

                if (remainder.startsWith("\\widehat")) {
                    let argStart = i + 8;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(new docx.MathRun("∠"));
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        i = arg.newIndex;
                        continue;
                    }
                }

                if (remainder.startsWith("\\begin{cases}")) {
                    const endTag = "\\end{cases}";
                    const endIdx = latex.indexOf(endTag, i);
                    if (endIdx !== -1) {
                        const innerContent = latex.substring(i + 13, endIdx);
                        const casesLines = innerContent.split(/\\\\|\\/).map(l => l.trim()).filter(l => l !== "");
                        nodes.push(new docx.MathRun("{ "));
                        casesLines.forEach((line, idx) => {
                            nodes.push(...this.parseLatexRecursive(line));
                            if (idx < casesLines.length - 1) {
                                nodes.push(new docx.MathRun(" ; "));
                            }
                        });
                        i = endIdx + 11;
                        continue;
                    }
                }

                if (remainder.startsWith("\\frac") || remainder.startsWith("\\dfrac")) {
                    const cmdLen = remainder.startsWith("\\dfrac") ? 6 : 5;
                    let startArg = i + cmdLen;
                    while (latex[startArg] === ' ') startArg++;
                    const firstArg = this.extractBracedContent(latex, startArg);
                    if (firstArg) {
                        let secondArgStart = firstArg.newIndex;
                        while (latex[secondArgStart] === ' ') secondArgStart++;
                        const secondArg = this.extractBracedContent(latex, secondArgStart);
                        if (secondArg) {
                            nodes.push(new docx.MathFraction({
                                numerator: this.parseLatexRecursive(firstArg.content),
                                denominator: this.parseLatexRecursive(secondArg.content)
                            }));
                            i = secondArg.newIndex;
                            continue;
                        }
                    }
                }

                if (remainder.startsWith("\\sqrt")) {
                    let degree: any[] = [];
                    let contentStart = i + 5;
                    if (latex[contentStart] === '[') {
                        const closeBracket = latex.indexOf(']', contentStart);
                        if (closeBracket > -1) {
                            degree = this.parseLatexRecursive(latex.substring(contentStart + 1, closeBracket));
                            contentStart = closeBracket + 1;
                        }
                    }
                    const arg = this.extractBracedContent(latex, contentStart);
                    if (arg) {
                        nodes.push(new docx.MathRadical({
                            degree: degree.length > 0 ? degree : undefined,
                            children: this.parseLatexRecursive(arg.content)
                        }));
                        i = arg.newIndex;
                        continue;
                    }
                }

                if (remainder.startsWith("\\left")) { i += 5; continue; }
                if (remainder.startsWith("\\right")) { i += 6; continue; }
                if (remainder.startsWith("\\text")) {
                    let argStart = i + 5;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(new docx.MathRun(arg.content));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\vec")) {
                    let argStart = i + 4;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("⃗"));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\hat")) {
                    let argStart = i + 4;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("̂"));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\bar")) {
                    let argStart = i + 4;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("̄"));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\dot")) {
                    let argStart = i + 4;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("̇"));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\ddot")) {
                    let argStart = i + 5;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("̈"));
                        i = arg.newIndex;
                        continue;
                    }
                }
                if (remainder.startsWith("\\overline")) {
                    let argStart = i + 9;
                    while (latex[argStart] === ' ') argStart++;
                    const arg = this.extractBracedContent(latex, argStart);
                    if (arg) {
                        nodes.push(...this.parseLatexRecursive(arg.content));
                        nodes.push(new docx.MathRun("̅"));
                        i = arg.newIndex;
                        continue;
                    }
                }

                textBuffer += char;
                i++;
            } else if (char === '^' || char === '_') {
                flushBuffer();
                const lastNode = nodes.pop();
                let scriptContent: any[] = [];
                let newIdx = i + 1;
                if (newIdx < latex.length) {
                    if (latex[newIdx] === '{') {
                        const extracted = this.extractBracedContent(latex, newIdx);
                        if (extracted) {
                            scriptContent = this.parseLatexRecursive(extracted.content);
                            newIdx = extracted.newIndex;
                        }
                    } else if (latex[newIdx] === '\\') {
                        const commandMatch = latex.substring(newIdx).match(/^(\\[a-zA-Z]+)/);
                        if (commandMatch) {
                            scriptContent = this.parseLatexRecursive(commandMatch[1]);
                            newIdx += commandMatch[1].length;
                        } else {
                            scriptContent = [new docx.MathRun("\\")];
                            newIdx++;
                        }
                    } else {
                        scriptContent = [new docx.MathRun(latex[newIdx])];
                        newIdx++;
                    }
                }
                const base = lastNode ? [lastNode] : [new docx.MathRun("")];
                if (char === '^') {
                    nodes.push(new docx.MathSuperScript({ children: base, superScript: scriptContent }));
                } else {
                    nodes.push(new docx.MathSubScript({ children: base, subScript: scriptContent }));
                }
                i = newIdx;
            } else {
                textBuffer += char;
                i++;
            }
        }
        flushBuffer();
        return nodes;
    },

    parseMathInText(text: string): any[] {
        // Support $...$, $$...$$, \(...\), \[...\]
        const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^$]*?\$|\\\[[\s\S]*?\\\]|\\\(.*?\\\))/g;
        const mathParts = text.split(mathRegex);
        const result: any[] = [];

        mathParts.forEach(part => {
            if (!part) return;

            const trimmed = part.trim();
            // Check for various LaTeX delimiters
            const isMath = /^\$\$[\s\S]*?\$\$|^\$[^$]*?\$|^\\\[[\s\S]*?\\\]|^\\\(.*?\\\)$/.test(trimmed);

            if (isMath) {
                // Giữ nguyên định dạng $...$ như yêu cầu của người dùng
                result.push(new docx.TextRun({ 
                    text: part,
                    // Có thể thêm font khác hoặc màu sắc nếu muốn phân biệt, 
                    // nhưng ở đây ta giữ nguyên font mặc định của tài liệu
                }));
            } else {
                // Handle bold and italic markdown in non-math text
                const segments = part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
                segments.forEach(seg => {
                    if (seg.startsWith('**') && seg.endsWith('**')) {
                        result.push(new docx.TextRun({ text: seg.slice(2, -2), bold: true }));
                    } else if (seg.startsWith('*') && seg.endsWith('*')) {
                        result.push(new docx.TextRun({ text: seg.slice(1, -1), italics: true }));
                    } else if (seg) {
                        result.push(new docx.TextRun({ text: seg }));
                    }
                });
            }
        });
        return result;
    },

    parseMarkdownTable(tableLines: string[]): any {
        if (tableLines.length < 2) return null;
        const dataLines = tableLines.filter(line =>
            !/^\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)*\|?$/.test(line.trim())
        );

        const tableRows = dataLines.map(line => {
            const cells = line.split('|')
                .filter((_, idx, arr) =>
                    (idx > 0 && idx < arr.length - 1) ||
                    (idx === 0 && !line.startsWith('|')) ||
                    (idx === arr.length - 1 && !line.endsWith('|'))
                )
                .map(c => c.trim());

            if (cells.length === 0) return null;

            return new docx.TableRow({
                children: cells.map(cellText => new docx.TableCell({
                    children: [new docx.Paragraph({ children: this.parseMathInText(cellText) })],
                    width: { size: Math.floor(100 / cells.length), type: docx.WidthType.PERCENTAGE },
                    verticalAlign: docx.VerticalAlign.CENTER
                }))
            });
        }).filter(row => row !== null);

        if (tableRows.length === 0) return null;

        return new docx.Table({
            rows: tableRows as docx.TableRow[],
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            borders: {
                top: { style: docx.BorderStyle.SINGLE, size: 1 },
                bottom: { style: docx.BorderStyle.SINGLE, size: 1 },
                left: { style: docx.BorderStyle.SINGLE, size: 1 },
                right: { style: docx.BorderStyle.SINGLE, size: 1 },
                insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 1 },
                insideVertical: { style: docx.BorderStyle.SINGLE, size: 1 },
            }
        });
    },

    splitOptions(text: string): string[] {
        // Regex to find patterns like A. B. C. D. or A) B) C) D)
        // We look for B. C. D. preceded by space to split them onto new lines
        // We don't necessarily split A. if it's at the start of the line, 
        // but we split if B. C. or D. appear later.
        const parts = text.split(/(?=\s+[B-D][\.\)])/g);
        if (parts.length <= 1) return [text];
        
        return parts.map((p, idx) => {
            let trimmed = p.trim();
            // If it's the first part and contains A., we might want to split A. too if it's not at the start
            if (idx === 0 && trimmed.includes(' A.')) {
                const subParts = trimmed.split(/(?=\s+A[\.\)])/g);
                return subParts.map(sp => sp.trim());
            }
            return trimmed;
        }).flat() as string[];
    },

    async exportToWord(content: string, fileName = 'converted', options: any = {}) {
        const { fontSize = 24, fontName = 'Times New Roman' } = options;
        const children: any[] = [];

        children.push(
            new docx.Paragraph({
                text: "TÀI LIỆU CHUYỂN ĐỔI TỪ PDF",
                heading: docx.HeadingLevel.HEADING_1,
                alignment: docx.AlignmentType.CENTER,
                spacing: { after: 200 }
            }),
            new docx.Paragraph({
                text: `Ngày tạo: ${new Date().toLocaleDateString("vi-VN")}`,
                alignment: docx.AlignmentType.CENTER,
                spacing: { after: 400 }
            })
        );

        const lines = content.split('\n');
        let tableBuffer: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('|')) {
                tableBuffer.push(lines[i]);
                continue;
            } else if (tableBuffer.length > 0) {
                const table = this.parseMarkdownTable(tableBuffer);
                if (table) children.push(table);
                tableBuffer = [];
            }

            if (line) {
                const subLines = this.splitOptions(lines[i]);
                subLines.forEach(subLine => {
                    if (subLine.startsWith('### ')) {
                        children.push(new docx.Paragraph({
                            text: subLine.replace('### ', ''),
                            heading: docx.HeadingLevel.HEADING_3,
                            spacing: { before: 200, after: 100 }
                        }));
                    } else if (subLine.startsWith('## ')) {
                        children.push(new docx.Paragraph({
                            text: subLine.replace('## ', ''),
                            heading: docx.HeadingLevel.HEADING_2,
                            spacing: { before: 240, after: 120 }
                        }));
                    } else if (subLine.startsWith('# ')) {
                        children.push(new docx.Paragraph({
                            text: subLine.replace('# ', ''),
                            heading: docx.HeadingLevel.HEADING_1,
                            spacing: { before: 300, after: 150 }
                        }));
                    } else {
                        children.push(new docx.Paragraph({
                            children: this.parseMathInText(subLine),
                            spacing: { after: 60, line: 240 },
                            alignment: docx.AlignmentType.LEFT
                        }));
                    }
                });
            } else {
                children.push(new docx.Paragraph({ text: "" }));
            }
        }

        if (tableBuffer.length > 0) {
            const table = this.parseMarkdownTable(tableBuffer);
            if (table) children.push(table);
        }

        const doc = new docx.Document({
            sections: [{
                properties: {},
                children: children
            }],
            styles: {
                default: {
                    document: {
                        run: {
                            font: fontName,
                            size: fontSize
                        }
                    }
                }
            }
        });

        const blob = await docx.Packer.toBlob(doc);
        saveAs(blob, `${fileName}.docx`);

        return { success: true, fileName: `${fileName}.docx` };
    },

    async exportToWordWithImages(content: string, images: any[] = [], fileName = 'converted', options: any = {}) {
        const { fontSize = 24, fontName = 'Times New Roman' } = options;
        const imgMap: { [key: string]: any } = {};
        for (const img of images) imgMap[img.placeholder] = img;

        const children: any[] = [];

        children.push(
            new docx.Paragraph({
                text: "TÀI LIỆU CHUYỂN ĐỔI TỪ PDF",
                heading: docx.HeadingLevel.HEADING_1,
                alignment: docx.AlignmentType.CENTER,
                spacing: { after: 200 }
            }),
            new docx.Paragraph({
                text: `Ngày tạo: ${new Date().toLocaleDateString("vi-VN")}`,
                alignment: docx.AlignmentType.CENTER,
                spacing: { after: 400 }
            })
        );

        const lines = content.split('\n');
        let tableBuffer: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const line = raw.trim();

            if (!line.startsWith('|') && tableBuffer.length > 0) {
                const tbl = this.parseMarkdownTable(tableBuffer);
                if (tbl) children.push(tbl);
                tableBuffer = [];
            }

            if (line.startsWith('|')) { tableBuffer.push(raw); continue; }

            const imgMatch = line.match(/\[\[IMG:(\d+):(\d+)\]\]/);
            if (imgMatch) {
                const placeholder = imgMatch[0];
                const img = imgMap[placeholder];
                if (img && img.data && img.data.byteLength > 0) {
                    try {
                        children.push(
                            new docx.Paragraph({
                                children: [
                                    new docx.ImageRun({
                                        data: img.data,
                                        transformation: {
                                            width: img.width,
                                            height: img.height
                                        },
                                        type: 'png'
                                    })
                                ],
                                alignment: docx.AlignmentType.CENTER,
                                spacing: { before: 200, after: 200 }
                            })
                        );
                    } catch (e) {
                        children.push(new docx.Paragraph({
                            children: [new docx.TextRun({
                                text: `[Hình ảnh không thể nhúng: ${placeholder}]`,
                                italics: true, color: 'AA0000'
                            })]
                        }));
                    }
                }
                continue;
            }

            if (line.startsWith('### ')) {
                children.push(new docx.Paragraph({
                    text: line.slice(4),
                    heading: docx.HeadingLevel.HEADING_3,
                    spacing: { before: 200, after: 100 }
                }));
            } else if (line.startsWith('## ')) {
                children.push(new docx.Paragraph({
                    text: line.slice(3),
                    heading: docx.HeadingLevel.HEADING_2,
                    spacing: { before: 240, after: 120 }
                }));
            } else if (line.startsWith('# ')) {
                children.push(new docx.Paragraph({
                    text: line.slice(2),
                    heading: docx.HeadingLevel.HEADING_1,
                    spacing: { before: 300, after: 150 }
                }));
            } else if (/^---\s*Trang\s*\d+/i.test(line) || line === '---' || line === '====') {
                children.push(new docx.Paragraph({ children: [], pageBreakBefore: true }));
            } else if (line) {
                const subLines = this.splitOptions(raw);
                subLines.forEach(subLine => {
                    children.push(new docx.Paragraph({
                        children: this.parseMathInText(subLine),
                        spacing: { after: 60, line: 240 },
                        alignment: docx.AlignmentType.LEFT
                    }));
                });
            } else {
                children.push(new docx.Paragraph({ text: '' }));
            }
        }

        if (tableBuffer.length > 0) {
            const tbl = this.parseMarkdownTable(tableBuffer);
            if (tbl) children.push(tbl);
        }

        const doc = new docx.Document({
            sections: [{ properties: {}, children }],
            styles: {
                default: {
                    document: { run: { font: fontName, size: fontSize } }
                }
            }
        });

        const blob = await docx.Packer.toBlob(doc);
        saveAs(blob, `${fileName}.docx`);
        return { success: true, fileName: `${fileName}.docx` };
    },

    downloadAsTxt(text: string, fileName = 'converted') {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        saveAs(blob, `${fileName}.txt`);
    },

    async copyToClipboard(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        }
    }
};
