import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'

/** Where something stands, in place of the data (DESIGN.md §4 status box). */
export function ErrorState({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const message = error instanceof Error ? error.message : String(error)
  const unreachable = error instanceof ApiError && error.unreachable
  return (
    <div className="status-box tone-danger" role="alert">
      <span className="status-dot dot-danger" aria-hidden="true" />
      <div className="status-box-body">
        <p className="status-box-title">Could not load {what}</p>
        <p>{message}</p>
        {unreachable && <p>Check that the api service is running and that the dashboard's API_BASE_URL points at it.</p>}
        {onRetry && (
          <div className="status-box-actions">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-body">{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-6 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function PageHeader({ title, count, children }: { title: ReactNode; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title" tabIndex={-1} id="page-title">
        {title}
        {count !== undefined && count !== null && (
          <>
            {' '}
            <span className="count" aria-live="polite">
              {count}
            </span>
          </>
        )}
      </h1>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}
