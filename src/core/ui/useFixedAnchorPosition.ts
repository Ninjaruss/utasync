import { useLayoutEffect, type RefObject } from 'react'

interface Options {
  gapPx?: number
  estimatedHeightPx?: number
  /** 'left' pins the panel's left edge to the anchor (full anchor width);
   * 'right' pins its right edge to the anchor's right (menu-style). */
  align?: 'left' | 'right'
}

/**
 * Pin an anchored popover to `position: fixed` so it escapes the `overflow-y`
 * scroll container it renders inside. A row tapped near the bottom of the lyric
 * list used to have its popover's lower controls clipped by the container edge;
 * `fixed` positions against the viewport instead, and flips above the anchor
 * when it would otherwise spill past the bottom edge.
 *
 * Positioning is applied imperatively (not via the className string) because it
 * depends on the anchor's measured viewport rect. Runs on every layout so the
 * panel re-pins as its content height changes.
 */
export function useFixedAnchorPosition(
  panelRef: RefObject<HTMLDivElement | null>,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  opts?: Options,
): void {
  const gap = opts?.gapPx ?? 4
  const estimatedHeightPx = opts?.estimatedHeightPx ?? 360
  const align = opts?.align ?? 'left'
  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = anchorRef?.current
    if (!panel || !anchor) return
    const rect = anchor.getBoundingClientRect()
    const fitsBelow = rect.bottom + gap + estimatedHeightPx <= window.innerHeight
    panel.style.position = 'fixed'
    if (align === 'right') {
      panel.style.left = ''
      panel.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`
      panel.style.width = ''
    } else {
      panel.style.left = `${Math.max(0, rect.left)}px`
      panel.style.right = ''
      panel.style.width = `${rect.width}px`
    }
    if (fitsBelow) {
      panel.style.top = `${rect.bottom + gap}px`
      panel.style.bottom = ''
    } else {
      panel.style.top = ''
      panel.style.bottom = `${window.innerHeight - rect.top + gap}px`
    }
  })
}
