import React from 'react'

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return <main className="fatal-error"><h1>应用遇到问题</h1><p>{(this.state.error as Error).message}</p><button onClick={() => window.location.reload()}>重新载入</button></main>
    return this.props.children
  }
}
