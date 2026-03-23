/**
 * RAG Tab Component
 * 
 * Main interface for PDF-based RAG with voice support
 */

import { useState, useRef, useEffect } from 'react';
import { ModelCategory, VoicePipeline } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { DocumentStore } from '../utils/documentStore';
import { initEmbeddings } from '../utils/embeddings';

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  context?: string[];
  stats?: { tokensPerSecond?: number; totalTokens?: number };
}

export function RAGTab() {
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [embeddingsReady, setEmbeddingsReady] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Initialize embeddings model
  useEffect(() => {
    if (llmLoader.state === 'ready' && !embeddingsReady) {
      initEmbeddings((progress) => {
        console.log('Embeddings loading:', progress);
      })
        .then(() => setEmbeddingsReady(true))
        .catch((err) => console.error('Failed to load embeddings:', err));
    }
  }, [llmLoader.state, embeddingsReady]);

  const handleFileUpload = async (file: File) => {
    if (!file.type.includes('pdf')) {
      alert('Please upload a PDF file');
      return;
    }

    try {
      setProcessingStatus('Uploading PDF...');
      setProcessingProgress(0);

      // Add document
      const doc = await DocumentStore.addDocument(file, (status, progress) => {
        setProcessingStatus(status);
        setProcessingProgress(progress);
      });

      // Process for RAG
      await DocumentStore.processDocumentForRAG(doc.id, (status, progress) => {
        setProcessingStatus(status);
        setProcessingProgress(progress);
      });

      setCurrentDocId(doc.id);
      setMessages([
        {
          role: 'system',
          text: `📄 Document "${doc.name}" loaded successfully! (${doc.pages} pages, ${doc.chunks?.length || 0} chunks)\n\nYou can now ask questions about this document.`,
        },
      ]);
      setProcessingStatus('');
    } catch (err) {
      console.error('Failed to process PDF:', err);
      alert(`Error processing PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setProcessingStatus('');
    }
  };

  const handleRAGQuery = async (query: string) => {
    if (!currentDocId || !query.trim()) return;
    if (llmLoader.state !== 'ready') {
      alert('Please load the AI model first');
      return;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setGenerating(true);

    try {
      // Step 1: Retrieve relevant chunks
      const searchResults = await DocumentStore.searchDocument(currentDocId, query, 3);
      
      const context = searchResults.map((r) => r.chunk);
      const contextText = context.join('\n\n---\n\n');

      // Step 2: Generate answer with context
      const assistantIdx = messages.length + 1;
      setMessages((prev) => [...prev, { role: 'assistant', text: '💭 Searching document...', context }]);

      const prompt = `Context from the document:\n\n${contextText}\n\nQuestion: ${query}\n\nAnswer based on the context above:`;

      const { stream } = await TextGeneration.generateStream(prompt, {
        maxTokens: 300,
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        systemPrompt: 'You are a helpful research assistant. Answer questions based on the provided context. If the context does not contain relevant information, say so.',
      });

      let accumulated = '';
      let tokenCount = 0;
      const startTime = Date.now();

      for await (const token of stream) {
        accumulated += token;
        tokenCount++;

        // Update message every 50ms
        if (tokenCount % 5 === 0) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[assistantIdx] = { role: 'assistant', text: accumulated, context };
            return updated;
          });
        }
      }

      const endTime = Date.now();
      const tokensPerSecond = tokenCount / ((endTime - startTime) / 1000);

      // Final update with stats
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: 'assistant',
          text: accumulated,
          context,
          stats: { tokensPerSecond, totalTokens: tokenCount },
        };
        return updated;
      });
    } catch (err) {
      console.error('RAG query error:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ Error: ${err instanceof Error ? err.message : 'Failed to generate answer'}`,
        },
      ]);
    } finally {
      setGenerating(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
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
    // For now, we'll use a simple Web Speech API fallback
    // In production, you'd integrate with RunAnywhere's STT
    try {
      setMessages((prev) => [...prev, { role: 'user', text: '🎤 Voice input received. Please type your question for now.' }]);
      
      // TODO: Implement full Whisper integration
      // This would require proper audio processing with the RunAnywhere STT model
      
    } catch (err) {
      console.error('Voice input error:', err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'user',
          text: `⚠️ Voice input failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        };
        return updated;
      });
    }
  };

  const currentDoc = currentDocId ? DocumentStore.getDocument(currentDocId) : null;

  return (
    <div className="tab-panel rag-panel">
      <div className="rag-header">
        <h2>📚 Research Copilot</h2>
        <p>Upload a PDF and ask questions using text or voice</p>
      </div>

      {/* Model Loaders */}
      <ModelBanner
        state={llmLoader.state}
        progress={llmLoader.progress}
        error={llmLoader.error}
        onLoad={llmLoader.ensure}
        label="Language Model"
      />
      
      <ModelBanner
        state={sttLoader.state}
        progress={sttLoader.progress}
        error={sttLoader.error}
        onLoad={sttLoader.ensure}
        label="Voice Recognition (Optional)"
      />

      {/* Embeddings Status */}
      {llmLoader.state === 'ready' && (
        <div className={`status-badge ${embeddingsReady ? 'ready' : 'loading'}`}>
          {embeddingsReady ? '✅ Embeddings Ready' : '⏳ Loading Embeddings...'}
        </div>
      )}

      {/* Document Upload */}
      {!currentDoc && llmLoader.state === 'ready' && embeddingsReady && (
        <div className="upload-area">
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
          <button
            className="btn btn-primary btn-large"
            onClick={() => fileInputRef.current?.click()}
          >
            📄 Upload PDF Document
          </button>
          <p className="help-text">Upload a research paper, legal document, or any PDF</p>
        </div>
      )}

      {/* Processing Status */}
      {processingStatus && (
        <div className="processing-status">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${processingProgress * 100}%` }}
            />
          </div>
          <p>{processingStatus}</p>
        </div>
      )}

      {/* Current Document Info */}
      {currentDoc && (
        <div className="document-info">
          <div className="doc-name">
            📄 {currentDoc.name} ({currentDoc.pages} pages)
          </div>
          <button
            className="btn btn-small"
            onClick={() => {
              setCurrentDocId(null);
              setMessages([]);
              fileInputRef.current?.click();
            }}
          >
            Change Document
          </button>
        </div>
      )}

      {/* Chat Interface */}
      {currentDoc && (
        <>
          <div className="message-list" ref={listRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`message message-${msg.role}`}>
                <div className="message-bubble">
                  <p>{msg.text}</p>
                  {msg.context && msg.context.length > 0 && (
                    <details className="context-details">
                      <summary>📎 View Context ({msg.context.length} chunks)</summary>
                      {msg.context.map((chunk, j) => (
                        <div key={j} className="context-chunk">
                          {chunk}
                        </div>
                      ))}
                    </details>
                  )}
                  {msg.stats && msg.stats.tokensPerSecond && (
                    <div className="message-stats">
                      ⚡ {msg.stats.tokensPerSecond.toFixed(1)} tok/s • {msg.stats.totalTokens} tokens
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              handleRAGQuery(input);
            }}
          >
            <input
              type="text"
              placeholder="Ask a question about your document..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={generating}
            />
            
            {sttLoader.state === 'ready' && (
              <button
                type="button"
                className={`btn btn-voice ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={generating}
              >
                {isRecording ? '⏹️ Stop' : '🎤 Voice'}
              </button>
            )}
            
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!input.trim() || generating}
            >
              {generating ? '...' : 'Ask'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
