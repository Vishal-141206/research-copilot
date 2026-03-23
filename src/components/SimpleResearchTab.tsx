import { useState, useRef, useEffect } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  stats?: { tokensPerSecond?: number; totalTokens?: number };
  cached?: boolean;
}

// Simple query cache for instant responses
const queryCache = new Map<string, string>();

export function SimpleResearchTab() {
  const llmLoader = useModelLoader(ModelCategory.Language);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [fastMode, setFastMode] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const batchBuffer = useRef<string>('');
  const updateTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const updateMessageBatched = (index: number, text: string) => {
    batchBuffer.current = text;
    
    if (updateTimer.current) return;
    
    updateTimer.current = setTimeout(() => {
      setMessages(prev => {
        const updated = [...prev];
        updated[index] = { role: 'assistant', text: batchBuffer.current };
        return updated;
      });
      updateTimer.current = null;
    }, 50); // Update every 50ms instead of per-token
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || generating) return;

    if (llmLoader.state !== 'ready') {
      alert('Please click "Load Models" first and wait for the ✅ green banner');
      return;
    }

    setInput('');
    
    // Check cache first (instant response!)
    const cacheKey = text.toLowerCase();
    if (queryCache.has(cacheKey)) {
      const cached = queryCache.get(cacheKey)!;
      setMessages(prev => [
        ...prev, 
        { role: 'user', text },
        { role: 'assistant', text: cached, cached: true }
      ]);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', text }]);
    setGenerating(true);

    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', text: '💭' }]);

    try {
      const maxTokens = fastMode ? 50 : 100;
      
      const { stream, result } = await TextGeneration.generateStream(text, {
        maxTokens,
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        systemPrompt: fastMode 
          ? 'Answer in 1 short sentence only. Be extremely concise.'
          : 'Answer in 2-3 sentences. Be concise but informative.'
      });

      let accumulated = '';
      let tokenCount = 0;
      const startTime = Date.now();
      
      for await (const token of stream) {
        accumulated += token;
        tokenCount++;
        
        // Batch updates for smoother performance
        updateMessageBatched(assistantIdx, accumulated);
      }

      // Clear any pending update
      if (updateTimer.current) {
        clearTimeout(updateTimer.current);
        updateTimer.current = null;
      }

      const endTime = Date.now();
      const tokensPerSecond = tokenCount / ((endTime - startTime) / 1000);
      
      // Final update with stats
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { 
          role: 'assistant', 
          text: accumulated,
          stats: { tokensPerSecond, totalTokens: tokenCount }
        };
        return updated;
      });

      // Cache the response
      queryCache.set(cacheKey, accumulated);

      await result;
    } catch (err) {
      console.error('Generation error:', err);
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { 
          role: 'assistant', 
          text: `⚠️ Error: ${err instanceof Error ? err.message : 'Failed. Try again.'}` 
        };
        return updated;
      });
    } finally {
      setGenerating(false);
      batchBuffer.current = '';
    }
  };

  const quickPrompts = [
    'What is AI?',
    'Explain machine learning',
    'Benefits of privacy',
    'How does this work?'
  ];

  return (
    <div className="tab-panel chat-panel">
      <ModelBanner
        state={llmLoader.state}
        progress={llmLoader.progress}
        error={llmLoader.error}
        onLoad={llmLoader.ensure}
        label="AI Model"
      />

      {llmLoader.state === 'ready' && (
        <div className="speed-controls">
          <label className="speed-toggle">
            <input 
              type="checkbox" 
              checked={fastMode} 
              onChange={(e) => setFastMode(e.target.checked)}
            />
            <span>⚡ Fast Mode (1 sentence answers)</span>
          </label>
        </div>
      )}

      <div className="message-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <h3>🚀 AI Research Assistant</h3>
            <p>Powered by RunAnywhere SDK - 100% Local & Private</p>
            <p style={{ fontSize: '13px', color: '#4CAF50', marginTop: '16px' }}>
              ✅ All AI processing happens on your device
            </p>
            
            {llmLoader.state === 'ready' && (
              <div className="quick-prompts">
                <p style={{ fontSize: '12px', color: '#888', marginTop: '24px' }}>Quick start:</p>
                {quickPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    className="quick-prompt-btn"
                    onClick={() => setInput(prompt)}
                  >
                    {prompt}
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
              {msg.cached && (
                <div className="message-stats" style={{ color: '#4CAF50' }}>
                  ⚡ Instant (cached)
                </div>
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

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        <input
          type="text"
          placeholder={fastMode ? "Ask anything (fast mode)..." : "Ask me anything..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
          autoFocus
        />
        <button 
          type="submit" 
          className="btn btn-primary" 
          disabled={!input.trim() || generating}
        >
          {generating ? '...' : '⚡ Send'}
        </button>
      </form>
    </div>
  );
}
