import type { LoaderState } from '../hooks/useModelLoader';

interface Props {
  state: LoaderState;
  progress: number;
  error: string | null;
  onLoad: () => void;
  label: string;
}

export function ModelBanner({ state, progress, error, onLoad, label }: Props) {
  return (
    <div className={`model-banner ${state === 'ready' ? 'model-banner-success' : ''}`}>
      {state === 'idle' && (
        <>
          <span>🔵 {label} model not loaded.</span>
          <button className="btn btn-primary" onClick={onLoad}>Load Models</button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <span>⬇️ Downloading {label} model... {(progress * 100).toFixed(0)}%</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </>
      )}
      {state === 'loading' && (
        <>
          <div className="spinner-small"></div>
          <span>⚙️ Loading {label} model into engine...</span>
        </>
      )}
      {state === 'ready' && (
        <>
          <span>✅ {label} model ready! You can now chat.</span>
        </>
      )}
      {state === 'error' && (
        <>
          <span className="error-text">❌ Error: {error}</span>
          <button className="btn btn-primary" onClick={onLoad}>Retry</button>
        </>
      )}
    </div>
  );
}
