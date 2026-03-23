import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ModelCategory, AudioCapture, SpeechActivity } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { PDFUploader } from './PDFUploader';
import { DocumentStore, type Document } from '../utils/documentStore';

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  stats?: { tokens: number; tokPerSec: number; latencyMs: number };
  sources?: Array<{ docName: string; snippet: string }>;
}

type InputMode = 'text' | 'voice';

export function ResearchChatTab() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  const vadLoader = useModelLoader(ModelCategory.Audio);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const micRef = useRef<AudioCapture | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);

  // Subscribe to document changes
  useEffect(() => {
    const updateDocs = () => setDocuments(DocumentStore.getAllDocuments());
    updateDocs();
    return DocumentStore.subscribe(updateDocs);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Cleanup mic on unmount
  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
    };
  }, []);

  // Suggested questions based on documents
  const suggestedQuestions = useMemo(() => {
    if (documents.length === 0) return [];
    return [
      'Summarize the main points from my documents',
      'What are the key findings?',
      'Compare the ideas across different documents',
    ];
  }, [documents.length]);

  const buildContextPrompt = (userQuery: string): { prompt: string; sources: Array<{ docName: string; snippet: string }> } => {
    if (documents.length === 0) {
      return { prompt: userQuery, sources: [] };
    }

    const searchResults = DocumentStore.searchAllDocuments(userQuery, 2);
    
    if (searchResults.length === 0) {
      // No relevant snippets, just mention available documents
      const docList = documents.map(d => d.name).join(', ');
      return {
        prompt: `Available documents: ${docList}\n\nUser question: ${userQuery}`,
        sources: [],
      };
    }

    // Build RAG-style context
    let context = 'Relevant excerpts from uploaded documents:\n\n';
    searchResults.forEach(({ doc, snippet }, i) => {
      context += `[Document: ${doc.name}]\n${snippet}\n\n`;
    });
    context += `User question: ${userQuery}`;

    return {
      prompt: context,
      sources: searchResults.map(({ doc, snippet }) => ({ docName: doc.name, snippet })),
    };
  };

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || generating) return;

    // Ensure model is loaded
    if (llmLoader.state !== 'ready') {
      const ok = await llmLoader.ensure();
      if (!ok) return;
    }

    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setGenerating(true);

    // Build context with RAG
    const { prompt, sources } = buildContextPrompt(userText);

    // Add empty assistant message for streaming
    const assistantIdx = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', text: '', sources }]);

    try {
      const systemPrompt = documents.length > 0
        ? 'You are a research assistant. Answer questions based on the provided document excerpts. Be concise and cite specific information when relevant.'
        : 'You are a helpful research assistant. Provide clear and concise answers.';

      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(prompt, {
        maxTokens: 512,
        temperature: 0.7,
        systemPrompt,
      });
      cancelRef.current = cancel;

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', text: accumulated, sources };
          return updated;
        });
      }

      const result = await resultPromise;
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: 'assistant',
          text: result.text || accumulated,
          sources,
          stats: {
            tokens: result.tokensUsed,
            tokPerSec: result.tokensPerSecond,
            latencyMs: result.latencyMs,
          },
        };
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', text: `Error: ${msg}`, sources };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [generating, messages.length, llmLoader, documents.length]);

  const handleTextSubmit = async () => {
    const text = input.trim();
    setInput('');
    await sendMessage(text);
  };

  const handleCancel = () => {
    cancelRef.current?.();
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };

  // Voice input
  const startVoiceInput = useCallback(async () => {
    if (vadLoader.state !== 'ready' || sttLoader.state !== 'ready') {
      const results = await Promise.all([vadLoader.ensure(), sttLoader.ensure()]);
      if (!results.every(Boolean)) return;
    }

    setIsListening(true);

    const { STT } = await import('@runanywhere/web-onnx');
    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;

    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity(async (activity: SpeechActivity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          // Stop listening and transcribe
          mic.stop();
          vadUnsub.current?.();
          setIsListening(false);
          setAudioLevel(0);

          try {
            const result = await STT.transcribe(segment.samples);
            if (result.text.trim()) {
              await sendMessage(result.text);
            }
          } catch (err) {
            console.error('STT error:', err);
          }
        }
      }
    });

    await mic.start(
      (chunk) => { VAD.processSamples(chunk); },
      (level) => { setAudioLevel(level); },
    );
  }, [vadLoader, sttLoader, sendMessage]);

  const stopVoiceInput = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    setIsListening(false);
    setAudioLevel(0);
  }, []);

  const needsModels = llmLoader.state !== 'ready';
  const voiceAvailable = vadLoader.state === 'ready' && sttLoader.state === 'ready';

  return (
    <div className="tab-panel research-chat-panel">
      {needsModels && (
        <ModelBanner
          state={llmLoader.state}
          progress={llmLoader.progress}
          error={llmLoader.error}
          onLoad={llmLoader.ensure}
          label="LLM"
        />
      )}

      <div className="research-layout">
        {/* Sidebar with documents */}
        <aside className="documents-sidebar">
          <div className="sidebar-header">
            <h3>Documents ({documents.length})</h3>
            {documents.length > 0 && (
              <button
                className="btn-small"
                onClick={() => {
                  if (confirm('Clear all documents?')) {
                    DocumentStore.clearAll();
                  }
                }}
              >
                Clear
              </button>
            )}
          </div>

          <PDFUploader />

          <div className="documents-list">
            {documents.map((doc) => (
              <div key={doc.id} className="document-item">
                <div className="document-info">
                  <div className="document-name">{doc.name}</div>
                  <div className="document-meta">
                    {doc.pages} pages · {(doc.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  className="btn-icon"
                  onClick={() => DocumentStore.removeDocument(doc.id)}
                  title="Remove document"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main chat area */}
        <div className="chat-main">
          <div className="message-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="empty-state">
                <h3>Research Copilot</h3>
                <p>Upload PDFs and ask questions. All processing happens locally on your device.</p>
                
                {documents.length === 0 ? (
                  <div className="empty-hint">
                    Upload a PDF to get started
                  </div>
                ) : suggestedQuestions.length > 0 && (
                  <div className="suggested-questions">
                    <p className="suggested-label">Try asking:</p>
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        className="suggested-btn"
                        onClick={() => handleSuggestedQuestion(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`message message-${msg.role}`}>
                <div className="message-bubble">
                  <p>{msg.text || '...'}</p>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="message-sources">
                      <details>
                        <summary>Sources ({msg.sources.length})</summary>
                        {msg.sources.map((src, j) => (
                          <div key={j} className="source-item">
                            <strong>{src.docName}</strong>
                            <p className="source-snippet">{src.snippet}</p>
                          </div>
                        ))}
                      </details>
                    </div>
                  )}
                  {msg.stats && (
                    <div className="message-stats">
                      {msg.stats.tokens} tokens · {msg.stats.tokPerSec.toFixed(1)} tok/s · {msg.stats.latencyMs.toFixed(0)}ms
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="chat-input-container">
            {/* Input mode toggle */}
            <div className="input-mode-toggle">
              <button
                className={`mode-btn ${inputMode === 'text' ? 'active' : ''}`}
                onClick={() => setInputMode('text')}
                disabled={generating || isListening}
              >
                Keyboard
              </button>
              <button
                className={`mode-btn ${inputMode === 'voice' ? 'active' : ''}`}
                onClick={() => setInputMode('voice')}
                disabled={generating || !voiceAvailable}
                title={!voiceAvailable ? 'Load voice models first' : ''}
              >
                Voice
              </button>
            </div>

            {inputMode === 'text' ? (
              <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleTextSubmit(); }}>
                <input
                  type="text"
                  placeholder="Ask a question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={generating}
                />
                {generating ? (
                  <button type="button" className="btn" onClick={handleCancel}>Stop</button>
                ) : (
                  <button type="submit" className="btn btn-primary" disabled={!input.trim()}>Send</button>
                )}
              </form>
            ) : (
              <div className="voice-input">
                {isListening ? (
                  <>
                    <div className="voice-indicator" style={{ '--level': audioLevel } as React.CSSProperties}>
                      <div className="voice-wave" />
                    </div>
                    <button className="btn btn-lg" onClick={stopVoiceInput}>
                      Stop Listening
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={startVoiceInput}
                    disabled={generating}
                  >
                    Tap to Speak
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
