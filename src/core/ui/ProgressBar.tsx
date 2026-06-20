interface Props {
  /** 0–100 determinate progress. */
  value: number
  size?: 'sm' | 'md'
  className?: string
  /** Accessible label for the bar itself (step context lives in parent). */
  'aria-label'?: string
}

const SIZE_CLASS = {
  sm: 'h-1.5',
  md: 'h-2',
} as const

export function ProgressBar({ value, size = 'md', className = '', 'aria-label': ariaLabel }: Props) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      className={[
        'rounded-full bg-cinnabar-800 overflow-hidden',
        SIZE_CLASS[size],
        className,
      ].join(' ')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={ariaLabel}
    >
      <div
        className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
