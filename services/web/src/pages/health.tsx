import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusDot, type Tone } from '@/components/status-dot'
import { ErrorState, PageHeader } from '@/components/states'
import { api } from '@/lib/api'
import type { ServiceStatus } from '@/lib/types'
import { fmtDate } from '@/lib/format'

const INTERVAL = 30_000
const STATUS: Record<ServiceStatus, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'success' },
  unhealthy: { label: 'Degraded', tone: 'warning' },
  unreachable: { label: 'Unreachable', tone: 'danger' },
}

export function HealthPage() {
  const [auto, setAuto] = useState(true)
  const [, setTick] = useState(0)
  const switchId = useId()

  // The timer belongs to this page: unmounting (navigation, sign-out) stops
  // polling, and the tab being hidden pauses it.
  const query = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: auto ? INTERVAL : false, refetchIntervalInBackground: false })

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [auto])

  const secondsLeft = query.dataUpdatedAt && auto ? Math.max(0, Math.round((query.dataUpdatedAt + INTERVAL - Date.now()) / 1000)) : null
  const services = query.data?.services ?? []
  const worst: Tone = services.some(s => s.status === 'unreachable') ? 'danger' : services.some(s => s.status === 'unhealthy') ? 'warning' : 'success'
  const busy = query.isFetching

  return (
    <>
      <PageHeader title="System status">
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={auto} onCheckedChange={setAuto} />
          <Label htmlFor={switchId}>Auto-refresh</Label>
          {/* The countdown is decoration beside the switch, not part of its name. */}
          {auto && secondsLeft !== null && (
            <span className="form-hint" style={{ marginTop: 0 }} aria-hidden="true">
              next in {secondsLeft} s
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && query.refetch()}>
          {busy ? 'Checking…' : 'Check now'}
        </Button>
      </PageHeader>

      {query.error && <ErrorState error={query.error} what="service health" onRetry={() => query.refetch()} />}
      {query.isPending && !query.error && <Skeleton className="h-40" />}

      {query.data && (
        <>
          {/* Not a live region: it would re-announce on every 30 s refresh. */}
          <div className={`status-box${worst === 'danger' ? ' tone-danger' : worst === 'warning' ? ' tone-warning' : ''}`}>
            <span className={`status-dot dot-${worst}`} aria-hidden="true" />
            <div className="status-box-body">
              <p className="status-box-title">
                {worst === 'success' ? 'Every service answered' : worst === 'warning' ? 'A service is degraded' : 'A service is unreachable'}
              </p>
              <p>
                Probed by the api service at {fmtDate(query.data.checkedAt)} UTC.
                {services.length <= 2 && (
                  <>
                    {' '}
                    Only api and its database are probed; set <code>HEALTH_TARGETS=redirect=http://…,web=http://…</code> on the api service to include the others.
                  </>
                )}
              </p>
            </div>
          </div>

          <Table>
            <TableCaption className="sr-only">Services and their status</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Service</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="num">Response</TableHead>
                <TableHead scope="col">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map(s => {
                const meta = STATUS[s.status] ?? STATUS.unreachable
                return (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <StatusDot tone={meta.tone}>{meta.label}</StatusDot>
                    </TableCell>
                    <TableCell className="num mono">{s.responseTimeMs} ms</TableCell>
                    <TableCell className="row-muted">{s.error ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}
    </>
  )
}
