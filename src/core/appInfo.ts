/** Public source repository — linked from Settings so anyone can read the code
 * they are actually running, or report against it. */
export const APP_REPO_URL = 'https://github.com/Ninjaruss/utasync'

/** UTC ISO timestamp of the running bundle.
 *
 * Injected by `define` in vite.config.ts, which evaluates `new Date()` once per
 * build, so the value identifies the version being viewed rather than whenever
 * Settings happened to be opened.
 *
 * The `typeof` guard is deliberate: `__APP_BUILD_TIME__` exists only as a
 * compile-time replacement, so a build that somehow skipped the define (or a
 * consumer that inlined this module without it) would throw a ReferenceError on
 * access and take the whole Settings view down with it. Returns '' instead. */
export function appBuildTime(): string {
  return typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : ''
}

/** Locale-formatted build time for display, e.g. "Mar 3, 2026, 4:12 PM".
 * Returns '' for a missing or unparseable timestamp, so callers render nothing
 * rather than the literal string "Invalid Date". */
export function formatAppBuildTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
