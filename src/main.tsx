import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { requestPersistence } from './core/storage/quota'
import { purgeStaleCoepCaches } from './core/pwa/purgeStaleCoepCaches'
import { ToastProvider } from './core/ui/Toast'
import { ErrorBoundary } from './core/ui/ErrorBoundary'

requestPersistence()
void purgeStaleCoepCaches()

// Dev-only self-driving alignment E2E (see src/dev/e2eAlignHarness.ts):
// /?e2e=<song> runs the real align pipeline headlessly in THIS browser against
// assets staged under public/e2e/<song>.* and renders a truth scorecard —
// usable from browsers no automation can drive (Firefox). The dynamic import
// keeps it out of the production bundle.
if (import.meta.env.DEV && /^[a-z0-9-]+$/.test(new URLSearchParams(location.search).get('e2e') ?? '')) {
  void import('./dev/e2eAlignHarness').then(({ runE2eAlignHarness }) =>
    runE2eAlignHarness(document.getElementById('root')!),
  )
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}
