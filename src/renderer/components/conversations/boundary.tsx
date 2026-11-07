// Keeps one malformed card or block (agent-produced data) from taking the whole conversation screen down.
import { Component, type ReactNode } from 'react'
import { t } from '../../../shared/fr'

export class ContentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div data-testid="content-error" className="rounded-card border border-dashed border-line-2 px-3 py-2 text-[12.5px] text-fg-3">
        {t('thread.contentError')}
      </div>
    )
  }
}
