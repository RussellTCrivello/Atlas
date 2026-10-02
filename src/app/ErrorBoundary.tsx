// What the person sees when a screen crashes or the first load fails.
import React from 'react'
import { EmptyState } from '../ui/primitives'
import { Logo } from '../ui/icons'

export class ErrorBoundary extends React.Component<{ children: any; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: any) {
    console.error('Render error:', error, info?.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-content" role="alert">
        <EmptyState
          title="This page could not be displayed"
          message="Something unexpected went wrong while drawing this screen. Your data is safe. Try again, or go back to the overview."
        />
        <div className="error-actions">
          <button type="button" className="secondary-button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              window.location.hash = '/overview'
              this.setState({ error: null })
            }}
          >
            Go to overview
          </button>
        </div>
        <details className="error-details">
          <summary>Technical details</summary>
          <pre translate="no">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
        </details>
      </div>
    )
  }
}

export function LoadErrorScreen({ message, onRetry, onLogout }) {
  return (
    <div className="loading-screen" role="alert">
      <Logo />
      <strong>Atlas could not load your workspace</strong>
      <span>{message}</span>
      <div className="error-actions">
        <button type="button" className="primary-button" onClick={onRetry}>
          Try again
        </button>
        {onLogout && (
          <button type="button" className="secondary-button" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
