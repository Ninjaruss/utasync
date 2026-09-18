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
const e2eParams = new URLSearchParams(location.search)
if (import.meta.env.DEV && /^[a-z0-9-]+$/.test(e2eParams.get('e2e') ?? '')) {
  // `&flow=1` renders the REAL AutoAlignFlow on a seeded song and asserts on what
  // it renders (see e2eFlowHarness) — the only way to verify a button in a browser
  // no automation can drive. Without it, the headless mirror harness runs.
  if (e2eParams.get('flow') === '1') {
    void import('./dev/e2eFlowHarness').then(({ runFlowHarness }) =>
      runFlowHarness({
        root: document.getElementById('root')!,
        songName: e2eParams.get('e2e')!,
        clickLabel: e2eParams.get('click') ?? 'segment timestamps',
        verdict: e2eParams.get('verdict') === 'unusable' ? 'unusable' : undefined,
        say: (msg) => {
          console.log(`[e2e-flow] ${msg}`)
          void fetch('/__e2e-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ browser: 'flow-harness', status: msg }),
            keepalive: true,
          }).catch(() => {})
        },
        beacon: (payload: unknown) => {
          void fetch('/__e2e-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              browser: 'flow-harness',
              ...(typeof payload === 'object' && payload !== null ? payload : { payload }),
            }),
            keepalive: true,
          }).catch(() => {})
        },
      }).catch((err) => {
        void fetch('/__e2e-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser: 'flow-harness', final: true, error: String(err?.message ?? err) }),
          keepalive: true,
        }).catch(() => {})
      }),
    )
  } else {
    void import('./dev/e2eAlignHarness').then(({ runE2eAlignHarness }) =>
      runE2eAlignHarness(document.getElementById('root')!),
    )
  }
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
