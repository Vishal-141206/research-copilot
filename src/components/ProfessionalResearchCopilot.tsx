/**
 * Professional Research Copilot
 * Clean, modern, beautiful UI
 */

import { useState, useRef, useEffect } from 'react';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { ModelCategory } from '@runanywhere/web';
import { useModelLoader } from '../hooks/useModelLoader';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ProfessionalResearchCopilot() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  
  const [pdfText, setPdfText] = useState('');
  const [fileName, setFileName] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const processPDF = async (file: File) => {
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
      }
      
      setPdfText(text);
      setFileName(file.name);
      setPageCount(pdf.numPages);
      setMessages([{ 
        role: 'assistant', 
        content: `I've read "${file.name}" (${pdf.numPages} pages). What would you like to know?` 
      }]);
    } catch (error) {
      alert('Failed to process PDF');
    } finally {
      setLoading(false);
    }
  };

  const askQuestion = async () => {
    if (!input.trim() || generating) return;

    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setGenerating(true);

    const idx = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const context = pdfText.substring(0, 3000);
      const prompt = `Document: ${context}\n\nQuestion: ${question}\n\nAnswer:`;

      const { stream } = await TextGeneration.generateStream(prompt, {
        maxTokens: 250,
        temperature: 0.7,
      });

      let text = '';
      for await (const token of stream) {
        text += token;
        setMessages(prev => {
          const updated = [...prev];
          updated[idx] = { role: 'assistant', content: text };
          return updated;
        });
      }
    } catch (error) {
      setMessages(prev => {
        const updated = [...prev];
        updated[idx] = { role: 'assistant', content: 'Sorry, something went wrong.' };
        return updated;
      });
    } finally {
      setGenerating(false);
    }
  };

  const ready = llmLoader.state === 'ready';

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              AI
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">Research Copilot</span>
          </div>
          {ready && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              Ready
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        {!pdfText ? (
          // Upload State
          <div className="h-full flex items-center justify-center px-6">
            <div className="max-w-md w-full">
              {!ready ? (
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/20 rounded-2xl mb-6">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">
                    Loading AI Models
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    This takes about 30 seconds on first load
                  </p>
                  <button
                    onClick={llmLoader.ensure}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Start Loading
                  </button>
                </div>
              ) : loading ? (
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/20 rounded-2xl mb-6">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
                    Processing PDF
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    Reading {fileName}...
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-6">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">
                    Upload a Document
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-8">
                    Upload a PDF to start asking questions
                  </p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Choose PDF
                  </button>
                  <p className="mt-6 text-sm text-gray-500 dark:text-gray-500">
                    Everything runs locally in your browser
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Chat State
          <div className="h-full flex flex-col">
            {/* Document Info */}
            <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-6 py-3">
              <div className="max-w-3xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{fileName}</div>
                    <div className="text-xs text-gray-500">{pageCount} pages</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setPdfText('');
                    setMessages([]);
                  }}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                    }`}>
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
              <form onSubmit={(e) => { e.preventDefault(); askQuestion(); }} className="max-w-3xl mx-auto">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question about your document..."
                    disabled={generating}
                    className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 border-0 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || generating}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
                  >
                    {generating ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      'Send'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

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
