import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { DemoAdminUnavailable } from './DemoAdminUnavailable'
import './style.css'

const DevelopmentAdminApp = import.meta.env.DEV
  ? lazy(() => import('./DemoAdminApp').then(({ DemoAdminApp }) => ({ default: DemoAdminApp })))
  : null

function RootApp() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/admin') {
    if (!DevelopmentAdminApp) return <DemoAdminUnavailable />
    return <Suspense fallback={<main className="demo-admin-main" aria-live="polite">Loading demo admin controls…</main>}><DevelopmentAdminApp /></Suspense>
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)
