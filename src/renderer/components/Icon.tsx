// Small stroke icons drawn for Atelier.
import type { ViewId } from '../../shared/api'

const PATHS: Record<ViewId | 'settings', string> = {
  chats: 'M4 5h16v10H9l-5 4z',
  dashboard: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  content: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  approvals: 'M5 12l4 4 10-10M4 20h16',
  computer: 'M3 5h18v11H3zM8 20h8M12 16v4',
  spend: 'M12 3v18M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H6',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'
}

export function Icon({ name, size = 20 }: { name: ViewId | 'settings'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
