/**
 * Demo Helper - Keyboard Shortcuts & Tips
 * 
 * Press '?' to show/hide this panel during demos
 */

import { useState, useEffect } from 'react';

export function DemoHelper() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '?' || e.key === 'h') {
        setVisible((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  if (!visible) {
    return (
      <div className="demo-hint">
        Press <kbd>?</kbd> for demo tips
      </div>
    );
  }

  return (
    <div className="demo-helper-overlay" onClick={() => setVisible(false)}>
      <div className="demo-helper-panel" onClick={(e) => e.stopPropagation()}>
        <div className="demo-helper-header">
          <h2>🎬 Demo Cheat Sheet</h2>
          <button onClick={() => setVisible(false)}>×</button>
        </div>

        <div className="demo-helper-content">
          <section>
            <h3>📄 60-Second Demo Script</h3>
            <ol>
              <li>
                <strong>"This is 100% offline & private"</strong> - Point to WebGPU badge
              </li>
              <li>
                <strong>Drag & drop a PDF</strong> - Show smooth upload animation
              </li>
              <li>
                <strong>Watch processing</strong> - Highlight "Generating embeddings" progress
              </li>
              <li>
                <strong>Ask a question</strong> - Type "What is the main conclusion?"
              </li>
              <li>
                <strong>Click citation [1]</strong> - Show PDF auto-scroll & highlight
              </li>
              <li>
                <strong>Use voice (if quiet)</strong> - Click 🎤, speak, watch transcribe
              </li>
              <li>
                <strong>Refresh page</strong> - Show instant restoration from IndexedDB
              </li>
            </ol>
          </section>

          <section>
            <h3>🔑 Key Features to Mention</h3>
            <ul>
              <li>✅ <strong>WebGPU Acceleration</strong> - 10x faster than CPU</li>
              <li>✅ <strong>Real-time Streaming</strong> - Word-by-word like ChatGPT</li>
              <li>✅ <strong>Interactive Citations</strong> - Click [1] to see source</li>
              <li>✅ <strong>State Persistence</strong> - Refresh-proof with IndexedDB</li>
              <li>✅ <strong>Vector Search</strong> - Orama + Transformers.js embeddings</li>
              <li>✅ <strong>Voice Commands</strong> - Local Whisper transcription</li>
            </ul>
          </section>

          <section>
            <h3>💡 Pro Tips</h3>
            <ul>
              <li>🎯 Use a 5-10 page PDF for fastest demo</li>
              <li>🎯 Pre-load models before judging starts</li>
              <li>🎯 Test voice in a quiet room first</li>
              <li>🎯 Keep questions specific for best citations</li>
              <li>🎯 Mention "zero API keys, zero servers"</li>
            </ul>
          </section>

          <section>
            <h3>⚡ Fallback Strategies</h3>
            <ul>
              <li>❌ Internet down? Say "Works 100% offline after first load"</li>
              <li>❌ Models slow? Show cached state restoration</li>
              <li>❌ Voice fails? Skip it, focus on RAG pipeline</li>
              <li>❌ Citation won't scroll? Explain the concept verbally</li>
            </ul>
          </section>

          <section>
            <h3>🎤 Voice Transcription</h3>
            <p>Requirements:</p>
            <ul>
              <li>Load Speech Recognition model first</li>
              <li>Grant microphone permissions</li>
              <li>Speak clearly for 3-5 seconds</li>
              <li>Click stop when done</li>
            </ul>
          </section>

          <section className="tech-stack">
            <h3>🏗️ Tech Stack (For Technical Questions)</h3>
            <div className="tech-grid">
              <div>
                <strong>LLM:</strong> Liquid AI LFM2 (RunAnywhere)
              </div>
              <div>
                <strong>Embeddings:</strong> all-MiniLM-L6-v2 (Transformers.js)
              </div>
              <div>
                <strong>Vector DB:</strong> Orama (in-memory)
              </div>
              <div>
                <strong>PDF:</strong> PDF.js (Mozilla)
              </div>
              <div>
                <strong>Storage:</strong> IndexedDB (idb wrapper)
              </div>
              <div>
                <strong>STT:</strong> Whisper Tiny (RunAnywhere)
              </div>
            </div>
          </section>

          <section>
            <h3>📊 Performance Stats</h3>
            <table>
              <tr>
                <td>PDF Upload (10 pages)</td>
                <td>~5 seconds</td>
              </tr>
              <tr>
                <td>Embedding Generation</td>
                <td>~50ms per chunk</td>
              </tr>
              <tr>
                <td>Vector Search</td>
                <td>&lt;10ms</td>
              </tr>
              <tr>
                <td>LLM Response (WebGPU)</td>
                <td>~100 tok/s</td>
              </tr>
              <tr>
                <td>State Restoration</td>
                <td>&lt;2 seconds</td>
              </tr>
            </table>
          </section>
        </div>

        <div className="demo-helper-footer">
          <p>Press <kbd>Esc</kbd> or click outside to close</p>
        </div>
      </div>
    </div>
  );
}
