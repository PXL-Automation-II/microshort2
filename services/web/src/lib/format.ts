// Every timestamp in the dashboard is shown in UTC, matching the api's daily
// click aggregation; the layout says so once in the footer.
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

export const weekday = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })

export const nf = new Intl.NumberFormat('en-GB')
