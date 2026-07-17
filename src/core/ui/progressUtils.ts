export interface ProcessStep {
  label: string
  detail?: string
}

export interface TaskSubstep {
  label: string
  state: 'pending' | 'active' | 'done'
}

export const FIND_LYRICS_STATUS = {
  exact: 'Checking the lyrics database for an exact match…',
  search: 'Searching the lyrics database catalog…',
} as const

export const RESOLVE_LYRICS_STATUS = {
  youtube: 'Fetching YouTube captions…',
  'lrclib-exact': 'Checking the lyrics database for an exact match…',
  'lrclib-search': 'Searching the lyrics database catalog…',
} as const

export function resolveLyricsSubsteps(
  stage: keyof typeof RESOLVE_LYRICS_STATUS | null,
  includeYouTube: boolean,
): TaskSubstep[] {
  const steps: Array<{ key: keyof typeof RESOLVE_LYRICS_STATUS; label: string }> = includeYouTube
    ? [
        { key: 'youtube', label: 'YouTube captions' },
        { key: 'lrclib-exact', label: 'Exact match' },
        { key: 'lrclib-search', label: 'Catalog search' },
      ]
    : [
        { key: 'lrclib-exact', label: 'Exact match' },
        { key: 'lrclib-search', label: 'Catalog search' },
      ]
  const order = steps.map((s) => s.key)
  const activeIdx = stage ? Math.max(0, order.indexOf(stage)) : 0
  return steps.map((step, i) => ({
    label: step.label,
    state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }))
}

export function findLyricsSubsteps(stage: keyof typeof FIND_LYRICS_STATUS | null): TaskSubstep[] {
  const steps: Array<{ key: keyof typeof FIND_LYRICS_STATUS; label: string }> = [
    { key: 'exact', label: 'Exact match' },
    { key: 'search', label: 'Catalog search' },
  ]
  const order = steps.map((s) => s.key)
  const activeIdx = stage ? Math.max(0, order.indexOf(stage)) : 0
  return steps.map((step, i) => ({
    label: step.label,
    state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }))
}

/** Overall 0–100 from step index and optional within-step progress. */
export function overallPercent(
  stepIndex: number,
  stepCount: number,
  taskProgress: number | null | undefined,
): number {
  if (stepCount <= 0) return 0
  const within = taskProgress == null ? 0 : Math.min(100, Math.max(0, taskProgress)) / 100
  return Math.min(100, Math.round(((stepIndex + within) / stepCount) * 100))
}
