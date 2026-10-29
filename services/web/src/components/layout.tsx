import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'
import { useAuth } from '@/lib/auth'
import { apiBaseUrlLabel } from '@/lib/config'

export const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/users', label: 'Users', end: false },
  { to: '/urls', label: 'URLs', end: false },
  { to: '/config', label: 'Config', end: false },
  // /health, /ready and /metrics are the server's ops endpoints (contract §5),
  // so the page lives at /status.
  { to: '/status', label: 'Health', end: false },
]

// The one app bar (DESIGN.md §6): brand on the left, the section tabs as
// Primer underline tabs centred on the window, the utilities on the right.
export function Layout() {
  const { logout } = useAuth()
  const location = useLocation()
  const headerRef = useRef<HTMLElement>(null)

  // Page title and focus follow the route (SPA pattern for 2.4.2 / 2.4.3).
  // A page that names its own subject (a user's detail) sets the title itself.
  useEffect(() => {
    const item = NAV.find(n => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))
    document.title = `${item?.label ?? 'Admin'} · microshort admin`
    document.getElementById('page-title')?.focus({ preventScroll: true })
  }, [location.pathname])

  // The sticky bar's height feeds scroll-padding-top, so nothing focused
  // from below is scrolled in underneath it (the bar is taller once the tabs
  // wrap onto their own row).
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--header-height', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header" ref={headerRef}>
        <div className="container app-header-bar">
          <div className="app-header-left">
            <NavLink to="/" className="app-header-title app-header-brand" aria-label="microshort admin home">
              <img src="/logo.svg" alt="" width="24" height="24" className="header-logo" />
              microshort admin
            </NavLink>
          </div>
          <nav aria-label="Sections" className="app-header-center app-header-switch">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `primer-tab${isActive ? ' active' : ''}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="app-header-right">
            <ModeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="container" style={{ paddingTop: 'var(--space-lg)', paddingBottom: 'var(--space-lg)' }} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="container page-foot">
        All times UTC · API <code>{apiBaseUrlLabel}</code>
      </footer>
    </>
  )
}
