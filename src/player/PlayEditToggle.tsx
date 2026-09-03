interface Props {
  mode: 'play' | 'edit'
  onChange: (mode: 'play' | 'edit') => void
}

const segmentClass = [
  // Tighter horizontal padding below `sm`. This control and the two glyph
  // buttons either side of it are all shrink-0, so on a 320px screen they left
  // the song title ~44px. The labels need ~28px each at this size, so 2.5 of
  // padding still clears them; the roomier 3.5 returns at `sm`.
  // min-h-10 (40px), the floor in make-interfaces-feel-better. The Back and
  // Settings buttons either side are min-h-11, so the header row is already
  // taller than this and grows none from the change.
  'relative z-10 min-h-10 px-2.5 sm:px-3.5 text-xs rounded-[calc(9999px-4px)] touch-manipulation',
  'font-medium transition-colors duration-150 ease-out',
].join(' ')

/* The active segment sits on the solid accent, so it takes the same dark label
   every other solid-accent surface uses — white on #f87171 is 2.77:1, and
   cinnabar-950 is 7.33:1. The accent here is a separate absolutely-positioned
   sibling rather than the button's own background, which is why a DOM contrast
   sweep reads this label as sitting on the dark pill and passes it.
   The inactive label genuinely is on the pill, and measures 5.24:1. */
const activeLabel = 'text-cinnabar-950'
const inactiveLabel = 'text-white/50 hover:text-white/70'

/** Segmented Play / Edit control with a sliding active indicator. */
export function PlayEditToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Play or edit mode"
      className="relative grid grid-cols-2 bg-white/[0.08] rounded-full p-1 min-w-[6.5rem] sm:min-w-[8.25rem]"
    >
      <div
        aria-hidden
        className={[
          'absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-[calc(9999px-4px)] bg-cinnabar-accent',
          'transition-[transform] duration-200 ease-out',
          mode === 'edit' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0',
        ].join(' ')}
        style={{ left: '4px' }}
      />
      <button
        type="button"
        onClick={() => onChange('play')}
        aria-pressed={mode === 'play'}
        className={[
          segmentClass,
          mode === 'play' ? activeLabel : inactiveLabel,
        ].join(' ')}
      >
        Play
      </button>
      <button
        type="button"
        onClick={() => onChange('edit')}
        aria-pressed={mode === 'edit'}
        className={[
          segmentClass,
          mode === 'edit' ? activeLabel : inactiveLabel,
        ].join(' ')}
      >
        Edit
      </button>
    </div>
  )
}
