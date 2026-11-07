// The Atelier mark, drawn for this app: a set square with a circle inside (the "workbench" motif).
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--surface-2)" stroke="var(--line-3)" />
      <path d="M9 8v15h15" stroke="var(--fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 23 23 9v14z" stroke="var(--fg)" strokeWidth="1.4" strokeLinejoin="round" opacity=".5" />
      <circle cx="18.5" cy="18.5" r="3.2" stroke="var(--brand)" strokeWidth="1.6" />
    </svg>
  )
}
