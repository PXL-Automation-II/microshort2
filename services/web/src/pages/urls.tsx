import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states'
import { api } from '@/lib/api'
import type { ShortUrl } from '@/lib/types'
import { fmtDate, nf } from '@/lib/format'

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// Where focus goes when a dialog closes: back to the button that opened it,
// or to the page title when that row is gone (WCAG 2.4.3).
function returnFocus(trigger: HTMLElement | null) {
  if (trigger && trigger.isConnected) trigger.focus()
  else document.getElementById('page-title')?.focus()
}

export function UrlsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebounced(q, 300)
  const queryClient = useQueryClient()
  const searchId = useId()
  const trigger = useRef<HTMLElement | null>(null)

  const query = useInfiniteQuery({
    queryKey: ['urls', search],
    queryFn: ({ pageParam }) => api.urls(search, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.nextCursor,
    placeholderData: prev => prev,
  })
  const urls = query.data?.pages.flatMap(p => p.urls ?? []) ?? []
  const busy = query.isFetching

  const [editing, setEditing] = useState<ShortUrl | null>(null)
  const [deleting, setDeleting] = useState<ShortUrl | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['urls'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const update = useMutation({
    mutationFn: ({ slug, url }: { slug: string; url: string }) => api.updateUrl(slug, url),
    onSuccess: (_d, v) => {
      toast.success(`${v.slug} now points to ${v.url}`)
      setEditing(null)
      invalidate()
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'Update failed'),
  })

  const remove = useMutation({
    mutationFn: (slug: string) => api.deleteUrl(slug),
    onSuccess: (_d, slug) => {
      toast.success(`${slug} deleted`)
      setDeleting(null)
      invalidate()
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  })

  const setQ = (value: string) => setParams(value ? { q: value } : {}, { replace: true })

  return (
    <>
      <PageHeader title="URLs" count={urls.length ? `${nf.format(urls.length)}${query.hasNextPage ? '+' : ''} shown` : undefined}>
        <div className="relative">
          <Label htmlFor={searchId} className="sr-only">
            Search by slug or destination
          </Label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          <Input id={searchId} type="search" placeholder="Search slug or destination…" value={q} onChange={e => setQ(e.target.value)} className="w-64" style={{ paddingLeft: '30px' }} />
        </div>
        <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && query.refetch()}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      {query.error && <ErrorState error={query.error} what="URLs" onRetry={() => query.refetch()} />}
      {query.isPending && !query.error && <TableSkeleton cols={6} />}

      {query.data && urls.length === 0 && (
        <EmptyState
          title={search ? `No URLs match "${search}"` : 'No URLs yet'}
          actions={
            search ? (
              <Button variant="secondary" size="sm" onClick={() => setQ('')}>
                Clear search
              </Button>
            ) : undefined
          }
        >
          {search ? undefined : (
            <>
              Create one with <code>POST /urls</code> and an API key.
            </>
          )}
        </EmptyState>
      )}

      {urls.length > 0 && (
        <div aria-busy={busy}>
          <Table>
            <TableCaption className="sr-only">Short URLs, newest first</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Slug</TableHead>
                <TableHead scope="col">Destination</TableHead>
                <TableHead scope="col" className="num">Clicks</TableHead>
                <TableHead scope="col">Owner</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col" className="col-actions">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {urls.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="mono">
                    <a href={u.shortUrl} target="_blank" rel="noopener noreferrer">
                      {u.slug}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </TableCell>
                  <TableCell className="cell-truncate" title={u.longUrl}>
                    {u.longUrl}
                  </TableCell>
                  <TableCell className="num">{nf.format(u.clicks)}</TableCell>
                  <TableCell className="cell-truncate" style={{ maxWidth: '18ch' }} title={u.userEmail}>
                    {u.userEmail ?? u.userId}
                  </TableCell>
                  <TableCell className="mono whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                  <TableCell className="col-actions">
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Edit ${u.slug}`}
                      onClick={e => {
                        trigger.current = e.currentTarget
                        setEditing(u)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      className="btn-danger-outline"
                      aria-label={`Delete ${u.slug}`}
                      onClick={e => {
                        trigger.current = e.currentTarget
                        setDeleting(u)
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {query.hasNextPage && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <Button variant="secondary" size="sm" aria-disabled={query.isFetchingNextPage || undefined} onClick={() => !query.isFetchingNextPage && query.fetchNextPage()}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <EditDialog
        url={editing}
        onClose={() => setEditing(null)}
        onSave={(slug, url) => update.mutate({ slug, url })}
        busy={update.isPending}
        onClosed={() => returnFocus(trigger.current)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent
          onCloseAutoFocus={e => {
            e.preventDefault()
            returnFocus(trigger.current)
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.slug}?</AlertDialogTitle>
            <AlertDialogDescription>
              The short link <code>{deleting?.shortUrl}</code> will stop working immediately and its click history is removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={e => {
                e.preventDefault()
                if (deleting) remove.mutate(deleting.slug)
              }}
            >
              {remove.isPending ? 'Deleting…' : `Delete ${deleting?.slug ?? ''}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function EditDialog({
  url,
  onClose,
  onSave,
  busy,
  onClosed,
}: {
  url: ShortUrl | null
  onClose: () => void
  onSave: (slug: string, url: string) => void
  busy: boolean
  onClosed: () => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputId = useId()
  useEffect(() => {
    setValue(url?.longUrl ?? '')
    setError('')
  }, [url])

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = value.trim()
    if (!/^https?:\/\//i.test(v)) {
      setError('Enter an http:// or https:// URL.')
      return
    }
    if (url) onSave(url.slug, v)
  }

  return (
    <Dialog open={url !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault()
          onClosed()
        }}
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Edit destination of {url?.slug}</DialogTitle>
            <DialogDescription>Visitors of {url?.shortUrl} will be sent to the new address. Cached copies on the redirect service refresh within its cache TTL.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-1">
            <Label htmlFor={inputId}>Destination URL</Label>
            <Input id={inputId} type="url" value={value} onChange={e => setValue(e.target.value)} autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-err` : undefined} />
            <p id={`${inputId}-err`} className="field-error-msg" role="alert">
              {error}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" aria-disabled={busy || !url || value.trim() === url.longUrl || undefined} onClick={e => (busy || (url && value.trim() === url.longUrl)) && e.preventDefault()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
