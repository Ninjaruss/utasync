interface Props {
  done: number
  total: number
}

/** Non-blocking in-flow strip while word-pair embedding/alignment runs in the background. */
export function WordColorProgressBanner({ done, total }: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      className="shrink-0 px-4 py-2.5 border-b border-cinnabar-accent/30 bg-cinnabar-900/70 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`Coloring word pairs, ${done} of ${total}`}
    >
      <div className="flex items-center gap-3 max-w-2xl mx-auto">
        <div
          className="w-4 h-4 shrink-0 rounded-full border-2 border-cinnabar-accent border-t-transparent animate-spin"
          aria-hidden
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-white/85 text-xs font-medium truncate tabular-nums">
            Coloring word pairs… {done}/{total}
          </p>
          <div className="h-1.5 rounded-full bg-cinnabar-950/80 overflow-hidden">
            <div
              className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <span className="text-xs text-white/45 tabular-nums shrink-0">{pct}%</span>
      </div>
    </div>
  )
}
