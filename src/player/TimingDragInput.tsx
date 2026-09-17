import { useLayoutEffect, useRef, type PointerEvent } from 'react'

interface Props {
  min: number
  max: number
  value: number
  step: number
  label: string
  lowerBound?: number
  onChange: (value: number) => void
  onWindowChange: (min: number, max: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

/** A keyboard-accessible range whose pointer geometry matches the waveform.
 * Pointer capture keeps dragging outside the box; holding at an edge pans time.
 * Native range thumbs have browser-dependent hit areas and cannot pan their range.
 */
export function TimingDragInput(props: Props) {
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const gesture = useRef<{
    id: number; left: number; width: number; x: number
    min: number; max: number; lastTime: number; moved: boolean; value: number
  } | null>(null)
  const frame = useRef<number | null>(null)

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    gesture.current = null
  }
  useLayoutEffect(() => stop, [])

  const updateValue = () => {
    const g = gesture.current
    if (!g || g.width <= 0) return
    const p = latest.current
    const fraction = Math.max(0, Math.min(1, (g.x - g.left) / g.width))
    const raw = g.min + fraction * (g.max - g.min)
    const value = Math.max(p.lowerBound ?? 0, Math.round(raw / p.step) * p.step)
    const rounded = Number(value.toFixed(3))
    if (rounded !== g.value) {
      g.value = rounded
      p.onChange(rounded)
    }
  }

  const pan = (now: number) => {
    const g = gesture.current
    if (!g) return
    const dt = Math.min(50, now - g.lastTime) / 1000
    g.lastTime = now
    // A small inside-edge zone lets a finger pan even on a narrow phone screen.
    const edge = Math.min(16, g.width * 0.08)
    const x = g.x - g.left
    const direction = x <= edge ? -1 : x >= g.width - edge ? 1 : 0
    if (g.moved && direction && g.width > 0) {
      const shift = Math.max(
        (latest.current.lowerBound ?? 0) - g.min,
        direction * (g.max - g.min) * 0.4 * dt,
      )
      if (shift !== 0) {
        g.min += shift
        g.max += shift
        latest.current.onWindowChange(g.min, g.max)
        updateValue()
      }
    }
    frame.current = requestAnimationFrame(pan)
  }

  const finish = (e: PointerEvent<HTMLInputElement>) => {
    if (gesture.current?.id !== e.pointerId) return
    stop()
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    latest.current.onDragEnd?.()
  }

  return <input
    type="range"
    min={props.min}
    max={props.max}
    step={props.step}
    value={props.value}
    aria-label={props.label}
    aria-valuetext={`${props.value.toFixed(2)} seconds`}
    className="absolute inset-0 m-0 w-full h-full opacity-0 cursor-ew-resize touch-none"
    onChange={(e) => props.onChange(Number(e.target.value))}
    onPointerDown={(e) => {
      if (e.button !== 0 || gesture.current) return
      e.preventDefault()
      e.currentTarget.focus({ preventScroll: true })
      const rect = e.currentTarget.getBoundingClientRect()
      gesture.current = {
        id: e.pointerId, left: rect.left, width: rect.width, x: e.clientX,
        min: props.min, max: props.max, lastTime: performance.now(), moved: false, value: props.value,
      }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      props.onDragStart?.()
      updateValue()
      frame.current = requestAnimationFrame(pan)
    }}
    onPointerMove={(e) => {
      const g = gesture.current
      if (!g || g.id !== e.pointerId) return
      g.moved ||= g.x !== e.clientX
      g.x = e.clientX
      updateValue()
    }}
    onPointerUp={finish}
    onPointerCancel={finish}
    onLostPointerCapture={finish}
  />
}
