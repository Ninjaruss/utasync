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
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 8
      const top = (viewport?.offsetTop ?? 0) + 8
      const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16)
      const height = Math.max(0, (viewport?.height ?? window.innerHeight) - 16)
      panel.style.position = 'fixed'
      panel.style.maxWidth = `${width}px`
      panel.style.maxHeight = `${height}px`
      panel.style.overflowY = 'auto'
      panel.style.width = align === 'left' ? `${Math.min(rect.width, width)}px` : ''
      const measured = panel.getBoundingClientRect()
      const panelHeight = measured.height || Math.min(estimatedHeightPx, height)
      const panelWidth = measured.width || Math.min(rect.width, width)
      const below = rect.bottom + gap
      const preferredTop = below + panelHeight <= top + height ? below : rect.top - gap - panelHeight
      panel.style.top = `${Math.max(top, Math.min(preferredTop, top + height - panelHeight))}px`
      panel.style.left = `${Math.max(left, Math.min(align === 'right' ? rect.right - panelWidth : rect.left, left + width - panelWidth))}px`
      panel.style.bottom = ''
      panel.style.right = ''
    }
    place()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    observer?.observe(panel)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  })
}
