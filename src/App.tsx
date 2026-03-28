import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy load the massive app component to reduce initial JS payload
const HackathonWinner = lazy(() => import('./components/HackathonWinner').then(m => ({ default: m.HackathonWinner })));

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<AppShellFallback />}>
        <HackathonWinner />
      </Suspense>
    </ErrorBoundary>
  );
}

function AppShellFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'radial-gradient(circle at top, rgba(44, 180, 146, 0.16), transparent 32%), linear-gradient(180deg, #08110f 0%, #050809 58%, #020303 100%)',
      color: '#f4efe6',
      fontFamily: '"Space Grotesk", system-ui, sans-serif',
      padding: 24,
    }}>
      <div style={{
        width: 'min(980px, 100%)',
        borderRadius: 32,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(135deg, rgba(8,16,14,0.92), rgba(10,21,18,0.82))',
        boxShadow: '0 28px 80px rgba(0,0,0,0.45)',
        padding: '32px 32px 28px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          inset: 'auto -80px -100px auto',
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255, 176, 78, 0.22), rgba(255, 176, 78, 0))',
          filter: 'blur(10px)',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, marginBottom: 40 }}>
          <div>
            <div style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8cd3bc', marginBottom: 12 }}>
              Local AI Workspace
            </div>
            <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 4rem)', lineHeight: 1, margin: 0, fontFamily: '"Instrument Serif", Georgia, serif', fontWeight: 400 }}>
              Research Copilot
            </h1>
            <p style={{ margin: '14px 0 0', maxWidth: 520, color: 'rgba(244,239,230,0.68)', fontSize: 16, lineHeight: 1.6 }}>
              Opening the fast path first. Heuristic analysis is ready immediately while local AI services warm in the background.
            </p>
          </div>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: 24,
            background: 'linear-gradient(145deg, rgba(44,180,146,0.95), rgba(255,176,78,0.95))',
            display: 'grid',
            placeItems: 'center',
            color: '#06110f',
            fontSize: 22,
            fontWeight: 700,
            boxShadow: '0 18px 40px rgba(44,180,146,0.28)',
          }}>
            RC
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {['Instant document triage', 'Background local model warmup', 'Offline-by-default privacy'].map((item, index) => (
            <div key={item} style={{
              borderRadius: 18,
              padding: '16px 18px',
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.03)',
              color: 'rgba(244,239,230,0.78)',
              fontSize: 14,
            }}>
              <div style={{ color: '#ffb04e', fontSize: 12, marginBottom: 8 }}>0{index + 1}</div>
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
