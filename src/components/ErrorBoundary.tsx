import React from 'react';

interface ErrorBoundaryState {
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { errorMessage: error?.message || 'Unexpected application error' };
  }

  override render() {
    if (this.state.errorMessage) {
      return (
        <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#111827] border border-rose-500/40 rounded-lg p-6 space-y-4">
            <h1 className="text-lg font-semibold text-white">Application Error</h1>
            <p className="text-xs font-mono text-rose-300 bg-[#080C13] border border-slate-800 rounded p-3 break-all max-h-48 overflow-auto">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
            >
              Reload PAAS WIVER
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
