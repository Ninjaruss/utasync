import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches uncaught render errors so a single component failure shows a branded
 * fallback instead of blanking the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled UI error:', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-[100dvh] bg-cinnabar-950 text-white flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</p>
          <h1 className="text-lg font-semibold text-balance">Something went wrong</h1>
          <p className="text-white/55 text-sm text-pretty">
            An unexpected error interrupted the app. Your saved songs are safe — reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 px-5 rounded-xl bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white font-semibold text-sm touch-manipulation transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
