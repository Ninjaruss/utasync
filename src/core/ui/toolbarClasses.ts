/** Shared toolbar + lyric-row surfaces — keeps Play/Edit chrome visually aligned. */

export const toolbarSection =
  'shrink-0 px-3 sm:px-4 py-2 border-b border-cinnabar-900'

/** Fixed-height mode toolbar — keeps Play/Edit chrome from shifting when toggling. */
export const modeToolbarRow =
  `${toolbarSection} min-h-[5.25rem] flex flex-col justify-center`

export const toolbarSectionLabel =
  'text-[10px] uppercase tracking-wide text-white/35'

export const toolbarActionBtn =
  'px-2.5 py-1.5 rounded-lg border border-cinnabar-800 text-[11px] text-white/65 hover:text-white hover:border-cinnabar-accent/50 touch-manipulation transition-colors'

export const editRowSurface =
  'relative rounded-lg border border-cinnabar-900/70 bg-cinnabar-900/20 px-3 py-2.5 transition-colors hover:bg-cinnabar-900/30'

export const editRowSurfaceActive =
  'border-cinnabar-accent/40 bg-cinnabar-900/35'

export const timestampPillBtn =
  'flex items-center gap-1 shrink-0 rounded-lg border border-cinnabar-800 bg-cinnabar-950/50 px-1.5 py-1 touch-manipulation hover:border-cinnabar-accent/50 transition-colors'

/** Chip buttons for practice controls (A-B, speed presets) — shared sizing and borders. */
export const toolbarChipBtn =
  'min-h-9 px-2.5 py-1 rounded-lg border text-xs touch-manipulation transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] tabular-nums'

export const toolbarChipBtnIdle =
  'border-cinnabar-800 text-white/45 hover:border-cinnabar-accent/50 hover:text-white/65'

export const toolbarChipBtnActive =
  'border-cinnabar-accent text-cinnabar-accent bg-cinnabar-accent/10'

export const toolbarChipBtnArmed =
  'border-cinnabar-accent text-cinnabar-accent animate-pulse'

/** Display menu trigger — visible in the play-mode toolbar. */
export const displayMenuTrigger =
  'inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg border text-xs font-medium touch-manipulation transition-[color,background-color,border-color,box-shadow]'

export const displayMenuTriggerIdle =
  'border-cinnabar-800 text-white/55 hover:text-white/80 hover:border-cinnabar-accent/40'

export const displayMenuTriggerActive =
  'border-cinnabar-accent/60 text-cinnabar-accent bg-cinnabar-accent/15 shadow-sm shadow-cinnabar-accent/10'

/** Playhead-active lyric row (play mode + edit mode). */
export const lyricRowPlayheadActive =
  'ring-1 ring-inset ring-cinnabar-accent/25 bg-cinnabar-accent/[0.06]'

/** Subtle highlight for lines inside an active A-B loop region. */
export const lyricRowLoopRegion =
  'border-l-2 border-cinnabar-accent/45 bg-cinnabar-accent/[0.04] pl-2 -ml-0.5 sm:-ml-1'
