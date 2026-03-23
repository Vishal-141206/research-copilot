/**
 * Clean AI Research Copilot
 * 
 * Beautiful, simple, and powerful UX
 */

import { useState, useRef, useEffect } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { extractTextFromPDF, chunkTextWithPages, PageText } from '../utils/pdfProcessor';
import { workerManager } from '../workers/workerManager';
import { initVectorDB, insertDocument, searchSimilar, clearVectorDB } from '../utils/vectorDB';
import * as persistence from '../utils/persistence';
import { Document, Page, pdfjs } from 'react-pdf';
import { GamifiedLoadingScreen } from './GamifiedLoadingScreen';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Message {
  role: 'user' | 'assistant';
  text: string;
  citations?: Array<{ page: number; text: string }>;
  streaming?: boolean;
}

export function CleanResearchCopilot() {
  // Core state
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const [modelsReady, setModelsReady] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  
  // Document state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<PageText[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [documentReady, setDocumentReady] = useState(false);
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  
  // UI state
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [progress, setProgress] = useState(0);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  
  // Voice
  const [isRecording, setIsRecording] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<HTMLDivElement>(null);

  // Initialize models
  useEffect(() => {
    const initModels = async () => {
      try {
        // Initialize embeddings worker
        await workerManager.initEmbeddings((progress) => {
          console.log('Embeddings:', progress);
        });
        
        // Initialize vector DB
        await initVectorDB();
        
        // Wait for LLM
        if (llmLoader.state === 'ready') {
          setModelsReady(true);
          setShowLoading(false);
        }
      } catch (error) {
        console.error('Model initialization failed:', error);
      }
    };

    if (llmLoader.state === 'ready' && !modelsReady) {
      initModels();
    }
  }, [llmLoader.state, modelsReady]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle PDF upload
  const handleFileSelect = async (file: File) => {
    if (!file.type.includes('pdf')) {
      alert('Please upload a PDF file');
      return;
    }

    setPdfFile(file);
    setProcessing(true);
    setDocumentReady(false);
    setMessages([]);

    try {
      // Extract text
      setProcessingStep('Reading PDF...');
      setProgress(0);
      
      const extracted = await extractTextFromPDF(file, (p) => {
        setProgress(p * 0.3);
      });

      setPdfPages(extracted.pages);
      setNumPages(extracted.pages.length);

      // Chunk text
      setProcessingStep('Analyzing document...');
      setProgress(0.3);
      
      const chunks = chunkTextWithPages(extracted.pages, 400, 50);

      // Generate embeddings (in worker - non-blocking!)
      setProcessingStep('Creating semantic index...');
      
      const embeddings = await workerManager.generateEmbeddings(
        chunks.map((c) => c.text),
        (current, total) => {
          setProgress(0.3 + (current / total) * 0.6);
          setProcessingStep(`Processing chunk ${current}/${total}...`);
        }
      );

      // Build vector index
      setProcessingStep('Building search index...');
      setProgress(0.9);
      
      await clearVectorDB();
      for (let i = 0; i < chunks.length; i++) {
        await insertDocument({
          id: `chunk_${i}`,
          text: chunks[i].text,
          pageNumber: chunks[i].pageNumber,
          chunkIndex: i,
          embedding: embeddings[i],
        });
      }

      setProgress(1);
      setDocumentReady(true);
      setProcessing(false);
      
      setMessages([{
        role: 'assistant',
        text: `✨ I've analyzed **${file.name}** (${extracted.pages.length} pages).\n\nAsk me anything about this document!`,
      }]);

    } catch (error) {
      console.error('PDF processing failed:', error);
      alert('Failed to process PDF. Please try again.');
      setProcessing(false);
    }
  };

  // Handle question
  const handleAsk = async () => {
    if (!input.trim() || generating || !documentReady) return;

    const question = input.trim();
    setInput('');
    
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setGenerating(true);

    // Add streaming placeholder
    const streamingIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', text: '', streaming: true }]);

    try {
      // Search relevant chunks
      const results = await searchSimilar(question, 3);
      const citations = results.map((r) => ({ page: r.pageNumber, text: r.text }));
      
      const context = results.map((r, idx) => `[${idx + 1}] ${r.text}`).join('\n\n');
      
      // Build prompt
      const prompt = `Context from document:\n\n${context}\n\nQuestion: ${question}\n\nAnswer based on the context. Cite sources using [1], [2], [3].`;

      // Stream response
      const { stream } = await TextGeneration.generateStream(prompt, {
        maxTokens: 300,
        temperature: 0.7,
        systemPrompt: 'You are a helpful research assistant. Answer based on context and cite sources.',
      });

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        
        // Update every few tokens for smooth streaming
        setMessages((prev) => {
          const updated = [...prev];
          updated[streamingIndex] = {
            role: 'assistant',
            text: accumulated,
            citations,
            streaming: true,
          };
          return updated;
        });
      }

      // Final update
      setMessages((prev) => {
        const updated = [...prev];
        updated[streamingIndex] = {
          role: 'assistant',
          text: accumulated,
          citations,
        };
        return updated;
      });

    } catch (error) {
      console.error('Question failed:', error);
      setMessages((prev) => {
        const updated = [...prev];
        updated[streamingIndex] = {
          role: 'assistant',
          text: '⚠️ Sorry, something went wrong. Please try again.',
        };
        return updated;
      });
    } finally {
      setGenerating(false);
    }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone access failed:', error);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      const text = await workerManager.transcribe(audioData);
      
      if (text.trim()) {
        setInput(text);
      }
    } catch (error) {
      console.error('Transcription failed:', error);
      alert('Could not transcribe audio');
    }
  };

  // Citation click
  const handleCitationClick = (page: number) => {
    setHighlightedPage(page);
    setShowPdfViewer(true);
    
    setTimeout(() => {
      const pageElement = pdfViewerRef.current?.querySelector(`[data-page="${page}"]`);
      pageElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  if (showLoading) {
    return <GamifiedLoadingScreen onComplete={() => setShowLoading(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-3xl">🤖</div>
            <div>
              <h1 className="text-xl font-bold">AI Research Copilot</h1>
              <p className="text-xs text-slate-400">100% Private & Offline</p>
            </div>
          </div>
          
          {pdfFile && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              Change Document
            </button>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Upload Zone */}
        {!pdfFile && !processing && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="max-w-md w-full">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-primary-500 rounded-2xl p-12 text-center cursor-pointer transition-all hover:bg-slate-900/50 group"
              >
                <div className="text-6xl mb-4 group-hover:scale-110 transition-transform">📄</div>
                <h3 className="text-2xl font-bold mb-2">Drop your PDF here</h3>
                <p className="text-slate-400 mb-6">or click to browse</p>
                <div className="inline-block px-6 py-3 bg-primary-600 hover:bg-primary-500 rounded-lg font-medium transition-colors">
                  Choose File
                </div>
              </div>
              
              <div className="mt-8 space-y-3 text-sm text-slate-400">
                <div className="flex items-center space-x-2">
                  <span>✓</span>
                  <span>Research papers, legal docs, textbooks</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span>✓</span>
                  <span>100% private - never leaves your device</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span>✓</span>
                  <span>Ask questions in natural language</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Processing */}
        {processing && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="max-w-md w-full bg-slate-900/50 backdrop-blur-xl rounded-2xl p-8 border border-slate-800">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary-500 border-t-transparent mx-auto mb-6" />
              <h3 className="text-xl font-bold text-center mb-2">{processingStep}</h3>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="text-center text-slate-400 text-sm mt-3">
                {Math.round(progress * 100)}%
              </p>
            </div>
          </div>
        )}

        {/* Chat Interface */}
        {documentReady && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Messages */}
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 flex flex-col" style={{ height: 'calc(100vh - 200px)' }}>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-800 text-slate-100'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap gap-2">
                          {msg.citations.map((cite, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleCitationClick(cite.page)}
                              className="text-xs px-2 py-1 bg-slate-700 hover:bg-primary-600 rounded transition-colors"
                            >
                              Page {cite.page}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {msg.streaming && (
                        <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-slate-800">
                <form onSubmit={(e) => { e.preventDefault(); handleAsk(); }} className="flex space-x-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask anything about your document..."
                    disabled={generating}
                    className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  />
                  
                  {voiceReady && (
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`px-4 py-3 rounded-xl transition-colors ${
                        isRecording
                          ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700'
                      }`}
                    >
                      🎤
                    </button>
                  )}
                  
                  <button
                    type="submit"
                    disabled={!input.trim() || generating}
                    className="px-6 py-3 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
                  >
                    {generating ? '...' : 'Ask'}
                  </button>
                </form>
              </div>
            </div>

            {/* PDF Viewer */}
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
              <div className="h-full overflow-y-auto p-6" ref={pdfViewerRef}>
                {pdfFile && (
                  <Document file={pdfFile} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                    {Array.from(new Array(numPages), (_, i) => (
                      <div
                        key={i}
                        data-page={i + 1}
                        className={`mb-6 rounded-xl overflow-hidden transition-all ${
                          highlightedPage === i + 1
                            ? 'ring-4 ring-primary-500 shadow-2xl shadow-primary-500/50'
                            : ''
                        }`}
                      >
                        <Page pageNumber={i + 1} width={600} renderTextLayer={false} renderAnnotationLayer={false} />
                      </div>
                    ))}
                  </Document>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
        }}
        className="hidden"
      />
    </div>
  );
}
