import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/status-dot'
import { ErrorState, PageHeader } from '@/components/states'
import { api } from '@/lib/api'

// One setting, shown as a value with Edit beside it (DESIGN.md §1.8: a
// derived value is stated, not asked for). The input appears only on Edit.
export function ConfigPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['config'], queryFn: api.config })
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const inputId = useId()
  const editButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (query.data && !editing) setValue(query.data.publicBaseUrl)
  }, [query.data, editing])

  // Leaving the editor hands focus back to Edit (WCAG 2.4.3).
  const closeEditor = () => {
    setEditing(false)
    setError('')
    queueMicrotask(() => editButton.current?.focus())
  }

  const save = useMutation({
    mutationFn: (publicBaseUrl: string) => api.setConfig(publicBaseUrl),
    onSuccess: data => {
      queryClient.setQueryData(['config'], data)
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      closeEditor()
      toast.success(`Short links now use ${data.publicBaseUrl}`, { description: 'Until this api instance restarts.' })
    },
    onError: err => setError(err instanceof Error ? err.message : 'Could not change it'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = value.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+$/i.test(v)) {
      setError('A base URL looks like https://sho.rt, without a path.')
      return
    }
    setError('')
    save.mutate(v)
  }

  function cancel() {
    if (query.data) setValue(query.data.publicBaseUrl)
    closeEditor()
  }

  const overridden = query.data?.source === 'runtime-override'

  return (
    <>
      <PageHeader title="Configuration" />

      {query.error && <ErrorState error={query.error} what="the configuration" onRetry={() => query.refetch()} />}
      {query.isPending && !query.error && <Skeleton className="h-16" />}

      {query.data && (
        <div className="settings">
          <div className="settings-row">
            <div className="settings-label">
              <span>Short link base URL</span>
              <small>
                Links look like <code>{query.data.publicBaseUrl}/abc123</code>
              </small>
            </div>

            {!editing ? (
              <>
                <div className="settings-value">
                  <code>{query.data.publicBaseUrl}</code>
                  {overridden ? <StatusDot tone="warning">Changed here, until restart</StatusDot> : <StatusDot tone="neutral">From the deployment</StatusDot>}
                </div>
                <div className="settings-actions">
                  {overridden && (
                    <Button variant="ghost" size="sm" onClick={() => save.mutate(query.data!.envValue)} disabled={save.isPending}>
                      Use deployment value
                    </Button>
                  )}
                  <Button ref={editButton} variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={submit} className="settings-edit" noValidate>
                <Label htmlFor={inputId} className="sr-only">
                  Short link base URL
                </Label>
                <Input
                  id={inputId}
                  type="url"
                  value={value}
                  autoFocus
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && cancel()}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${inputId}-help${error ? ` ${inputId}-err` : ''}`}
                />
                <p id={`${inputId}-help`} className="form-hint">
                  Takes effect on this api instance now and is forgotten when it restarts. The permanent value is <code>PUBLIC_BASE_URL</code> in the deployment.
                </p>
                {error && (
                  <p id={`${inputId}-err`} className="field-error-msg" role="alert">
                    {error}
                  </p>
                )}
                <div className="settings-actions">
                  <Button type="submit" size="sm" disabled={save.isPending || value.trim().replace(/\/+$/, '') === query.data.publicBaseUrl}>
                    {save.isPending ? 'Applying…' : 'Apply'}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
