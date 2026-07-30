/**
 * Bancada visual do explorador Nextcloud — só desenvolvimento.
 * Rode com: `npx vite --config vite.preview.config.ts`
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import NextcloudBrowser from '../components/NextcloudBrowser';
import '../index.css';

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ padding: 16, whiteSpace: 'pre-wrap', color: '#b91c1c', fontFamily: 'monospace' }}>
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
        </pre>
      );
    }
    return <>{this.props.children}</>;
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <Boundary>
      <div className="h-screen w-screen overflow-hidden">
        <NextcloudBrowser />
      </div>
    </Boundary>,
  );
}
