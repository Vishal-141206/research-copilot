import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initSDK } from './runanywhere';

// Lazy load the massive app component to reduce initial JS payload
const HackathonWinner = lazy(() => import('./components/HackathonWinner').then(m => ({ default: m.HackathonWinner })));

export function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState(false);

  useEffect(() => {
    // initSDK() is now handled globally in main.tsx for zero-latency boot.
    // We just wait a tiny bit to ensure the singleton is resolving.
    const timer = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Premium loading screen
  if (!ready) {
    return (
      <div style={{
        height: '100vh',
        background: '#0f0f0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 20px',
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              border: '3px solid #6366f1',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 700,
              color: '#6366f1'
            }}>AI</span>
          </div>
          <p style={{ color: '#666', fontSize: '14px' }}>Loading Research Copilot...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Graceful error handling - still show app
  return (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ height: '100vh', background: '#0f0f0f' }} />}>
        <HackathonWinner />
      </Suspense>
    </ErrorBoundary>
  );
}
