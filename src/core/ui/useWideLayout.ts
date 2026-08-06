import { useEffect, useState } from 'react'

/** Sidebar layout: wide enough for a desktop split, OR short-and-wide — a phone
 * held sideways. Landscape is the case this exists for: stacking a header, a
 * toolbar and a control dock down a 360px-tall viewport left under one lyric
 * row visible, while the same controls fit comfortably beside the lyrics. */
const QUERY = '(min-width: 768px), (max-height: 520px) and (min-width: 560px)'

export function useWideLayout(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(QUERY).matches
  })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QUERY)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return matches
}
