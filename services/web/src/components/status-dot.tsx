// A status dot with plain mixed-case text (DESIGN.md §1.3, §4). Never a pill.
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export function StatusDot({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className="status-indicator" title={title}>
      <span className={`status-dot dot-${tone}`} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
