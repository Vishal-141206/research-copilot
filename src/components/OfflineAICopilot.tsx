/**
 * HACKATHON-WINNING OFFLINE AI RESEARCH COPILOT
 * 
 * Features:
 * - PDF upload with RAG (semantic search)
 * - Smart text highlighting with floating actions
 * - Push-to-talk voice input (Whisper)
 * - Streaming LLM responses (Phi-3 / LFM2)
 * - Multiple explain modes
 * - Query caching
 * - Demo mode
 * - Offline-first with Service Worker
 * - Premium UI with animations
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { motion, AnimatePresence } from 'framer-motion';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { workerManager } from '../workers/workerManager';
import { DocumentStore, Document as StoredDoc } from '../utils/documentStore';
import { QueryCache } from '../utils/queryCache';
import { getDemoResponse, createDemoPDFBlob } from '../utils/demoHelpers';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type ExplainMode = 'simple' | 'detailed' | 'exam';
type AppState = 'idle' | 'loading-models' | 'processing-pdf' | 'ready' | 'thinking' | 'responding';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  cached?: boolean;
}

interface FloatingAction {
  x: number;
  y: number;
  selectedText: string;
}

export function OfflineAICopilot() {
  // State
  const [appState, setAppState] = useState<AppState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  
  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentDocument, setCurrentDocument] = useState<StoredDoc | null>(null);
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [explainMode, setExplainMode] = useState<ExplainMode>('simple');
  
  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [floatingAction, setFloatingAction] = useState<FloatingAction | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showSuccessFeedback, setShowSuccessFeedback] = useState(false);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    initializeApp();
    
    // Subscribe to document changes
    const unsubscribe = DocumentStore.subscribe(() => {
      const docs = DocumentStore.getAllDocuments();
      if (docs.length > 0 && !currentDocument) {
        setCurrentDocument(docs[0]);
      }
    });
    
    // Track online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const initializeApp = async () => {
    try {
      setAppState('loading-models');
      setStatusMessage('Initializing AI models...');
      
      // Initialize query cache
      await QueryCache.init();
      
      // Initialize embeddings worker
      setStatusMessage('Loading embeddings model...');
      await workerManager.initEmbeddings((progress) => {
        setStatusMessage(progress.status);
        setProgress(progress.progress || 0);
      });
      
      setAppState('idle');
      setStatusMessage('');
    } catch (error) {
      console.error('Failed to initialize:', error);
      setAppState('idle');
      setStatusMessage('Failed to initialize. Please refresh.');
    }
  };

  // PDF Upload
  const handleFileSelect = async (file: File) => {
    if (!file || file.type !== 'application/pdf') return;
    
    try {
      setAppState('processing-pdf');
      setPdfFile(file);
      
      // Add document to store
      const doc = await DocumentStore.addDocument(file, (status, prog) => {
        setStatusMessage(status);
        setProgress(prog);
      });
      
      // Process for RAG
      await DocumentStore.processDocumentForRAG(doc.id, (status, prog) => {
        setStatusMessage(status);
        setProgress(prog);
      });
      
      setCurrentDocument(doc);
      setAppState('ready');
      setStatusMessage('');
      
      // Add welcome message
      addMessage('assistant', `Document "${file.name}" loaded successfully! You can now ask questions about it.`);
      
    } catch (error) {
      console.error('PDF processing error:', error);
      setAppState('idle');
      setStatusMessage('Failed to process PDF');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // Chat
  const addMessage = (role: 'user' | 'assistant', content: string, cached = false) => {
    const message: Message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: Date.now(),
      cached
    };
    setMessages(prev => [...prev, message]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentDocument) return;
    if (appState === 'thinking' || appState === 'responding') return;
    
    const query = inputValue.trim();
    setInputValue('');
    addMessage('user', query);
    
    try {
      // Demo mode: instant responses
      if (demoMode) {
        const demoResponse = getDemoResponse(query);
        if (demoResponse) {
          setAppState('thinking');
          setStatusMessage('Searching documents...');
          await new Promise(resolve => setTimeout(resolve, 300)); // Simulate search
          
          setAppState('responding');
          setStatusMessage('Generating answer...');
          await new Promise(resolve => setTimeout(resolve, 400)); // Simulate generation
          
          addMessage('assistant', demoResponse, false);
          setAppState('ready');
          setStatusMessage('');
          return;
        }
      }
      
      // Check cache first
      const cached = await QueryCache.get(query, explainMode);
      if (cached) {
        addMessage('assistant', cached.response, true);
        return;
      }
      
      setAppState('thinking');
      setStatusMessage('Searching documents...');
      
      // Semantic search using RAG
      const searchResults = await DocumentStore.searchDocument(
        currentDocument.id,
        query,
        3
      );
      
      if (searchResults.length === 0) {
        addMessage('assistant', "I couldn't find relevant information in the document to answer that question.");
        setAppState('ready');
        setStatusMessage('');
        return;
      }
      
      // Build context
      const context = searchResults
        .map(r => `[Chunk ${r.chunkIndex + 1}, similarity: ${r.similarity.toFixed(2)}]\n${r.chunk}`)
        .join('\n\n');
      
      setStatusMessage('Generating answer...');
      setAppState('responding');
      
      // Get LLM response
      const response = await generateLLMResponse(query, context, explainMode);
      
      // Cache the response
      await QueryCache.set(query, response, searchResults.map(r => r.chunk), explainMode);
      
      addMessage('assistant', response);
      setAppState('ready');
      setStatusMessage('');
      
    } catch (error) {
      console.error('Query error:', error);
      addMessage('assistant', 'Sorry, I encountered an error processing your question.');
      setAppState('ready');
      setStatusMessage('');
    }
  };

  const generateLLMResponse = async (
    query: string,
    context: string,
    mode: ExplainMode
  ): Promise<string> => {
    try {
      const systemPrompts = {
        simple: 'You are a helpful assistant. Explain concepts in simple, clear language. Keep answers concise (2-3 sentences).',
        detailed: 'You are an expert research assistant. Provide detailed, comprehensive explanations with examples.',
        exam: 'You are helping a student prepare for an exam. Provide structured answers with key points and definitions.'
      };
      
      const prompt = `${systemPrompts[mode]}\n\nContext from document:\n${context}\n\nQuestion: ${query}\n\nAnswer:`;
      
      // Generate response using TextGeneration
      const { result } = await TextGeneration.generateStream(prompt, {
        maxTokens: mode === 'simple' ? 150 : 300,
        temperature: 0.7,
      });
      
      const response = await result;
      return response.text || 'Unable to generate response.';
      
    } catch (error) {
      console.error('LLM error:', error);
      
      // Fallback: Extract most relevant sentences from context
      const sentences = context.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const fallbackResponse = sentences.slice(0, mode === 'simple' ? 2 : 3).join('. ') + '.';
      return fallbackResponse || 'I found relevant information but cannot generate a response at this time.';
    }
  };

  // Text Selection Actions
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.toString().length < 3) {
      setFloatingAction(null);
      return;
    }
    
    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    setFloatingAction({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
      selectedText: text
    });
  };

  const handleQuickAction = async (action: 'explain' | 'summarize' | 'keypoints') => {
    if (!floatingAction) return;
    
    const text = floatingAction.selectedText;
    setFloatingAction(null);
    
    const prompts = {
      explain: `Explain this: "${text}"`,
      summarize: `Summarize this: "${text}"`,
      keypoints: `What are the key points in: "${text}"`
    };
    
    setInputValue(prompts[action]);
    setTimeout(() => handleSendMessage(), 100);
  };

  // Voice Input
  const startRecording = async () => {
    try {
      // Initialize Whisper worker if not ready
      const status = workerManager.getStatus();
      if (status.whisper !== 'ready') {
        setStatusMessage('Loading voice model...');
        await workerManager.initWhisper((progress) => {
          setStatusMessage(progress.status);
        });
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await transcribeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setTranscript('Listening...');
      
    } catch (error) {
      console.error('Recording error:', error);
      setStatusMessage('Microphone access denied');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setTranscript('Processing...');
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      // Convert blob to Float32Array
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);
      
      setStatusMessage('Transcribing...');
      const text = await workerManager.transcribe(audioData);
      
      setTranscript('');
      setInputValue(text);
      setStatusMessage('');
      
    } catch (error) {
      console.error('Transcription error:', error);
      setTranscript('');
      setStatusMessage('Transcription failed');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && inputValue.trim()) {
        e.preventDefault();
        handleSendMessage();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputValue, currentDocument, appState]);

  // Render loading screen
  if (appState === 'loading-models') {
    return (
      <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '64px',
            height: '64px',
            border: '3px solid var(--border2)',
            borderTop: '3px solid var(--amber)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <div style={{ color: 'var(--text2)', fontSize: '14px', marginBottom: '8px' }}>{statusMessage}</div>
          <div style={{ color: 'var(--text3)', fontSize: '12px' }}>
            {Math.round(progress * 100)}% complete
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&display=swap');
        
        :root {
          --bg: #0a0b0e;
          --bg2: #111318;
          --bg3: #181c24;
          --border: rgba(255,255,255,0.07);
          --border2: rgba(255,255,255,0.13);
          --amber: #e8a645;
          --amber-dim: rgba(232,166,69,0.12);
          --amber-glow: rgba(232,166,69,0.06);
          --text: #e8e6df;
          --text2: #9a9690;
          --text3: #5c5a55;
          --green: #4caf7d;
          --blue: #4a9eff;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: var(--text); font-family: 'JetBrains Mono', monospace; }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
        
        .pdf-container { user-select: text; }
        .pdf-container ::selection { background: rgba(232,166,69,0.3); }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes slideUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        button {
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        button:hover {
          transform: translateY(-1px);
        }
        
        button:active {
          transform: translateY(0);
        }
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: pdfFile ? '55% 45%' : '300px 1fr', gridTemplateRows: '56px 1fr', height: '100vh' }}>
        {/* Header */}
        <header style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '0 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg2)'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            border: '1.5px solid var(--amber)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            color: 'var(--amber)',
            letterSpacing: '0.05em'
          }}>AI</div>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '17px', color: 'var(--text)', letterSpacing: '-0.01em' }}>
            Offline Research Copilot
          </span>
          
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Offline/Online Badge */}
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '6px 12px', 
                background: isOnline ? 'rgba(76,175,125,0.1)' : 'var(--amber-dim)', 
                border: `1px solid ${isOnline ? 'var(--green)' : 'var(--amber)'}`, 
                borderRadius: '4px',
                boxShadow: isOnline ? '0 0 12px rgba(76,175,125,0.2)' : '0 0 12px rgba(232,166,69,0.2)'
              }}
            >
              <span style={{ fontSize: '12px' }}>{isOnline ? '🌐' : '🔒'}</span>
              <span style={{ 
                fontSize: '10px', 
                color: isOnline ? 'var(--green)' : 'var(--amber)', 
                letterSpacing: '0.05em',
                fontWeight: 600
              }}>
                {isOnline ? 'CONNECTED' : 'OFFLINE MODE'}
              </span>
            </motion.div>

            {/* Privacy Badge */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '6px 12px', 
              background: 'rgba(74,158,255,0.1)', 
              border: '1px solid var(--blue)', 
              borderRadius: '4px'
            }}>
              <span style={{ fontSize: '10px' }}>🛡️</span>
              <span style={{ 
                fontSize: '10px', 
                color: 'var(--blue)', 
                letterSpacing: '0.05em',
                fontWeight: 600
              }}>
                100% PRIVATE
              </span>
            </div>
            
            {/* Status Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <motion.div 
                animate={{ 
                  scale: appState === 'thinking' || appState === 'responding' ? [1, 1.3, 1] : 1,
                  opacity: appState === 'ready' ? 1 : 0.7
                }}
                transition={{ repeat: appState === 'thinking' || appState === 'responding' ? Infinity : 0, duration: 1.5 }}
                style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  background: appState === 'ready' ? 'var(--green)' : appState === 'idle' ? 'var(--text3)' : 'var(--amber)', 
                  boxShadow: `0 0 8px ${appState === 'ready' ? 'var(--green)' : 'var(--amber)'}` 
                }} 
              />
              <span style={{ fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {appState === 'ready' ? 'READY' : appState === 'thinking' ? 'THINKING' : appState === 'responding' ? 'GENERATING' : 'LOADING'}
              </span>
            </div>
          </div>
        </header>

        {/* Left Panel - PDF Viewer or Sidebar */}
        {pdfFile ? (
          <div ref={pdfContainerRef} className="pdf-container" onMouseUp={handleTextSelection} style={{
            background: 'var(--bg3)',
            borderRight: '1px solid var(--border)',
            overflow: 'auto',
            position: 'relative'
          }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '11px', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pdfFile.name}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
                  Page {currentPage} of {numPages}
                </div>
              </div>
              <button
                onClick={() => { setPdfFile(null); setCurrentDocument(null); setMessages([]); }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text3)',
                  padding: '4px 8px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  marginLeft: '12px'
                }}
              >
                ✕ Close
              </button>
            </div>
            
            <Document
              file={pdfFile}
              onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
              loading={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>Loading PDF...</div>}
            >
              {Array.from({ length: numPages }, (_, i) => (
                <Page
                  key={i}
                  pageNumber={i + 1}
                  width={pdfContainerRef.current?.clientWidth ? pdfContainerRef.current.clientWidth - 32 : 600}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                />
              ))}
            </Document>
          </div>
        ) : (
          <aside style={{
            background: 'var(--bg2)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: '10px' }}>
                UPLOAD DOCUMENTS
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: isDragging ? '1px dashed var(--amber)' : '1px dashed var(--border2)',
                  padding: '20px 12px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: isDragging ? 'var(--amber-glow)' : 'transparent'
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  style={{ display: 'none' }}
                />
                <div style={{
                  width: '32px',
                  height: '32px',
                  margin: '0 auto 8px',
                  border: '1px solid var(--border2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px'
                }}>⊕</div>
                <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Drop PDFs here</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '3px' }}>or click to browse</div>
              </div>
            </div>

            {/* Demo Mode Section */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: '10px' }}>
                DEMO MODE
              </div>
              <button
                onClick={async () => {
                  if (!demoMode) {
                    // Load demo PDF
                    const demoBlob = createDemoPDFBlob();
                    const demoFile = new File([demoBlob], 'demo-research-paper.pdf', { type: 'application/pdf' });
                    await handleFileSelect(demoFile);
                    setDemoMode(true);
                  } else {
                    setDemoMode(false);
                  }
                }}
                style={{
                  width: '100%',
                  background: demoMode ? 'var(--amber-dim)' : 'transparent',
                  border: `1px solid ${demoMode ? 'var(--amber)' : 'var(--border)'}`,
                  color: demoMode ? 'var(--amber)' : 'var(--text2)',
                  padding: '10px 14px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: 'all 0.2s',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span style={{ fontSize: '14px' }}>{demoMode ? '⚡' : '🎯'}</span>
                <span>{demoMode ? 'Demo Mode ON' : 'Load Demo PDF'}</span>
              </button>
              <div style={{ fontSize: '9px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.4 }}>
                {demoMode 
                  ? 'Instant cached responses for demo queries' 
                  : 'Perfect for hackathon presentations'}
              </div>
            </div>

            <div style={{ flex: 1, padding: '8px' }}>
              <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text3)', fontSize: '10px' }}>
                No documents loaded
              </div>
            </div>
          </aside>
        )}

        {/* Right Panel - Chat */}
        <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Explain Mode Toggle */}
          {currentDocument && (
            <div style={{
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--bg)',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>MODE:</span>
              {(['simple', 'detailed', 'exam'] as ExplainMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setExplainMode(mode)}
                  style={{
                    background: explainMode === mode ? 'var(--amber-dim)' : 'transparent',
                    border: `1px solid ${explainMode === mode ? 'var(--amber)' : 'var(--border)'}`,
                    color: explainMode === mode ? 'var(--amber)' : 'var(--text3)',
                    padding: '4px 10px',
                    fontSize: '9px',
                    cursor: 'pointer',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontFamily: "'JetBrains Mono', monospace"
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          {/* Chat Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px 40px', maxWidth: '480px', margin: '0 auto' }}>
                <div style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontSize: '52px',
                  color: 'var(--amber)',
                  opacity: 0.15,
                  lineHeight: 1,
                  marginBottom: '24px'
                }}>¶</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: '22px', fontWeight: 300, color: 'var(--text)', marginBottom: '10px' }}>
                  Your private research assistant
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.7, marginBottom: '20px' }}>
                  {pdfFile 
                    ? 'Ask questions about your document. All AI runs locally in your browser.'
                    : 'Upload a PDF to get started. All processing runs locally—no data leaves your device.'}
                </div>
                
                {pdfFile && currentDocument && (
                  <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {['Summarize the key findings', 'What are the main arguments?', 'List important terms'].map((hint, i) => (
                      <button
                        key={i}
                        onClick={() => { setInputValue(hint); setTimeout(handleSendMessage, 100); }}
                        style={{
                          background: 'var(--bg2)',
                          border: '1px solid var(--border)',
                          padding: '10px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '11px',
                          color: 'var(--text2)',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--amber)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                      >
                        <span style={{ color: 'var(--amber)', marginRight: '6px' }}>→</span>
                        {hint}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div key={msg.id} style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                      <span style={{
                        fontSize: '10px',
                        color: msg.role === 'user' ? 'var(--blue)' : 'var(--amber)',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontWeight: 500
                      }}>
                        {msg.role === 'user' ? 'YOU' : 'AI'}
                      </span>
                      {msg.cached && (
                        <span style={{ fontSize: '9px', color: 'var(--text3)', letterSpacing: '0.05em' }}>
                          (cached)
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--text)',
                      lineHeight: 1.6,
                      paddingLeft: '8px',
                      borderLeft: `2px solid ${msg.role === 'user' ? 'var(--blue)' : 'var(--amber)'}`
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </>
            )}
            
            {(appState === 'thinking' || appState === 'responding') && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', color: 'var(--amber)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>
                  AI
                </div>
                <div style={{ display: 'flex', gap: '4px', paddingLeft: '8px' }}>
                  <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>●</span>
                  <span style={{ animation: 'pulse 1.5s ease-in-out 0.2s infinite' }}>●</span>
                  <span style={{ animation: 'pulse 1.5s ease-in-out 0.4s infinite' }}>●</span>
                </div>
              </div>
            )}
          </div>

          {/* Status Bar */}
          {statusMessage && (
            <div style={{
              padding: '8px 20px',
              borderTop: '1px solid var(--border)',
              fontSize: '10px',
              color: 'var(--text3)',
              background: 'var(--bg)',
              fontStyle: 'italic'
            }}>
              {statusMessage}
            </div>
          )}

          {/* Input Area */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '14px 20px',
            background: 'var(--bg2)'
          }}>
            {transcript && (
              <div style={{ marginBottom: '8px', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', fontSize: '11px', color: 'var(--text2)' }}>
                🎤 {transcript}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <textarea
                rows={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={currentDocument ? "Ask anything about your documents…" : "Upload a PDF first..."}
                disabled={!currentDocument || appState === 'thinking' || appState === 'responding'}
                style={{
                  flex: 1,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  padding: '11px 14px',
                  resize: 'none',
                  maxHeight: '120px',
                  lineHeight: 1.5,
                  opacity: currentDocument ? 1 : 0.5
                }}
              />
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!currentDocument}
                style={{
                  width: '40px',
                  height: '40px',
                  background: isRecording ? 'rgba(255,0,0,0.1)' : 'transparent',
                  border: `1px solid ${isRecording ? '#ff0000' : 'var(--border)'}`,
                  color: isRecording ? '#ff0000' : 'var(--text2)',
                  cursor: currentDocument ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  opacity: currentDocument ? 1 : 0.5
                }}
                title="Push to talk"
              >🎤</button>
              <button
                onClick={handleSendMessage}
                disabled={!currentDocument || !inputValue.trim() || appState === 'thinking' || appState === 'responding'}
                style={{
                  borderColor: inputValue.trim() ? 'var(--amber)' : 'var(--border)',
                  color: inputValue.trim() ? 'var(--amber)' : 'var(--text3)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  padding: '0 14px',
                  height: '40px',
                  letterSpacing: '0.05em',
                  background: 'transparent',
                  border: '1px solid',
                  cursor: (currentDocument && inputValue.trim()) ? 'pointer' : 'not-allowed',
                  opacity: (currentDocument && inputValue.trim() && appState !== 'thinking') ? 1 : 0.5
                }}
              >ASK →</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text3)' }}>
                Shift+Enter for newline · Enter to send
              </span>
            </div>
          </div>
        </main>
      </div>

      {/* Floating Actions */}
      <AnimatePresence>
        {floatingAction && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: 'fixed',
              left: floatingAction.x,
              top: floatingAction.y,
              transform: 'translate(-50%, -100%)',
              background: 'var(--bg2)',
              border: '1px solid var(--amber)',
              borderRadius: '4px',
              padding: '6px',
              display: 'flex',
              gap: '4px',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}
          >
            {[
              { action: 'explain' as const, label: 'Explain' },
              { action: 'summarize' as const, label: 'Summarize' },
              { action: 'keypoints' as const, label: 'Key Points' }
            ].map(({ action, label }) => (
              <button
                key={action}
                onClick={() => handleQuickAction(action)}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text2)',
                  padding: '6px 10px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--amber)';
                  e.currentTarget.style.color = 'var(--amber)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text2)';
                }}
              >
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
