import { useEffect, useState } from 'react'

/** Whole seconds since `active` became true; returns 0 when inactive. */
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return

    const started = Date.now()
    const update = () => setElapsed(Math.floor((Date.now() - started) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [active])

  return active ? elapsed : 0
}
