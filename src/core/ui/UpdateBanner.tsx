import { useRegisterSW } from 'virtual:pwa-register/react'
import { useToast } from './Toast'

export function UpdateBanner() {
  const showToast = useToast()

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // A service worker that never registers (404 on /sw.js, a host that blocks
    // it, a CSP that refuses it) used to be completely silent: the app looked
    // normal and simply had no offline support. Surface it — console for whoever
    // is debugging, a toast for whoever is just using the app.
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed', error)
      showToast(
        'Offline mode is unavailable — the service worker failed to load. Reload the page to try again.',
        'warning',
      )
    },
    // Fires on the first install only (workbox-window reports `isUpdate: false`),
    // so this acknowledges offline support once instead of nagging on updates.
    onOfflineReady() {
      showToast('Utasync is ready to work offline.', 'info')
    },
  })

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="w-full bg-cinnabar-accent text-cinnabar-950 text-xs flex items-center justify-center gap-3 py-1.5 px-3"
    >
      <span>New version available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="underline font-medium min-h-8 px-2 rounded touch-manipulation hover:opacity-80 transition-opacity duration-150 ease-out"
      >
        Update
      </button>
    </div>
  )
}
