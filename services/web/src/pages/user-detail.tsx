import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusDot } from '@/components/status-dot'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states'
import { api } from '@/lib/api'
import { fmtDate, nf } from '@/lib/format'

export function UserDetailPage() {
  const { id } = useParams()
  const userId = Number(id)
  const valid = Number.isInteger(userId) && userId > 0
  const query = useQuery({ queryKey: ['user', userId], queryFn: () => api.user(userId), enabled: valid })

  useEffect(() => {
    if (query.data) document.title = `${query.data.user.email} · microshort admin`
  }, [query.data])

  return (
    <>
      <div style={{ marginBottom: 'var(--space-sm)' }}>
        <Button variant="ghost" size="sm" asChild style={{ marginLeft: '-9px' }}>
          <Link to="/users">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Users
          </Link>
        </Button>
      </div>
      <PageHeader title={query.data ? query.data.user.email : `User ${id}`}>
        <Button variant="secondary" size="sm" aria-disabled={query.isFetching || !valid || undefined} onClick={() => valid && !query.isFetching && query.refetch()}>
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      {!valid && <ErrorState error={new Error('The address does not name a user')} what="this user" />}
      {query.error && <ErrorState error={query.error} what="this user" onRetry={() => query.refetch()} />}
      {query.isPending && !query.error && valid && <TableSkeleton cols={3} />}

      {query.data && (
        <>
          <div className="summary-grid">
            <Card className="summary-card">
              <span className="stat-label">Role</span>
              <span className="stat-value" style={{ fontSize: '1rem' }}>
                <StatusDot tone={query.data.user.role === 'admin' ? 'info' : 'neutral'}>{query.data.user.role === 'admin' ? 'Admin' : 'User'}</StatusDot>
              </span>
            </Card>
            <Card className="summary-card">
              <span className="stat-label">Registered (UTC)</span>
              <span className="stat-value mono" style={{ fontSize: '1rem' }}>
                {fmtDate(query.data.user.createdAt)}
              </span>
            </Card>
            <Card className="summary-card">
              <span className="stat-label">User ID</span>
              <span className="stat-value" style={{ fontSize: '1rem' }}>
                {query.data.user.id}
              </span>
            </Card>
          </div>

          <section aria-labelledby="keys-heading" style={{ marginBottom: 'var(--space-lg)' }}>
            <h2 id="keys-heading" className="section-title">
              API keys <span className="count">{query.data.apiKeys.length}</span>
            </h2>
            {query.data.apiKeys.length === 0 ? (
              <EmptyState title="No API keys" />
            ) : (
              <Table>
                <TableCaption className="sr-only">API keys of this user</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Name</TableHead>
                    <TableHead scope="col">Prefix</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Created</TableHead>
                    <TableHead scope="col">Last used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.apiKeys.map(k => (
                    <TableRow key={k.id} className={k.revokedAt ? 'row-muted' : ''}>
                      <TableCell>{k.name}</TableCell>
                      <TableCell className="mono">{k.keyPrefix}…</TableCell>
                      <TableCell>
                        {k.revokedAt ? <StatusDot tone="neutral">Revoked {fmtDate(k.revokedAt)}</StatusDot> : <StatusDot tone="success">Active</StatusDot>}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap">{fmtDate(k.createdAt)}</TableCell>
                      <TableCell className="mono whitespace-nowrap">{fmtDate(k.lastUsedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="urls-heading">
            <h2 id="urls-heading" className="section-title">
              URLs <span className="count">{query.data.urls.length}</span>
            </h2>
            {query.data.urls.length === 0 ? (
              <EmptyState title="No URLs" />
            ) : (
              <Table>
                <TableCaption className="sr-only">Short URLs of this user</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Slug</TableHead>
                    <TableHead scope="col">Destination</TableHead>
                    <TableHead scope="col" className="num">Clicks</TableHead>
                    <TableHead scope="col">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.urls.map(u => (
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
                      <TableCell className="mono whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </>
  )
}
