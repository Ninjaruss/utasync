import React, { useState } from 'react'
import { trialSlotsRemaining, TRIAL_LIMIT } from './trial'
import { useSettingsStore } from './SettingsStore'
import { verifyLicense } from './license'

// Placeholder checkout URL — replace with real LemonSqueezy product URL after setup
const CHECKOUT_URL = 'https://utasync.lemonsqueezy.com/buy/placeholder'

interface Props {
  feature: string
  onClose: () => void
}

export function UpgradeModal({ feature, onClose }: Props) {
  const remaining = trialSlotsRemaining()
  const { isPro, setLicense } = useSettingsStore()
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState('')
  const [restoring, setRestoring] = useState(false)

  const handleCheckout = () => {
    // Open LemonSqueezy overlay if script is loaded, otherwise open in new tab
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).LemonSqueezy) {
      const ls = (window as unknown as Record<string, { Url: { Open: (url: string) => void } }>).LemonSqueezy
      ls.Url.Open(CHECKOUT_URL)
    } else {
      window.open(CHECKOUT_URL, '_blank')
    }
  }

  const handleRestoreKey = async () => {
    if (!keyInput.trim()) {
      setKeyError('Please enter a license key.')
      return
    }
    setRestoring(true)
    setKeyError('')
    const result = await verifyLicense(keyInput.trim())
    setRestoring(false)
    if (result.valid) {
      setLicense(keyInput.trim())
      onClose()
    } else {
      setKeyError(result.error ?? 'Invalid license key.')
    }
  }

  if (isPro) return null

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
          <button
            onClick={handleCheckout}
            className="w-full py-3 bg-white text-cinnabar-950 rounded-xl font-bold"
          >
            Unlock Pro — $9.99
          </button>
          <button onClick={onClose} className="text-white/40 text-sm text-center py-1">
            Not now
          </button>
        </div>

        {/* Restore License */}
        <div className="border-t border-cinnabar-800 pt-3 space-y-2">
          <p className="text-white/40 text-xs">Already purchased? Restore your license:</p>
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste license key…"
            className="w-full px-3 py-2 bg-cinnabar-950 text-white text-sm rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/20"
          />
          {keyError && <p className="text-red-400 text-xs">{keyError}</p>}
          <button
            onClick={handleRestoreKey}
            disabled={restoring}
            className="w-full py-2 bg-cinnabar-800 text-white text-sm rounded-lg font-medium disabled:opacity-40 hover:bg-cinnabar-700"
          >
            {restoring ? 'Verifying…' : 'Restore License'}
          </button>
        </div>
      </div>
    </div>
  )
}
