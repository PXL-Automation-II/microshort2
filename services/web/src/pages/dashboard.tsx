import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState, PageHeader } from '@/components/states'
import { api } from '@/lib/api'
import { nf, weekday } from '@/lib/format'

const chartConfig = { clicks: { label: 'Clicks', color: 'var(--accent-blue)' } } satisfies ChartConfig

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="summary-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{nf.format(value)}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </Card>
  )
}

export function DashboardPage() {
  const { data, error, isPending, isFetching, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard })

  return (
    <>
      <PageHeader title="Dashboard">
        <Button variant="secondary" size="sm" aria-disabled={isFetching || undefined} onClick={() => !isFetching && refetch()}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      {error && <ErrorState error={error} what="the dashboard" onRetry={() => refetch()} />}

      {isPending && !error && (
        <div className="summary-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="summary-grid">
            <Stat label="Users" value={data.users.total} sub={`${data.users.recentSignups} new this week · ${data.users.admins} admin`} />
            <Stat label="Active API keys" value={data.users.totalApiKeys} />
            <Stat label="Short URLs" value={data.urls.total} sub={`${data.urls.recentUrls} created this week`} />
            <Stat label="Total clicks" value={data.urls.totalClicks} />
            <Stat label="Clicks today" value={data.clicks.today} sub="UTC day" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Clicks, last 7 days</CardTitle>
                <CardDescription>Per UTC day, from the click events the redirect service reported.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={chartConfig}
                  className="h-52 w-full"
                  role="img"
                  aria-label={`Clicks per day: ${data.clicks.last7Days.map(d => `${weekday(d.day)} ${d.day.slice(5)}: ${d.clicks}`).join(', ')}`}
                >
                  {/* The container carries the accessible name; the SVG stays out of the tree. */}
                  <BarChart accessibilityLayer={false} data={data.clicks.last7Days.map(d => ({ ...d, label: `${weekday(d.day)} ${d.day.slice(5)}` }))}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="clicks" fill="var(--color-clicks)" radius={3} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top URLs</CardTitle>
                <CardDescription>By total clicks</CardDescription>
              </CardHeader>
              <CardContent>
                {data.urls.top.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No URLs yet.
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {data.urls.top.map(u => (
                      <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                        <Link to={`/urls?q=${encodeURIComponent(u.slug)}`} className="mono truncate" title={u.longUrl}>
                          {u.slug}
                        </Link>
                        <span className="num" style={{ color: 'var(--text-muted)' }}>
                          {nf.format(u.clicks)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="form-hint" style={{ marginTop: 'var(--space-md)' }}>
            Short URLs are built from <code>{data.publicBaseUrl}</code>.
          </p>
        </>
      )}
    </>
  )
}
