import React, { useState, useEffect, useRef } from 'react';
import { GeminiService, ModelInfo } from '../services/geminiService';
import { PdfProcessor, ProcessResult } from '../services/pdfProcessor';
import { WordExporter } from '../services/wordExporter';

declare global {
    interface Window {
        renderMathInElement: any;
    }
}

export default function App() {
    // State
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ percent: 0, status: '' });
    const [results, setResults] = useState<ProcessResult | ProcessResult[] | null>(null);
    const [rawText, setRawText] = useState('');
    const [processedText, setProcessedText] = useState('');
    const [extractedImages, setExtractedImages] = useState<any[]>([]);
    const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
    const [showApiKeyModal, setShowApiKeyModal] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [validationStatus, setValidationStatus] = useState<{ type: 'loading' | 'success' | 'error' | '', msg: string }>({ type: '', msg: '' });
    const [selectedModel, setSelectedModel] = useState(GeminiService.getSelectedModel());
    const [language, setLanguage] = useState('vie+eng');
    const [forceOcr, setForceOcr] = useState(false);
    const [useAiMath, setUseAiMath] = useState(true);
    const [keepImages, setKeepImages] = useState(true);
    const [batchMode, setBatchMode] = useState(false);
    const [toasts, setToasts] = useState<{ id: number, msg: string, type: string }[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const renderedResultsRef = useRef<HTMLDivElement>(null);

    // Effects
    useEffect(() => {
        const key = GeminiService.getApiKey();
        if (key) {
            setApiKeyInput(key);
            setShowApiKeyModal(false);
        } else {
            setShowApiKeyModal(true);
        }
    }, []);

    useEffect(() => {
        if (viewMode === 'rendered' && (processedText || rawText) && renderedResultsRef.current) {
            renderLatex(processedText || rawText);
        }
    }, [viewMode, processedText, rawText]);

    // Helpers
    const showToast = (msg: string, type: string = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3500);
    };

    const renderLatex = (text: string) => {
        if (!renderedResultsRef.current) return;
        const lines = text.split('\n');
        let html = '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                html += '<br>';
            } else {
                const escaped = trimmed
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                html += `<p>${escaped}</p>`;
            }
        }
        renderedResultsRef.current.innerHTML = html;

        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(renderedResultsRef.current, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false },
                        { left: '\\[', right: '\\]', display: true },
                        { left: '\\(', right: '\\)', display: false }
                    ],
                    throwOnError: false,
                    errorColor: '#dc2626'
                });
            } catch (err) {
                console.warn('KaTeX rendering error:', err);
            }
        }
    };

    const injectImagePlaceholders = (text: string, images: any[], pages: any[]) => {
        if (!images || images.length === 0) return text;

        const byPage: { [key: number]: any[] } = {};
        for (const img of images) {
            if (!byPage[img.pageNum]) byPage[img.pageNum] = [];
            byPage[img.pageNum].push(img);
        }

        const pageYMap: { [key: number]: number[] } = {};
        if (pages) {
            for (const p of pages) {
                pageYMap[p.pageNumber] = p.lineYPositions || [];
            }
        }

        const pageTexts = text.split(/(\n\n---\s*Trang\s*\d+\s*---\n\n)/i);
        let result = '';
        let currentPage = 1;

        for (let i = 0; i < pageTexts.length; i++) {
            const chunk = pageTexts[i];
            const sepMatch = chunk.match(/---\s*Trang\s*(\d+)\s*---/i);

            if (sepMatch) {
                currentPage = parseInt(sepMatch[1]);
                result += chunk;
            } else {
                const imgs = byPage[currentPage];
                if (imgs && imgs.length > 0) {
                    const lines = chunk.split('\n');
                    const nonEmptyIndices: number[] = [];
                    for (let k = 0; k < lines.length; k++) {
                        if (lines[k].trim()) nonEmptyIndices.push(k);
                    }

                    const lineYPos = pageYMap[currentPage] || [];
                    const sorted = [...imgs].sort((a, b) => a.relY - b.relY);
                    const insertions: { [key: number]: string[] } = {};

                    for (const img of sorted) {
                        let bestLineIdx = lines.length;

                        if (lineYPos.length > 0 && nonEmptyIndices.length > 0) {
                            let insertAfterK = -1;
                            const len = Math.min(lineYPos.length, nonEmptyIndices.length);
                            for (let k = 0; k < len; k++) {
                                if (lineYPos[k] <= img.relY + 0.01) {
                                    insertAfterK = k;
                                }
                            }

                            if (insertAfterK >= 0) {
                                bestLineIdx = nonEmptyIndices[insertAfterK] + 1;
                            } else {
                                bestLineIdx = 0;
                            }
                        } else {
                            const totalNonEmpty = nonEmptyIndices.length || 1;
                            let targetIdx = Math.round(img.relY * totalNonEmpty);
                            targetIdx = Math.min(targetIdx, totalNonEmpty);
                            bestLineIdx = targetIdx < nonEmptyIndices.length
                                ? nonEmptyIndices[targetIdx]
                                : lines.length;
                        }

                        if (!insertions[bestLineIdx]) insertions[bestLineIdx] = [];
                        insertions[bestLineIdx].push(img.placeholder);
                    }

                    const newLines: string[] = [];
                    for (let k = 0; k <= lines.length; k++) {
                        if (insertions[k]) {
                            newLines.push(...insertions[k]);
                        }
                        if (k < lines.length) newLines.push(lines[k]);
                    }
                    result += newLines.join('\n');
                } else {
                    result += chunk;
                }
            }
        }

        return result;
    };

    // Handlers
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isProcessing || !e.target.files) return;
        const files = Array.from(e.target.files as FileList).filter(f => f.type === 'application/pdf');
        if (files.length === 0) {
            showToast('Vui lòng chọn file PDF!', 'error');
            return;
        }
        if (batchMode) {
            setSelectedFiles(prev => [...prev, ...files]);
        } else {
            setSelectedFiles([files[0]]);
        }
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (isProcessing) return;
        const files = Array.from(e.dataTransfer.files as FileList).filter(f => f.type === 'application/pdf');
        if (files.length === 0) {
            showToast('Vui lòng chọn file PDF!', 'error');
            return;
        }
        if (batchMode) {
            setSelectedFiles(prev => [...prev, ...files]);
        } else {
            setSelectedFiles([files[0]]);
        }
    };

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSaveApiKey = async () => {
        const key = apiKeyInput.trim();
        if (!key) {
            setValidationStatus({ type: 'error', msg: 'Vui lòng nhập API key!' });
            return;
        }

        setValidationStatus({ type: 'loading', msg: 'Đang kiểm tra key...' });
        const result = await GeminiService.validateApiKey(key);

        if (result.valid) {
            GeminiService.setApiKey(key);
            setValidationStatus({ type: 'success', msg: '✅ API key hợp lệ!' });
            setTimeout(() => {
                setShowApiKeyModal(false);
                showToast('API key đã được lưu!', 'success');
            }, 800);
        } else {
            setValidationStatus({ type: 'error', msg: '❌ ' + result.error });
        }
    };

    const startProcessing = async () => {
        if (isProcessing || selectedFiles.length === 0) return;

        setIsProcessing(true);
        setExtractedImages([]);
        setResults(null);
        setRawText('');
        setProcessedText('');
        setProgress({ percent: 0, status: 'Bắt đầu xử lý...' });

        const globalStartTime = Date.now();

        try {
            let extractedRawText = '';
            let processRes: ProcessResult | ProcessResult[];

            // Phase 1: Extract text
            if (selectedFiles.length === 1) {
                processRes = await PdfProcessor.autoProcess(selectedFiles[0], { language, forceOcr }, (pct, msg) => {
                    setProgress({ percent: Math.round(pct * 0.4), status: msg || 'Đang trích xuất text...' });
                });
                extractedRawText = processRes.text || '';
            } else {
                processRes = await PdfProcessor.processBatch(selectedFiles, { language, forceOcr }, (fi, total, pct, msg) => {
                    const overall = Math.round(((fi + pct / 100) / total) * 100);
                    setProgress({ percent: Math.round(overall * 0.4), status: msg || `File ${fi + 1}/${total}...` });
                });
                extractedRawText = processRes.map(r => r.text || '').join('\n\n====\n\n');
            }

            setRawText(extractedRawText);

            // Phase 2: Extract images
            let images: any[] = [];
            if (keepImages && selectedFiles.length === 1) {
                setProgress({ percent: 41, status: '🖼️ Đang phát hiện hình ảnh...' });
                try {
                    images = await PdfProcessor.extractImages(selectedFiles[0], (pct, msg) => {
                        setProgress({ percent: 41 + Math.round(pct * 0.14), status: msg });
                    });
                    if (images.length > 0) {
                        setExtractedImages(images);
                        extractedRawText = injectImagePlaceholders(extractedRawText, images, (processRes as ProcessResult).pages);
                        setRawText(extractedRawText);
                        showToast(`🖼️ Phát hiện ${images.length} hình ảnh`, 'info');
                    }
                } catch (imgErr) {
                    console.warn('Image extraction failed:', imgErr);
                }
            }

            // Phase 3: AI Math
            let finalProcessedText = extractedRawText;
            if (useAiMath && GeminiService.hasApiKey() && extractedRawText.trim().length > 0) {
                setProgress({ percent: 56, status: '🤖 Gemini AI đang xử lý công thức toán...' });
                try {
                    finalProcessedText = await GeminiService.processMathFormulas(extractedRawText, (pct, msg) => {
                        setProgress({ percent: 56 + Math.round(pct * 0.42), status: msg });
                    });
                    setProcessedText(finalProcessedText);
                } catch (aiError: any) {
                    console.error('AI error:', aiError);
                    finalProcessedText = extractedRawText;
                    showToast('⚠️ Gemini AI lỗi: ' + aiError.message, 'warning');
                }
            } else {
                setProcessedText(extractedRawText);
            }

            setProgress({ percent: 100, status: 'Hoàn tất!' });
            const totalMs = Date.now() - globalStartTime;
            
            if (Array.isArray(processRes)) {
                processRes.forEach(r => r.processingTime = totalMs / processRes.length);
            } else {
                processRes.processingTime = totalMs;
            }
            
            setResults(processRes);
            showToast('✅ Xử lý thành công!', 'success');

        } catch (error: any) {
            console.error('Processing error:', error);
            showToast('❌ Lỗi xử lý: ' + error.message, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExportWord = async () => {
        const text = processedText || rawText;
        if (!text) return;

        try {
            showToast('Đang tạo file Word...', 'info');
            const fileName = selectedFiles.length > 0 ? selectedFiles[0].name.replace(/\.[^/.]+$/, '') + '_converted' : 'converted';
            
            if (extractedImages.length > 0) {
                await WordExporter.exportToWordWithImages(text, extractedImages, fileName, { fontSize: 24, fontName: 'Times New Roman' });
            } else {
                await WordExporter.exportToWord(text, fileName, { fontSize: 24, fontName: 'Times New Roman' });
            }
            showToast('✅ Đã tải file Word!', 'success');
        } catch (err: any) {
            showToast('❌ Lỗi tạo Word: ' + err.message, 'error');
        }
    };

    const handleCopy = async () => {
        const text = processedText || rawText;
        if (!text) return;
        const ok = await WordExporter.copyToClipboard(text);
        showToast(ok ? 'Đã sao chép!' : 'Không thể sao chép!', ok ? 'success' : 'error');
    };

    const handleDownloadTxt = () => {
        const text = processedText || rawText;
        if (!text) return;
        const fileName = selectedFiles.length > 0 ? selectedFiles[0].name.replace(/\.[^/.]+$/, '') + '_converted' : 'converted';
        WordExporter.downloadAsTxt(text, fileName);
        showToast('Đã tải file TXT!', 'success');
    };

    // Render Stats
    const renderStats = () => {
        if (!results) return null;
        let pageCount = 0;
        let confidence = '-';
        let time = '0s';

        if (Array.isArray(results)) {
            pageCount = results.reduce((sum, r) => sum + (r.pageCount || 0), 0);
            time = Math.round(results.reduce((sum, r) => sum + (r.processingTime || 0), 0) / 1000) + 's';
        } else {
            pageCount = results.pageCount || 0;
            confidence = (results.confidence || 0) + '%';
            time = Math.round((results.processingTime || 0) / 1000) + 's';
        }

        return (
            <div className="stats-grid active">
                <div className="stat-card">
                    <div className="stat-value">{pageCount}</div>
                    <div className="stat-label">Trang</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{confidence}</div>
                    <div className="stat-label">Độ tin cậy</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{time}</div>
                    <div className="stat-label">Thời gian</div>
                </div>
            </div>
        );
    };

    return (
        <div className="app-container">
            {/* Header */}
            <header className="header">
                <button className="header-settings-btn" onClick={() => setShowApiKeyModal(true)}>
                    <i className="fas fa-cog"></i> {GeminiService.hasApiKey() ? 'Cài đặt' : 'Nhập API Key'}
                </button>
                <div className="header-content">
                    <div className="header-icon">📄</div>
                    <h1>PDF to Word Pro</h1>
                    <p>Chuyển đổi PDF sang Word chuyên nghiệp với AI hỗ trợ công thức toán học và hình ảnh.</p>
                    {!GeminiService.hasApiKey() && (
                        <div className="api-warning">
                            <i className="fas fa-exclamation-triangle"></i> 
                            Chưa có API key. <a onClick={() => setShowApiKeyModal(true)}>Nhập ngay</a> để dùng AI.
                        </div>
                    )}
                </div>
            </header>

            {/* Features */}
            <div className="features-grid">
                <div className="feature-card">
                    <span className="icon">🤖</span>
                    <h3>Gemini AI</h3>
                    <p>Chuẩn hóa công thức toán LaTeX chính xác.</p>
                </div>
                <div className="feature-card">
                    <span className="icon">🖼️</span>
                    <h3>Image Extraction</h3>
                    <p>Tự động trích xuất và nhúng hình ảnh.</p>
                </div>
                <div className="feature-card">
                    <span className="icon">⚡</span>
                    <h3>Batch Process</h3>
                    <p>Xử lý nhiều file cùng lúc nhanh chóng.</p>
                </div>
            </div>

            {/* Main Card */}
            <div className="card">
                <div className="card-header">
                    <div className="icon"><i className="fas fa-cloud-upload-alt"></i></div>
                    <h2>Tải lên tài liệu</h2>
                </div>

                <div 
                    className="upload-zone"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
                    onDrop={handleDrop}
                >
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".pdf" 
                        multiple={batchMode}
                        onChange={handleFileSelect}
                    />
                    <div className="upload-icon"><i className="fas fa-file-pdf"></i></div>
                    <div className="upload-text">Kéo thả file PDF vào đây hoặc click để chọn</div>
                    <div className="upload-subtext">Hỗ trợ PDF văn bản và PDF dạng ảnh (OCR)</div>
                </div>

                <div id="filePreviewContainer">
                    {selectedFiles.length === 1 ? (
                        <div className="file-preview">
                            <div className="file-icon"><i className="fas fa-file-pdf"></i></div>
                            <div className="file-info">
                                <div className="file-name">{selectedFiles[0].name}</div>
                                <div className="file-size">{PdfProcessor.formatFileSize(selectedFiles[0].size)}</div>
                            </div>
                            <button className="file-remove" onClick={() => removeFile(0)}><i className="fas fa-times"></i></button>
                        </div>
                    ) : selectedFiles.length > 1 && (
                        <div className="batch-file-list">
                            {selectedFiles.map((file, i) => (
                                <div key={i} className="batch-file-item">
                                    <div className="file-icon"><i className="fas fa-file-pdf"></i></div>
                                    <div className="file-name">{file.name}</div>
                                    <div className="file-size">{PdfProcessor.formatFileSize(file.size)}</div>
                                    <button className="file-remove" onClick={() => removeFile(i)}><i className="fas fa-times"></i></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="options-row">
                    <div className="option-group">
                        <label>Ngôn ngữ OCR</label>
                        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                            <option value="vie+eng">Tiếng Việt + Tiếng Anh</option>
                            <option value="vie">Tiếng Việt</option>
                            <option value="eng">Tiếng Anh</option>
                        </select>
                    </div>
                    <div className="option-group">
                        <div className="toggle-option">
                            <label className="toggle-switch">
                                <input type="checkbox" checked={forceOcr} onChange={(e) => setForceOcr(e.target.checked)} />
                                <span className="toggle-slider"></span>
                            </label>
                            <span className="toggle-label">Ép buộc OCR</span>
                        </div>
                    </div>
                    <div className="option-group">
                        <div className="toggle-option">
                            <label className="toggle-switch">
                                <input type="checkbox" checked={useAiMath} onChange={(e) => setUseAiMath(e.target.checked)} />
                                <span className="toggle-slider"></span>
                            </label>
                            <span className="toggle-label">AI Math (Gemini)</span>
                        </div>
                    </div>
                    <div className="option-group">
                        <div className="toggle-option">
                            <label className="toggle-switch">
                                <input type="checkbox" checked={keepImages} onChange={(e) => setKeepImages(e.target.checked)} />
                                <span className="toggle-slider"></span>
                            </label>
                            <span className="toggle-label">Giữ hình ảnh</span>
                        </div>
                    </div>
                    <div className="option-group">
                        <div className="toggle-option">
                            <label className="toggle-switch">
                                <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
                                <span className="toggle-slider"></span>
                            </label>
                            <span className="toggle-label">Chế độ Batch</span>
                        </div>
                    </div>
                </div>

                <button 
                    className="btn btn-primary btn-full" 
                    disabled={isProcessing || selectedFiles.length === 0}
                    onClick={startProcessing}
                >
                    {isProcessing ? (
                        <><i className="fas fa-spinner fa-spin"></i> Đang xử lý...</>
                    ) : selectedFiles.length > 0 ? (
                        <><i className="fas fa-magic"></i> {batchMode ? `Xử lý ${selectedFiles.length} file` : 'Bắt đầu chuyển đổi'}</>
                    ) : (
                        <><i className="fas fa-magic"></i> Chọn file PDF trước</>
                    )}
                </button>

                {isProcessing && (
                    <div className="progress-container active">
                        <div className="progress-header">
                            <span className="progress-label">Tiến trình</span>
                            <span className="progress-percent">{progress.percent}%</span>
                        </div>
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }}></div>
                        </div>
                        <div className="progress-status">{progress.status}</div>
                    </div>
                )}
            </div>

            {/* Results Section */}
            {results && (
                <div className="fade-in">
                    {renderStats()}

                    <div className="card">
                        <div className="card-header">
                            <div className="icon"><i className="fas fa-poll-h"></i></div>
                            <h2>Kết quả chuyển đổi</h2>
                        </div>

                        <div className="view-toggle">
                            <button 
                                className={`view-btn ${viewMode === 'rendered' ? 'active' : ''}`}
                                onClick={() => setViewMode('rendered')}
                            >
                                <i className="fas fa-eye"></i> Xem trước
                            </button>
                            <button 
                                className={`view-btn ${viewMode === 'raw' ? 'active' : ''}`}
                                onClick={() => setViewMode('raw')}
                            >
                                <i className="fas fa-code"></i> Text thô
                            </button>
                        </div>

                        <div id="resultsRendered" ref={renderedResultsRef} className={`result-rendered ${viewMode === 'rendered' ? '' : 'hidden'}`}></div>
                        <pre id="resultsText" className={`result-container ${viewMode === 'raw' ? '' : 'hidden'}`}>
                            {processedText || rawText}
                        </pre>

                        <div className="btn-group" style={{ marginTop: '24px' }}>
                            <button className="btn btn-primary" onClick={handleExportWord}>
                                <i className="fas fa-file-word"></i> Tải file Word (.docx)
                            </button>
                            <button className="btn btn-outline" onClick={handleCopy}>
                                <i className="fas fa-copy"></i> Sao chép
                            </button>
                            <button className="btn btn-outline" onClick={handleDownloadTxt}>
                                <i className="fas fa-file-alt"></i> Tải file .txt
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* API Key Modal */}
            {showApiKeyModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <span className="modal-icon">🔑</span>
                            <h2>Cấu hình Gemini AI</h2>
                            <p>Nhập API Key để sử dụng tính năng nhận dạng công thức toán học.</p>
                        </div>
                        <div className="modal-body">
                            <div className="input-group">
                                <label>Gemini API Key</label>
                                <div className="input-with-btn">
                                    <input 
                                        type={apiKeyVisible ? 'text' : 'password'} 
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        placeholder="Nhập API key của bạn..."
                                    />
                                    <button className="btn-icon" onClick={() => setApiKeyVisible(!apiKeyVisible)}>
                                        <i className={`fas fa-eye${apiKeyVisible ? '-slash' : ''}`}></i>
                                    </button>
                                </div>
                                <div className="input-hint">
                                    Lấy key miễn phí tại <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>
                                </div>
                                {validationStatus.type && (
                                    <div className={`validation-status ${validationStatus.type}`}>
                                        {validationStatus.type === 'loading' ? <i className="fas fa-spinner fa-spin"></i> : 
                                         validationStatus.type === 'success' ? <i className="fas fa-check-circle"></i> : 
                                         <i className="fas fa-times-circle"></i>}
                                        <span>{validationStatus.msg}</span>
                                    </div>
                                )}
                            </div>

                            <div className="model-selector">
                                <label>Chọn Model</label>
                                <div className="model-cards">
                                    {GeminiService.getModelList().map(model => (
                                        <div 
                                            key={model.id} 
                                            className={`model-card ${selectedModel === model.id ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedModel(model.id);
                                                GeminiService.setSelectedModel(model.id);
                                            }}
                                        >
                                            <div className="model-radio"></div>
                                            <div className="model-info">
                                                <div className="model-name">{model.name}</div>
                                                <div className="model-desc">{model.desc}</div>
                                            </div>
                                            <span className="model-badge">{model.badge}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-outline" onClick={() => setShowApiKeyModal(false)}>Bỏ qua</button>
                            <button className="btn btn-primary" onClick={handleSaveApiKey}>Lưu cấu hình</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toasts */}
            <div className="toast-container">
                {toasts.map(toast => (
                    <div key={toast.id} className={`toast toast-${toast.type}`}>
                        <i className={`fas ${toast.type === 'success' ? 'fa-check-circle' : toast.type === 'error' ? 'fa-exclamation-triangle' : 'fa-info-circle'}`}></i>
                        {toast.msg}
                    </div>
                ))}
            </div>

            <footer className="footer">
                <p>© 2026 PDF to Word Pro. Phát triển bởi <a href="#">Lương Đình Hùng 0986 282 414</a></p>
            </footer>
        </div>
    );
}
