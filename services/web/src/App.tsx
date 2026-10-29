import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Layout } from '@/components/layout'
import { useAuth } from '@/lib/auth'
import { LoginPage } from '@/pages/login'
import { UsersPage } from '@/pages/users'
import { UserDetailPage } from '@/pages/user-detail'
import { UrlsPage } from '@/pages/urls'
import { ConfigPage } from '@/pages/config'
import { HealthPage } from '@/pages/health'
import { Skeleton } from '@/components/ui/skeleton'

// The dashboard pulls in the charting library; load it on demand so the
// login page and the tables do not pay for it.
const DashboardPage = lazy(() => import('@/pages/dashboard').then(m => ({ default: m.DashboardPage })))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { credential } = useAuth()
  const location = useLocation()
  if (credential === undefined) {
    return (
      <div className="p-6" role="status" aria-label="Checking session">
        <Skeleton className="h-10 w-64" />
      </div>
    )
  }
  if (!credential) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

export default function App() {
  const { credential } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={credential ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<Skeleton className="h-28" />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="urls" element={<UrlsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="status" element={<HealthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
