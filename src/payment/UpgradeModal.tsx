import React from 'react'
import { trialSlotsRemaining, TRIAL_LIMIT } from './trial'
import { useSettingsStore } from './SettingsStore'

interface Props {
  feature: string
  onClose: () => void
}

export function UpgradeModal({ feature, onClose }: Props) {
  const remaining = trialSlotsRemaining()
  const { isPro } = useSettingsStore()

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold text-lg">Unlock {feature}</h2>

        {remaining > 0 ? (
          <p className="text-white/70 text-sm">
            You have <span className="text-cinnabar-accent font-bold">{remaining}</span> free trial {remaining === 1 ? 'song' : 'songs'} left.
            This song will use one.
          </p>
        ) : (
          <p className="text-white/70 text-sm">
            You've used all {TRIAL_LIMIT} free trials.
            Unlock Pro for <span className="text-cinnabar-accent font-bold">$9.99</span> — one time, forever.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {remaining > 0 && (
            <button className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium" onClick={onClose}>
              Use trial slot
            </button>
          )}
          <button className="w-full py-3 bg-white text-cinnabar-950 rounded-xl font-bold">
            Unlock Pro — $9.99
          </button>
          <button onClick={onClose} className="text-white/40 text-sm text-center py-1">
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
