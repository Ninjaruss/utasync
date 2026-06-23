import { useState } from 'react'

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4">
        <p className="text-[10px] uppercase tracking-wide text-white/35">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="onboarding-title" className="text-white font-semibold text-lg">{current.title}</h2>
        <p className="text-white/70 text-sm">{current.body}</p>
        <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" onClick={dismiss} className="text-white/40 text-sm">
            Skip
          </button>
          <button
            type="button"
            onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
            className="py-2 px-4 bg-cinnabar-accent text-white rounded-xl font-medium text-sm"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
