import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusDot } from '@/components/status-dot'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states'
import { api } from '@/lib/api'
import { fmtDate, nf } from '@/lib/format'

export function UsersPage() {
  const query = useInfiniteQuery({
    queryKey: ['users'],
    queryFn: ({ pageParam }) => api.users(pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.nextCursor,
  })
  const users = query.data?.pages.flatMap(p => p.users ?? []) ?? []

  return (
    <>
      <PageHeader title="Users" count={users.length ? `${nf.format(users.length)}${query.hasNextPage ? '+' : ''} shown` : undefined}>
        <Button variant="secondary" size="sm" aria-disabled={query.isFetching || undefined} onClick={() => !query.isFetching && query.refetch()}>
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      {query.error && <ErrorState error={query.error} what="users" onRetry={() => query.refetch()} />}
      {query.isPending && !query.error && <TableSkeleton cols={5} />}

      {query.data && users.length === 0 && <EmptyState title="No users yet">The first account to register becomes the admin.</EmptyState>}

      {users.length > 0 && (
        <div aria-busy={query.isFetching}>
          <Table>
            <TableCaption className="sr-only">Users, newest first</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Email</TableHead>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col" className="num">URLs</TableHead>
                <TableHead scope="col">Registered</TableHead>
                <TableHead scope="col" className="num">ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link to={`/users/${u.id}`}>{u.email}</Link>
                  </TableCell>
                  <TableCell>
                    <StatusDot tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role === 'admin' ? 'Admin' : 'User'}</StatusDot>
                  </TableCell>
                  <TableCell className="num">{nf.format(u.urlCount ?? 0)}</TableCell>
                  <TableCell className="mono whitespace-nowrap">{fmtDate(u.createdAt)}</TableCell>
                  <TableCell className="num row-muted">{u.id}</TableCell>
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
    </>
  )
}
