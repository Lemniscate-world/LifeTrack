import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--font, sans-serif)' }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              padding: '6px 16px', borderRadius: 4, border: 'none',
              background: '#8b5cf6', color: 'white', cursor: 'pointer', fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
