import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, readStoredCredential, setCurrentCredential, storeCredential, SSO_SKIP_KEY, UNAUTHORIZED_EVENT, type Credential } from './api'

type AuthState = {
  /** undefined = still checking the stored credential; null = logged out */
  credential: Credential | null | undefined
  login: (cred: Credential) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<Credential | null | undefined>(undefined)
  const queryClient = useQueryClient()

  // Validate the stored credential once. Only a rejected one (401/403) logs
  // out; an unreachable API keeps it so a transient outage does not cost the session.
  useEffect(() => {
    const stored = readStoredCredential()
    if (!stored) {
      setCredential(null)
      return
    }
    setCurrentCredential(stored)
    api
      .dashboard()
      .then(data => {
        queryClient.setQueryData(['dashboard'], data) // the probe doubles as the first page load
        setCredential(stored)
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          storeCredential(null)
          setCurrentCredential(null)
          setCredential(null)
        } else {
          setCredential(stored)
        }
      })
  }, [queryClient])

  const login = useCallback(
    async (cred: Credential) => {
      setCurrentCredential(cred)
      let data
      try {
        data = await api.dashboard()
      } catch (err) {
        setCurrentCredential(null)
        throw err
      }
      queryClient.setQueryData(['dashboard'], data)
      storeCredential(cred)
      setCredential(cred)
    },
    [queryClient],
  )

  const clear = useCallback(() => {
    storeCredential(null)
    setCurrentCredential(null)
    setCredential(null)
    queryClient.clear()
  }, [queryClient])

  // Sign out on purpose: the login page must then wait for the user instead
  // of signing them straight back in through single sign-on.
  const logout = useCallback(() => {
    try {
      sessionStorage.setItem(SSO_SKIP_KEY, '1')
    } catch {
      /* private mode */
    }
    clear()
  }, [clear])

  // An expired bearer token: drop it without the skip flag, so the login
  // page fetches a fresh one through single sign-on at once.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clear)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clear)
  }, [clear])

  const value = useMemo(() => ({ credential, login, logout }), [credential, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
