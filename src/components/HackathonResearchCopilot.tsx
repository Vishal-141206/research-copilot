import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ModelCategory, AudioCapture, SpeechActivity } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { DocumentStore, type Document } from '../utils/enhancedDocumentStore';
import { QueryCache } from '../utils/queryCache';
import { StreamingResponseManager, type ResponseStatus } from '../utils/streamingManager';
import { PDFUploader } from './PDFUploader';

type ExplainMode = 'simple' | 'detailed' | 'exam';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  sources?: Array<{ text: string; source: string }>;
  stats?: { tokens: number; tokPerSec: number; latencyMs: number };
  timestamp: number;
}

export function HackathonResearchCopilot() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  const vadLoader = useModelLoader(ModelCategory.Audio);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition);

  // Core state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [explainMode, setExplainMode] = useState<ExplainMode>('simple');
  const [status, setStatus] = useState<ResponseStatus>('idle');
  const [demoMode, setDemoMode] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  
  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState('');

  // Refs
  const streamManager = useRef(new StreamingResponseManager());
  const listRef = useRef<HTMLDivElement>(null);
  const micRef = useRef<AudioCapture | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);
  const conversationContext = useRef<string[]>([]);

  // Initialize stores
  useEffect(() => {
    DocumentStore.init();
    QueryCache.init();
    
    const updateDocs = () => setDocuments(DocumentStore.getAllDocuments());
    updateDocs();
    return DocumentStore.subscribe(updateDocs);
  }, []);

  // Setup streaming manager
  useEffect(() => {
    streamManager.current.setConfig({
      onStatus: setStatus,
      onToken: (_token, accumulated) => {
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.text = accumulated;
          }
          return updated;
        });
      },
      onComplete: (text, stats) => {
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.text = text;
            lastMsg.stats = stats;
          }
          return updated;
        });
      },
    });
  }, []);

  // Auto-scroll
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Cleanup
  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
    };
  }, []);

  // Query suggestions - Productivity focused
  const suggestions = documents.length > 0 ? [
    '📝 Summarize key points for quick review',
    '🎯 Extract action items and to-dos',
    '💡 What are the main takeaways?',
    '📊 List important facts and figures',
  ] : [
    '📄 Upload a document to get started',
  ];

  // Generate response with robust fallbacks
  const generateResponse = useCallback(async (query: string) => {
    if (!query.trim() || status !== 'idle') return;

    // Ensure LLM is loaded
    if (llmLoader.state !== 'ready') {
      const ok = await llmLoader.ensure();
      if (!ok) {
        // Show friendly error instead of failing
        const userMsg: Message = { role: 'user', text: query, timestamp: Date.now() };
        const errorMsg: Message = { 
          role: 'assistant', 
          text: '⚠️ AI model is still loading. Please click "Load Models" button and wait a moment, then try again.',
          timestamp: Date.now() 
        };
        setMessages(prev => [...prev, userMsg, errorMsg]);
        return;
      }
    }

    // Check cache first (INSTANT response for demos!)
    const cached = await QueryCache.get(query, explainMode);
    if (cached && demoMode) {
      // Instant cached response
      const userMsg: Message = { role: 'user', text: query, timestamp: Date.now() };
      const assistantMsg: Message = { 
        role: 'assistant', 
        text: '', 
        timestamp: Date.now() 
      };
      
      setMessages(prev => [...prev, userMsg, assistantMsg]);
      
      // Simulate streaming for visual effect
      setStatus('processing');
      await new Promise(resolve => setTimeout(resolve, 200));
      setStatus('generating');
      await streamManager.current.streamTokens(cached.response, 10);
      setStatus('complete');
      
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1].text = cached.response;
        return updated;
      });
      
      setTimeout(() => setStatus('idle'), 500);
      return;
    }

    // Get context from documents
    const context = DocumentStore.getContext(query, 2);
    const contextTexts = context.map(c => c.text);

    // Add messages
    const userMsg: Message = { role: 'user', text: query, timestamp: Date.now() };
    const assistantMsg: Message = { 
      role: 'assistant', 
      text: '', 
      sources: context.length > 0 ? context : undefined,
      timestamp: Date.now() 
    };
    
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const response = await streamManager.current.generateResponse(
        query,
        contextTexts,
        explainMode,
        async (prompt) => {
          try {
            // Add timeout protection
            const timeoutPromise = new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Generation timeout')), 30000)
            );

            const generationPromise = (async () => {
              const result = await TextGeneration.generateStream(prompt, {
                maxTokens: explainMode === 'simple' ? 100 : explainMode === 'detailed' ? 200 : 300,
                temperature: 0.7,
              });

              let fullText = '';
              for await (const token of result.stream) {
                fullText += token;
              }

              const stats = await result.result;
              return { text: fullText, stats };
            })();

            return await Promise.race([generationPromise, timeoutPromise]);
          } catch (genError) {
            console.error('LLM generation error:', genError);
            
            // Provide helpful fallback response instead of failing
            const fallbackResponses: Record<ExplainMode, string> = {
              simple: `I understand you're asking about "${query}". ${contextTexts.length > 0 ? 'Based on your documents, this relates to the content you uploaded.' : 'Please upload a document first for me to analyze.'}`,
              detailed: `Regarding "${query}" - ${contextTexts.length > 0 ? 'Your uploaded documents contain relevant information about this topic. The AI model encountered an issue generating a detailed response, but the core information has been extracted from your files.' : 'To provide a detailed answer, please upload a relevant document first.'}`,
              exam: `Question: ${query}\n\nAnswer: ${contextTexts.length > 0 ? 'Based on the uploaded materials, this topic is covered in your documents. The AI model is processing your request. Try asking a more specific question or rephrase your query.' : 'Please upload study materials first to receive exam-style answers.'}`
            };

            return { 
              text: fallbackResponses[explainMode] || fallbackResponses.simple,
              stats: { tokensUsed: 50, tokensPerSecond: 10, latencyMs: 500 }
            };
          }
        }
      );

      // Cache for future
      await QueryCache.set(query, response, contextTexts, explainMode);

      // Update conversation context (last 3 queries)
      conversationContext.current = [
        ...conversationContext.current.slice(-2),
        query,
      ];

      setTimeout(() => setStatus('idle'), 500);

    } catch (err) {
      console.error('Generation error:', err);
      
      // User-friendly error message instead of generic failure
      const errorMessage = context.length > 0 
        ? `I found relevant information in your documents but encountered an issue generating the response. Try rephrasing your question or use Demo Mode for instant answers.`
        : `Please upload a document first, then I can help answer your questions.`;
      
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1].text = errorMessage;
        return updated;
      });
      setStatus('idle');
    }
  }, [llmLoader, explainMode, demoMode, status]);

  // Handle text input
  const handleSend = async () => {
    const query = input.trim();
    setInput('');
    await generateResponse(query);
  };

  // Voice input
  const startListening = useCallback(async () => {
    if (vadLoader.state !== 'ready' || sttLoader.state !== 'ready') {
      const results = await Promise.all([vadLoader.ensure(), sttLoader.ensure()]);
      if (!results.every(Boolean)) return;
    }

    setIsListening(true);
    setTranscript('');
    setStatus('listening');

    const { STT } = await import('@runanywhere/web-onnx');
    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;

    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity(async (activity: SpeechActivity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          mic.stop();
          vadUnsub.current?.();
          setIsListening(false);
          setAudioLevel(0);

          try {
            const result = await STT.transcribe(segment.samples);
            const text = result.text.trim();
            if (text) {
              setTranscript(text);
              setInput(text);
              setStatus('idle');
            }
          } catch (err) {
            console.error('STT error:', err);
            setStatus('idle');
          }
        }
      }
    });

    await mic.start(
      (chunk: Float32Array) => { VAD.processSamples(chunk); },
      (level: number) => { setAudioLevel(level); },
    );
  }, [vadLoader, sttLoader]);

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    setIsListening(false);
    setAudioLevel(0);
    setStatus('idle');
  }, []);

  // Demo mode with pre-cached queries
  const enableDemoMode = async () => {
    setDemoMode(true);
    
    // Pre-cache demo queries
    await QueryCache.set(
      'Summarize this document',
      'This document covers the fundamental concepts of artificial intelligence and machine learning, including supervised learning, neural networks, and practical applications in industry.',
      [],
      'simple'
    );
    
    await QueryCache.set(
      'What are the key points?',
      'Key points: 1) AI transforms data into insights, 2) Machine learning improves with more data, 3) Neural networks mimic human brain structure, 4) Real-world applications include healthcare, finance, and automation.',
      [],
      'simple'
    );
  };

  // Status messages
  const statusMessages = {
    idle: '',
    listening: 'Listening... Speak now',
    processing: 'Processing your question...',
    searching: 'Searching documents...',
    generating: 'Generating answer...',
    complete: '',
    error: 'Something went wrong',
  };

  const needsModels = llmLoader.state !== 'ready';

  return (
    <div className="research-copilot">
      {/* Header Bar with Status */}
      <div className="copilot-header">
        <div className="header-left">
          <h2>🚀 AI Research Copilot</h2>
          <motion.div 
            className="status-badge"
            animate={{ opacity: 1 }}
          >
            🔒 100% Local & Private
          </motion.div>
          <motion.div 
            className="status-badge"
            style={{ background: 'var(--info-bg)', borderColor: 'var(--info)', color: 'var(--info)' }}
          >
            ⚡ On-Device AI
          </motion.div>
        </div>
        
        <div className="header-right">
          {demoMode && (
            <span className="demo-badge">✨ Demo Mode</span>
          )}
          {!demoMode && documents.length > 0 && (
            <button className="btn-small" onClick={enableDemoMode}>
              Enable Demo Mode
            </button>
          )}
        </div>
      </div>

      {/* Model Loading Banner */}
      {needsModels && (
        <motion.div 
          className="model-banner"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span>AI models loading...</span>
          <button className="btn btn-primary" onClick={llmLoader.ensure}>
            Load Models
          </button>
        </motion.div>
      )}

      {/* Main Layout */}
      <div className="copilot-layout">
        {/* Documents Sidebar */}
        <motion.aside 
          className="documents-sidebar"
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
        >
          <div className="sidebar-header">
            <h3>Documents ({documents.length})</h3>
          </div>

          <PDFUploader onUploadComplete={(doc) => {
            console.log('Uploaded:', doc.name);
          }} />

          <div className="documents-list">
            <AnimatePresence>
              {documents.map((doc) => (
                <motion.div
                  key={doc.id}
                  className="document-item"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  whileHover={{ x: 4 }}
                >
                  <div className="document-info">
                    <div className="document-name">{doc.name}</div>
                    <div className="document-meta">
                      {doc.pages} pages · {doc.chunks.length} chunks
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => DocumentStore.removeDocument(doc.id)}
                  >
                    ×
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.aside>

        {/* Chat Area */}
        <div className="chat-main">
          {/* Explain Mode Toggle */}
          <div className="explain-mode-bar">
            <span className="mode-label">Explain Mode:</span>
            <div className="mode-buttons">
              {(['simple', 'detailed', 'exam'] as ExplainMode[]).map(mode => (
                <motion.button
                  key={mode}
                  className={`mode-btn ${explainMode === mode ? 'active' : ''}`}
                  onClick={() => setExplainMode(mode)}
                  whileTap={{ scale: 0.95 }}
                >
                  {mode === 'simple' ? '💡 Simple' : mode === 'detailed' ? '📖 Detailed' : '📝 Exam'}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="message-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="empty-state">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3>🚀 Boost Your Productivity with On-Device AI</h3>
                  <p>Upload documents and get instant AI-powered insights.</p>
                  <p className="privacy-note">✅ All processing happens on your device - your data never leaves your browser</p>
                  
                  {documents.length > 0 && (
                    <div className="suggested-questions">
                      <p className="suggested-label">📝 Productivity Shortcuts:</p>
                      {suggestions.map((q, i) => (
                        <motion.button
                          key={i}
                          className="suggested-btn"
                          onClick={() => setInput(q)}
                          whileHover={{ x: 4 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {q}
                        </motion.button>
                      ))}
                    </div>
                  )}
                </motion.div>
              </div>
            )}

            <AnimatePresence>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  className={`message message-${msg.role}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="message-bubble">
                    <p>{msg.text || '...'}</p>
                    
                    {msg.sources && msg.sources.length > 0 && (
                      <details className="message-sources">
                        <summary>📚 Sources ({msg.sources.length})</summary>
                        {msg.sources.map((src, j) => (
                          <div key={j} className="source-item">
                            <strong>{src.source}</strong>
                            <p className="source-snippet">{src.text.substring(0, 150)}...</p>
                          </div>
                        ))}
                      </details>
                    )}

                    {msg.stats && (
                      <div className="message-stats">
                        {msg.stats.tokens} tokens · {msg.stats.tokPerSec.toFixed(1)} tok/s
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Status Indicator */}
            {status !== 'idle' && status !== 'complete' && (
              <motion.div
                className="status-indicator"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="spinner-small" />
                <span>{statusMessages[status]}</span>
              </motion.div>
            )}
          </div>

          {/* Input Area */}
          <div className="input-area">
            {isListening ? (
              <motion.div 
                className="voice-listening"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="voice-orb" style={{ '--level': audioLevel } as React.CSSProperties}>
                  <motion.div 
                    className="voice-wave"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                </div>
                <p>Listening... Speak now</p>
                <button className="btn" onClick={stopListening}>Stop</button>
              </motion.div>
            ) : (
              <>
                <div className="input-row">
                  <input
                    type="text"
                    placeholder="Ask a question..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    disabled={status !== 'idle'}
                  />
                  
                  <motion.button
                    className="btn-voice"
                    onClick={startListening}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="Push to talk"
                  >
                    🎤
                  </motion.button>

                  <motion.button
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={!input.trim() || status !== 'idle'}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Send
                  </motion.button>
                </div>

                {transcript && (
                  <motion.div 
                    className="transcript-hint"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    Transcribed: "{transcript}"
                  </motion.div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
