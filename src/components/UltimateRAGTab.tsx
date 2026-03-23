/**
 * Ultimate RAG Tab - Hackathon Winning Version
 * 
 * Features:
 * - Drag & drop PDF upload
 * - Real-time token streaming (word-by-word)
 * - Interactive citations [1], [2], [3]
 * - PDF viewer with scroll & highlight
 * - IndexedDB persistence
 * - Local Whisper voice commands
 * - WebGPU acceleration
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory, VoicePipeline } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { extractTextFromPDF, chunkTextWithPages, TextChunk, PageText } from '../utils/pdfProcessor';
import { initEmbeddings, generateEmbeddings } from '../utils/embeddings';
import { initVectorDB, insertDocument, searchSimilar, clearVectorDB } from '../utils/vectorDB';
import * as persistence from '../utils/persistence';
import { getAccelerationMode } from '../runanywhere';
import { Document, Page, pdfjs } from 'react-pdf';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Citation {
  index: number;
  text: string;
  pageNumber: number;
  chunkIndex: number;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  citations?: Citation[];
  timestamp: number;
  tokensPerSecond?: number;
}

export function UltimateRAGTab() {
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  
  // State
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<PageText[]>([]);
  const [chunks, setChunks] = useState<TextChunk[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [embeddingsReady, setEmbeddingsReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  
  // PDF Viewer
  const [numPages, setNumPages] = useState<number>(0);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);
  const [highlightedChunk, setHighlightedChunk] = useState<number | null>(null);
  
  // Voice
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Drag & Drop
  const [isDragging, setIsDragging] = useState(false);
  
  // Refs
  const listRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize
  useEffect(() => {
    if (llmLoader.state === 'ready' && !embeddingsReady) {
      initEmbeddings((progress) => {
        console.log('Loading embeddings:', progress);
      })
        .then(() => {
          setEmbeddingsReady(true);
          return initVectorDB();
        })
        .catch((err) => console.error('Failed to initialize:', err));
    }
  }, [llmLoader.state, embeddingsReady]);

  // Restore state from IndexedDB
  useEffect(() => {
    if (embeddingsReady) {
      restoreState();
    }
  }, [embeddingsReady]);

  // Auto-scroll messages
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Save state whenever it changes
  useEffect(() => {
    if (documentId && messages.length > 0) {
      saveState();
    }
  }, [messages, documentId]);

  const restoreState = async () => {
    try {
      const savedDocId = await persistence.getCurrentDocumentId();
      if (!savedDocId) return;

      const doc = await persistence.getDocument(savedDocId);
      if (!doc) return;

      const chatHistory = await persistence.getChatHistory(savedDocId);
      if (chatHistory) {
        setMessages(chatHistory.messages.map((m: any) => ({
          ...m,
          citations: m.citations || [],
        })));
      }

      // Restore document
      setDocumentId(doc.id);
      setDocumentName(doc.filename);
      setPdfPages(doc.pages);
      setChunks(doc.chunks);
      setNumPages(doc.pages.length);

      // Rebuild vector DB
      await clearVectorDB();
      const embeddings = await generateEmbeddings(
        doc.chunks.map((c: any) => c.text),
        (current, total) => {
          setProcessingStatus(`Restoring embeddings (${current}/${total})...`);
          setProcessingProgress(current / total);
        }
      );

      for (let i = 0; i < doc.chunks.length; i++) {
        await insertDocument({
          id: `chunk_${i}`,
          text: doc.chunks[i].text,
          pageNumber: doc.chunks[i].pageNumber,
          chunkIndex: i,
          embedding: embeddings[i],
        });
      }

      setProcessingStatus('');
      console.log('State restored successfully');
    } catch (err) {
      console.error('Failed to restore state:', err);
    }
  };

  const saveState = async () => {
    if (!documentId) return;
    
    try {
      await persistence.saveChatHistory(documentId, messages);
      await persistence.saveCurrentDocumentId(documentId);
    } catch (err) {
      console.error('Failed to save state:', err);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.includes('pdf')) {
      alert('Please upload a PDF file');
      return;
    }

    setProcessing(true);
    setPdfFile(file);
    setDocumentName(file.name);

    try {
      // Extract text
      setProcessingStatus('Extracting text from PDF...');
      const extracted = await extractTextFromPDF(file, (progress) => {
        setProcessingProgress(progress * 0.3);
      });

      setPdfPages(extracted.pages);
      setNumPages(extracted.pages.length);

      // Chunk text
      setProcessingStatus('Chunking document...');
      setProcessingProgress(0.3);
      const textChunks = chunkTextWithPages(extracted.pages, 400, 50);
      setChunks(textChunks);

      // Generate embeddings
      setProcessingStatus('Generating embeddings...');
      const embeddings = await generateEmbeddings(
        textChunks.map((c) => c.text),
        (current, total) => {
          setProcessingProgress(0.3 + (current / total) * 0.6);
          setProcessingStatus(`Generating embeddings (${current}/${total})...`);
        }
      );

      // Insert into vector DB
      setProcessingStatus('Building vector index...');
      await clearVectorDB();
      for (let i = 0; i < textChunks.length; i++) {
        await insertDocument({
          id: `chunk_${i}`,
          text: textChunks[i].text,
          pageNumber: textChunks[i].pageNumber,
          chunkIndex: i,
          embedding: embeddings[i],
        });
      }

      // Save to IndexedDB
      const docId = `doc_${Date.now()}`;
      setDocumentId(docId);
      await persistence.saveDocument({
        id: docId,
        filename: file.name,
        pages: extracted.pages,
        chunks: textChunks,
      });
      await persistence.saveCurrentDocumentId(docId);

      setProcessingProgress(1);
      setProcessingStatus('');
      setProcessing(false);

      setMessages([
        {
          role: 'system',
          text: `📄 **${file.name}** loaded successfully!\n\n${extracted.pages.length} pages • ${textChunks.length} chunks\n\nAsk me anything about this document.`,
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      console.error('Failed to process PDF:', err);
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleRAGQuery = async (query: string) => {
    if (!query.trim() || generating || !documentId) return;
    if (llmLoader.state !== 'ready') {
      alert('Please load the AI model first');
      return;
    }

    const userMessage: Message = {
      role: 'user',
      text: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setGenerating(true);

    try {
      // Search for relevant chunks
      const results = await searchSimilar(query, 3);
      
      const citations: Citation[] = results.map((r, idx) => ({
        index: idx + 1,
        text: r.text,
        pageNumber: r.pageNumber,
        chunkIndex: r.chunkIndex,
      }));

      // Build context
      const context = results
        .map((r, idx) => `[${idx + 1}] ${r.text}`)
        .join('\n\n');

      // Create assistant message placeholder
      const assistantIdx = messages.length + 1;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: '',
          citations,
          timestamp: Date.now(),
        },
      ]);

      // Generate response with streaming
      const prompt = `Context from document:\n\n${context}\n\nQuestion: ${query}\n\nAnswer based on the context above. Use citations like [1], [2], [3] when referencing information from the context.`;

      const { stream } = await TextGeneration.generateStream(prompt, {
        maxTokens: 400,
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        systemPrompt: 'You are a helpful research assistant. Answer questions based on the provided context. Always cite your sources using [1], [2], [3] notation.',
      });

      let accumulated = '';
      let tokenCount = 0;
      const startTime = Date.now();
      let lastUpdate = Date.now();

      for await (const token of stream) {
        accumulated += token;
        tokenCount++;

        // Update UI more frequently for smooth streaming (every 20ms)
        const now = Date.now();
        if (now - lastUpdate > 20 || tokenCount % 3 === 0) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[assistantIdx] = {
              role: 'assistant',
              text: accumulated,
              citations,
              timestamp: Date.now(),
            };
            return updated;
          });
          lastUpdate = now;
        }
      }

      // Final update with stats
      const endTime = Date.now();
      const tokensPerSecond = tokenCount / ((endTime - startTime) / 1000);

      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: 'assistant',
          text: accumulated,
          citations,
          timestamp: Date.now(),
          tokensPerSecond,
        };
        return updated;
      });
    } catch (err) {
      console.error('RAG query error:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setGenerating(false);
    }
  };

  const handleCitationClick = (citation: Citation) => {
    setHighlightedPage(citation.pageNumber);
    setHighlightedChunk(citation.chunkIndex);
    
    // Scroll to PDF page
    if (pdfViewerRef.current) {
      const pageElement = pdfViewerRef.current.querySelector(`[data-page-number="${citation.pageNumber}"]`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Voice recording
  const startRecording = async () => {
    if (sttLoader.state !== 'ready') {
      alert('Please load the speech recognition model first');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processVoiceInput(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processVoiceInput = async (audioBlob: Blob) => {
    setTranscribing(true);
    
    try {
      // Convert to audio buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Get mono channel
      let audioData = audioBuffer.getChannelData(0);
      
      // If needed, resample to 16kHz
      if (audioBuffer.sampleRate !== 16000) {
        const offlineCtx = new OfflineAudioContext(1, Math.round(audioData.length * 16000 / audioBuffer.sampleRate), 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        const resampled = await offlineCtx.startRendering();
        audioData = resampled.getChannelData(0);
      }

      // Use VoicePipeline for full transcription
      const pipeline = new VoicePipeline();
      const result = await pipeline.processTurn(audioData, {
        maxTokens: 10, // We only want transcription, not a response
        temperature: 0.7,
      }, {
        onTranscription: (text) => {
          console.log('Transcription:', text);
        },
      });

      const transcription = result?.transcription || '';
      setTranscribing(false);

      if (transcription.trim()) {
        setInput(transcription);
        // Automatically submit the query
        await handleRAGQuery(transcription);
      } else {
        alert('Could not transcribe audio. Please try again.');
      }
    } catch (err) {
      console.error('Voice transcription error:', err);
      alert(`Transcription failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTranscribing(false);
    }
  };

  // Drag & Drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const accel = getAccelerationMode();
  const isWebGPU = accel === 'webgpu';

  return (
    <div className="ultimate-rag-tab">
      {/* Header */}
      <div className="rag-header-ultimate">
        <div className="header-content">
          <h1>📚 AI Research Copilot</h1>
          <p>Upload any PDF and ask questions using AI - 100% private & offline</p>
          {isWebGPU && <div className="webgpu-badge">⚡ WebGPU Accelerated</div>}
        </div>
      </div>

      {/* Model Loaders */}
      <div className="model-loaders">
        <ModelBanner
          state={llmLoader.state}
          progress={llmLoader.progress}
          error={llmLoader.error}
          onLoad={llmLoader.ensure}
          label="🧠 Language Model"
        />
        {embeddingsReady && (
          <div className="status-pill success">✅ Embeddings Ready</div>
        )}
      </div>

      {/* Main Content */}
      <div className="rag-main-content">
        {/* Left: Chat Interface */}
        <div className="chat-column">
          {!documentId && llmLoader.state === 'ready' && embeddingsReady && !processing && (
            <div
              className={`upload-zone ${isDragging ? 'dragging' : ''}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">📄</div>
              <h3>Drop your PDF here</h3>
              <p>or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {processing && (
            <div className="processing-overlay">
              <div className="processing-card">
                <div className="spinner-large" />
                <h3>{processingStatus}</h3>
                <div className="progress-bar-large">
                  <div
                    className="progress-fill"
                    style={{ width: `${processingProgress * 100}%` }}
                  />
                </div>
                <p>{Math.round(processingProgress * 100)}%</p>
              </div>
            </div>
          )}

          {documentId && (
            <>
              <div className="document-header">
                <div className="doc-info">
                  <span className="doc-icon">📄</span>
                  <div>
                    <div className="doc-name">{documentName}</div>
                    <div className="doc-stats">{numPages} pages • {chunks.length} chunks</div>
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    if (confirm('Upload a new document? Current chat will be saved.')) {
                      await saveState();
                      setDocumentId(null);
                      setPdfFile(null);
                      setMessages([]);
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  Change Doc
                </button>
              </div>

              <div className="message-list-ultimate" ref={listRef}>
                {messages.map((msg, i) => (
                  <div key={i} className={`message-ultimate message-${msg.role}`}>
                    <div className="message-content-ultimate">
                      <div className="message-text">{msg.text}</div>
                      
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="citations">
                          {msg.citations.map((citation) => (
                            <button
                              key={citation.index}
                              className={`citation-btn ${highlightedChunk === citation.chunkIndex ? 'active' : ''}`}
                              onClick={() => handleCitationClick(citation)}
                              title={`Page ${citation.pageNumber}: ${citation.text.substring(0, 100)}...`}
                            >
                              [{citation.index}] Page {citation.pageNumber}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {msg.tokensPerSecond && (
                        <div className="message-meta">
                          ⚡ {msg.tokensPerSecond.toFixed(1)} tok/s
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {transcribing && (
                  <div className="message-ultimate message-system">
                    <div className="message-content-ultimate">
                      <div className="transcribing-indicator">
                        <div className="spinner-small" />
                        Transcribing audio...
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <form
                className="chat-input-ultimate"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRAGQuery(input);
                }}
              >
                <input
                  type="text"
                  placeholder="Ask anything about your document..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={generating || transcribing}
                  className="input-ultimate"
                />
                
                {sttLoader.state === 'ready' && (
                  <button
                    type="button"
                    className={`btn btn-voice ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={generating || transcribing}
                    title="Voice input"
                  >
                    {isRecording ? '⏹️' : '🎤'}
                  </button>
                )}
                
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!input.trim() || generating || transcribing}
                >
                  {generating ? '...' : 'Ask'}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Right: PDF Viewer */}
        {pdfFile && (
          <div className="pdf-column" ref={pdfViewerRef}>
            <div className="pdf-viewer-header">
              <h3>Document Viewer</h3>
              {highlightedPage && (
                <div className="highlight-indicator">
                  Showing Page {highlightedPage}
                </div>
              )}
            </div>
            <div className="pdf-viewer-content">
              <Document file={pdfFile} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                {Array.from(new Array(numPages), (el, index) => (
                  <div
                    key={`page_${index + 1}`}
                    data-page-number={index + 1}
                    className={`pdf-page-container ${highlightedPage === index + 1 ? 'highlighted' : ''}`}
                  >
                    <div className="page-number">Page {index + 1}</div>
                    <Page
                      pageNumber={index + 1}
                      width={600}
                      renderTextLayer={true}
                      renderAnnotationLayer={false}
                    />
                  </div>
                ))}
              </Document>
            </div>
          </div>
        )}
      </div>

      {/* Voice Model Loader (bottom) */}
      {sttLoader.state !== 'idle' && sttLoader.state !== 'ready' && (
        <div className="voice-loader-banner">
          <ModelBanner
            state={sttLoader.state}
            progress={sttLoader.progress}
            error={sttLoader.error}
            onLoad={sttLoader.ensure}
            label="🎤 Voice Recognition (Optional)"
          />
        </div>
      )}
    </div>
  );
}
