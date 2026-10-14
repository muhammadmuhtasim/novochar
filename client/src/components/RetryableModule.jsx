import React, { Component, lazy, Suspense, useMemo } from 'react';

/** Load a split feature with a local error boundary and an explicit retry path. */
export default function RetryableModule({ loader, label, componentProps = {} }) {
  const Feature = useMemo(() => lazy(loader), [loader]);

  return (
    <ModuleErrorBoundary
      onRetry={() => window.location.reload()}
      label={label}
    >
      <Suspense fallback={<div className="module-loading" role="status">{label}</div>}>
        <Feature {...componentProps} />
      </Suspense>
    </ModuleErrorBoundary>
  );
}

class ModuleErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="module-error" role="alert">
          <p>{this.props.label.replace(/^Loading /, 'Could not load ')}</p>
          <p className="module-error-detail">The feature failed to load. Check your connection, then retry.</p>
          <div className="module-error-actions">
            <button className="btn primary sm" onClick={this.props.onRetry}>Retry feature</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
