import { useState } from 'react'
import { Overlay } from './Overlay'

export const ONBOARDING_STORAGE_KEY = 'utasync_onboarding_seen'

const STEPS = [
  { title: 'Add a song', body: 'Paste a YouTube link or upload an audio file to get started.' },
  { title: 'Sync lyrics', body: 'Fetch lyrics automatically or paste your own, then align them to the audio.' },
  { title: 'Practice', body: 'Loop sections, slow down playback, and follow along word by word.' },
]

/** Reads/writes are wrapped because localStorage can throw (e.g. Safari private browsing),
 *  and this component is mounted unconditionally on the library screen. */
function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Storage unavailable — nothing to persist, the overlay just won't reappear this tab.
  }
}

export function Onboarding() {
  const [seen, setSeen] = useState(hasSeenOnboarding)
  const [step, setStep] = useState(0)

  const dismiss = () => {
    markOnboardingSeen()
    setSeen(true)
  }

  if (seen) return null

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    // Escape dismisses for good, exactly like Skip — reappearing after the user
    // has told it to go away would be worse than not honouring the key at all.
    // Not registered in OVERLAY_SURFACES (tests/core/ui/overlaySurfaces.tsx):
    // Onboarding takes no props and owns its own dismiss, so there is no onClose
    // to inject into the contract's render(onClose) shape. Giving it one is a
    // Phase 3 concern, when the screen model owns first-run state.
    //
    // backdropClassName's `p-4` is overridden at md+ by the `sheet` placement's own
    // `md:p-6` (both compile into the same @media block; Tailwind emits the spacing
    // scale in ascending order, so md:p-6 always wins over md:p-4 regardless of
    // which is listed last here). That is harmless, not a bug to "fix": the panel
    // below is max-w-sm (384px), and md starts at 768px, so 768 - 48 > 384 means the
    // backdrop padding never constrains it either way — do not re-add a md:p-4 override.
    <Overlay
      onClose={dismiss}
      placement="sheet"
      labelledBy="onboarding-title"
      backdropClassName="z-[70] bg-black/70 items-center justify-center p-4"
    >
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4 animate-[progress-enter_220ms_ease-out_both] shadow-xl shadow-black/40">
        <div className="flex items-center gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={[
                'h-1 rounded-full transition-[width,background-color] duration-200 ease-out',
                i === step ? 'w-5 bg-cinnabar-accent' : 'w-1.5 bg-white/15',
              ].join(' ')}
            />
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-wide text-white/60 tabular-nums">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="onboarding-title" className="text-white font-semibold text-lg text-balance">{current.title}</h2>
        <p className="text-white/70 text-sm text-pretty leading-relaxed">{current.body}</p>
        <div className="flex items-center justify-between gap-3 pt-2">
          {/* On the last step "Skip" and "Done" both just dismiss — two buttons,
            * one outcome, which reads as a choice the user has to make. Once
            * there is nothing left to skip, this slot goes back instead, which
            * also gives the carousel the return path it otherwise lacked. */}
          <button
            type="button"
            onClick={() => (isLast ? setStep((s) => s - 1) : dismiss())}
            className="min-h-11 px-2 text-white/60 hover:text-white/70 text-sm touch-manipulation transition-colors duration-150 ease-out"
          >
            {isLast ? 'Back' : 'Skip'}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
            className="min-h-11 py-2 px-5 bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-cinnabar-950 rounded-xl font-medium text-sm touch-manipulation shadow-sm shadow-cinnabar-accent/20 transition-[background-color,transform] duration-150 ease-out active:scale-[0.96]"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
