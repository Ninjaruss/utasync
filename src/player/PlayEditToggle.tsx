interface Props {
  mode: 'play' | 'edit'
  onChange: (mode: 'play' | 'edit') => void
}

const segmentClass = [
  'relative z-10 min-h-9 px-3.5 text-xs rounded-[calc(9999px-4px)] touch-manipulation',
  'font-medium transition-colors duration-150 ease-out',
].join(' ')

/** Segmented Play / Edit control with a sliding active indicator. */
export function PlayEditToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Play or edit mode"
      className="relative grid grid-cols-2 bg-white/[0.08] rounded-full p-1 min-w-[8.25rem]"
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
          mode === 'play' ? 'text-white' : 'text-white/50 hover:text-white/70',
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
          mode === 'edit' ? 'text-white' : 'text-white/50 hover:text-white/70',
        ].join(' ')}
      >
        Edit
      </button>
    </div>
  )
}
