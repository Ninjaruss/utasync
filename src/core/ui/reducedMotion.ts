/**
 * True when the user has asked their system for reduced motion.
 *
 * The CSS media query in index.css cannot help with programmatic scrolling:
 * `scrollIntoView({ behavior: 'smooth' })` passes an explicit behavior, which
 * wins over `scroll-behavior: auto`. Callers that animate from JS have to ask.
 *
 * Read at call time rather than cached — the preference can change mid-session,
 * and this is only ever consulted on a user-visible transition.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
