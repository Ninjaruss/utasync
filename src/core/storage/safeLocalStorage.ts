import type { StateStorage } from 'zustand/middleware'

/**
 * A localStorage adapter that never throws.
 *
 * Safari private browsing throws `QuotaExceededError` on `setItem`, and older
 * private modes throw on the `window.localStorage` property access itself.
 * Zustand's default `persist` storage is unguarded, so one throwing `setItem`
 * propagates out of every store action — the exact failure the rest of the app
 * already guards (App.tsx, Onboarding.tsx, purgeStaleCoepCaches). Every
 * persisted Zustand store must pass this adapter via
 * `storage: createJSONStorage(() => safeLocalStorage)`.
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      /* Storage unavailable — the store just won't persist this session. */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* Storage unavailable. */
    }
  },
}
