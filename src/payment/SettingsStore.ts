import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserSettings } from '../core/types'

function generateFingerprint(): string {
  const nav = navigator
  const parts = [
    nav.language,
    nav.hardwareConcurrency,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ]
  return btoa(parts.join('|')).slice(0, 32)
}

interface SettingsState extends UserSettings {
  setIsPro: (val: boolean) => void
  setLicense: (key: string) => void
  incrementTrial: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      proLicense: null,
      isPro: false,
      trialSongsClaimed: 0,
      deviceFingerprint: generateFingerprint(),
      theme: 'dark',
      defaultSpeed: 1,
      clozeDifficulty: 'medium',
      setIsPro: (isPro) => set({ isPro }),
      setLicense: (proLicense) => set({ proLicense, isPro: true }),
      incrementTrial: () => set((s) => ({ trialSongsClaimed: s.trialSongsClaimed + 1 })),
    }),
    { name: 'utasync-settings' }
  )
)
