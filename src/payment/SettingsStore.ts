import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language, UserSettings } from '../core/types'

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
  setLicense: (key: string) => void
  clearLicense: () => void
  incrementTrial: () => void
  setDefaultSongLanguage: (lang: Language) => void
  setVocalSeparationEnabled: (enabled: boolean) => void
}

export function getDefaultSongLanguage(): Language {
  return useSettingsStore.getState().defaultSongLanguage ?? 'ja'
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
      defaultSongLanguage: 'ja',
      vocalSeparationEnabled: false,
      setLicense: (proLicense) => set({ proLicense, isPro: true }),
      clearLicense: () => set({ proLicense: null, isPro: false }),
      incrementTrial: () => set((s) => ({ trialSongsClaimed: s.trialSongsClaimed + 1 })),
      setDefaultSongLanguage: (defaultSongLanguage) => set({ defaultSongLanguage }),
      setVocalSeparationEnabled: (vocalSeparationEnabled) => set({ vocalSeparationEnabled }),
    }),
    { name: 'utasync-settings' }
  )
)
