import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
          color: '#fff',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '500px', padding: '32px' }}>
            <div style={{
              width: 80,
              height: 80,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '2px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
              fontSize: '32px'
            }}>⚠</div>

            <h1 style={{
              fontSize: '24px',
              fontWeight: 600,
              marginBottom: '12px'
            }}>Something went wrong</h1>

            <p style={{
              color: '#888',
              fontSize: '14px',
              marginBottom: '24px',
              lineHeight: 1.6
            }}>
              Don't worry, your data is safe. This is likely a temporary issue.
            </p>

            <div style={{
              background: 'rgba(25,25,35,0.8)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              <code style={{ fontSize: '12px', color: '#ef4444' }}>
                {this.state.error?.message || 'Unknown error'}
              </code>
            </div>

            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
                border: 'none',
                color: '#fff',
                padding: '14px 32px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: 600,
                borderRadius: '10px',
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                transition: 'transform 0.15s'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              Reload Application
            </button>

            <p style={{
              color: '#555',
              fontSize: '12px',
              marginTop: '24px'
            }}>
              If this keeps happening, try clearing your browser cache.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
