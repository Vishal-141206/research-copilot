/**
 * Simple Research Copilot - Actually Good UX
 * 
 * Focus: SIMPLICITY, CLARITY, SPEED
 */

import { useState, useRef, useEffect } from 'react';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { ModelCategory } from '@runanywhere/web';
import { useModelLoader } from '../hooks/useModelLoader';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function SimpleResearchCopilot() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  
  // Core state
  const [pdfText, setPdfText] = useState('');
  const [fileName, setFileName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Process PDF
  const processPDF = async (file: File) => {
    setLoading(true);
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        text += `\n\nPage ${i}:\n${pageText}`;
      }
      
      setPdfText(text);
      setMessages([{
        role: 'assistant',
        content: `✓ Loaded ${file.name} (${pdf.numPages} pages). Ask me anything!`
      }]);
    } catch (error) {
      alert('Failed to load PDF');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Ask question
  const askQuestion = async () => {
    if (!input.trim() || generating || !pdfText) return;

    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setGenerating(true);

    // Add placeholder
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      // Simple context: just use relevant parts of PDF
      const prompt = `Document:\n${pdfText.substring(0, 2000)}\n\nQuestion: ${question}\n\nAnswer:`;

      const { stream } = await TextGeneration.generateStream(prompt, {
        maxTokens: 200,
        temperature: 0.7,
      });

      let text = '';
      for await (const token of stream) {
        text += token;
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: text };
          return updated;
        });
      }
    } catch (error) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', content: 'Error generating response' };
        return updated;
      });
    } finally {
      setGenerating(false);
    }
  };

  // Check if ready
  const isReady = llmLoader.state === 'ready';

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📚</span>
            <div>
              <h1 className="text-xl font-bold text-white">AI Research Copilot</h1>
              <p className="text-xs text-slate-400">Chat with your PDFs</p>
            </div>
          </div>
          
          {isReady ? (
            <span className="text-green-400 text-sm">● Ready</span>
          ) : (
            <span className="text-yellow-400 text-sm">Loading models...</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {!pdfText ? (
          // Upload Screen
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-lg w-full text-center">
              {loading ? (
                <div>
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4" />
                  <p className="text-slate-400">Processing {fileName}...</p>
                </div>
              ) : !isReady ? (
                <div>
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4" />
                  <p className="text-slate-400">Loading AI models...</p>
                  <button
                    onClick={llmLoader.ensure}
                    className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500"
                  >
                    Load Models
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-6xl mb-6">📄</div>
                  <h2 className="text-2xl font-bold text-white mb-3">Upload a PDF</h2>
                  <p className="text-slate-400 mb-8">Drop a research paper, document, or textbook</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-500 transition-colors"
                  >
                    Choose File
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Chat Screen
          <div className="h-full flex flex-col max-w-4xl mx-auto w-full">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-800 p-4 bg-slate-900">
              <div className="flex items-center gap-3 max-w-3xl mx-auto">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && askQuestion()}
                  placeholder="Ask a question..."
                  disabled={generating}
                  className="flex-1 px-4 py-3 bg-slate-800 text-white rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  onClick={askQuestion}
                  disabled={!input.trim() || generating}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {generating ? '...' : 'Send'}
                </button>
              </div>
              
              <div className="text-center mt-3">
                <button
                  onClick={() => {
                    setPdfText('');
                    setMessages([]);
                    setFileName('');
                  }}
                  className="text-sm text-slate-400 hover:text-slate-300"
                >
                  Load different PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processPDF(file);
        }}
        className="hidden"
      />
    </div>
  );
}
