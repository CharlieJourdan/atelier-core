// Last line of defence: a render error anywhere in the app shows a calm French screen with a way out, never a white window.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../../shared/fr'

export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false }

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The detail goes to the console (the log), never to the screen.
    console.error('Atelier: screen crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children
    return (
      <div data-testid="crash-screen" role="alert" className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg">
        <h1 className="text-[20px] font-semibold">{t('error.title')}</h1>
        <p className="max-w-md text-[14px] text-fg-2">{t('error.crash.body')}</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-field border border-line px-4 py-2 text-[13px] hover:bg-surface-2">
          {t('error.crash.reload')}
        </button>
      </div>
    )
  }
}
