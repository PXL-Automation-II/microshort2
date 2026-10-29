import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModeToggle } from '@/components/mode-toggle'
import { useAuth } from '@/lib/auth'
import { api, ApiError, SSO_SKIP_KEY } from '@/lib/api'
import { apiBaseUrlLabel } from '@/lib/config'

// 'probing': asking the api which sign-in methods exist (and, when single
// sign-on is on, exchanging the proxy's identity for a token).
// 'sso' / 'key': what the page shows once that is known.
type Mode = 'probing' | 'sso' | 'key'

function readSkipFlag() {
  try {
    return sessionStorage.getItem(SSO_SKIP_KEY) === '1'
  } catch {
    return false
  }
}
function clearSkipFlag() {
  try {
    sessionStorage.removeItem(SSO_SKIP_KEY)
  } catch {
    /* private mode */
  }
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('probing')
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [ssoError, setSsoError] = useState('')
  const [busy, setBusy] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    document.title = 'Sign in · microshort admin'
  }, [])

  // Exchange the identity the trusted proxy attached to this request for the
  // api's own token. 401 means the proxy session is gone (or the proxy is not
  // in front of this path): reloading the page sends the browser back through
  // the identity provider.
  const signInWithSso = useCallback(
    async ({ reloadOn401 }: { reloadOn401: boolean }) => {
      setBusy(true)
      setSsoError('')
      try {
        const result = await api.ssoLogin()
        await login({ kind: 'token', value: result.token })
        clearSkipFlag()
        navigate(from, { replace: true })
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && reloadOn401) {
          window.location.reload()
          return
        }
        if (err instanceof ApiError && err.status === 403) setSsoError('You are signed in, but your account is not an admin.')
        else if (err instanceof ApiError && err.status === 401) setSsoError('No single sign-on session was found. Sign in again to start one.')
        else setSsoError(err instanceof Error ? err.message : 'Single sign-on failed.')
        setMode('sso')
      } finally {
        setBusy(false)
      }
    },
    [from, login, navigate],
  )

  useEffect(() => {
    let cancelled = false
    api
      .providers()
      .then(p => {
        if (cancelled) return
        if (!p.sso) {
          setMode('key')
          return
        }
        if (readSkipFlag()) {
          setMode('sso') // the user just signed out: wait for a click
          return
        }
        void signInWithSso({ reloadOn401: false })
      })
      .catch(() => {
        if (!cancelled) setMode('key')
      })
    return () => {
      cancelled = true
    }
  }, [signInWithSso])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!key.trim()) {
      setError('Enter your API key.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await login({ kind: 'apiKey', value: key.trim() })
      clearSkipFlag()
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('That API key was not recognised.')
      else if (err instanceof ApiError && err.status === 403) setError('This API key is valid, but its user is not an admin.')
      else setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="login-utilities">
        <ModeToggle />
      </div>
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <img src="/logo.svg" alt="" className="hero-logo" />
            <h1 className="login-title">microshort admin</h1>
            <CardDescription>
              {mode === 'sso' ? 'Sign in with your organisation account, or with an admin API key.' : 'Sign in with an API key that belongs to an admin user.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === 'probing' && (
              <p role="status" aria-live="polite" className="form-hint">
                Checking how to sign in…
              </p>
            )}
            {mode === 'sso' && (
              <div className="space-y-4">
                <Button
                  type="button"
                  className="w-full"
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    clearSkipFlag()
                    void signInWithSso({ reloadOn401: true })
                  }}
                >
                  {busy ? 'Signing in…' : 'Sign in with single sign-on'}
                </Button>
                <div id="sso-error" role="alert" aria-live="assertive" className="field-error-msg">
                  {ssoError}
                </div>
              </div>
            )}
            {mode !== 'probing' && (
              <form onSubmit={onSubmit} className={mode === 'sso' ? 'mt-6 space-y-4' : 'space-y-4'} noValidate>
                <div className="space-y-1">
                  <Label htmlFor="api-key">Admin API key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    autoFocus={mode === 'key'}
                    placeholder="msh_…"
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                </div>
                <div id="login-error" role="alert" aria-live="assertive" className="field-error-msg">
                  {error}
                </div>
                <Button type="submit" variant={mode === 'sso' ? 'outline' : 'default'} className="w-full" aria-disabled={busy || undefined}>
                  {busy && mode === 'key' ? 'Checking…' : 'Sign in with API key'}
                </Button>
                <p className="form-hint">
                  API: <code>{apiBaseUrlLabel}</code>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
