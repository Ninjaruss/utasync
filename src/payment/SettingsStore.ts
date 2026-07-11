import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language, ReadingMode, UserSettings } from '../core/types'

interface SettingsState extends UserSettings {
  setDefaultSongLanguage: (lang: Language) => void
  setVocalSeparationEnabled: (enabled: boolean) => void
  setReadingMode: (mode: ReadingMode) => void
  setTapLookupEnabled: (enabled: boolean) => void
}

export function getDefaultSongLanguage(): Language {
  return useSettingsStore.getState().defaultSongLanguage ?? 'ja'
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      defaultSpeed: 1,
      clozeDifficulty: 'medium',
      defaultSongLanguage: 'ja',
      vocalSeparationEnabled: false,
      readingMode: 'dictionary',
      tapLookupEnabled: true,
      setDefaultSongLanguage: (defaultSongLanguage) => set({ defaultSongLanguage }),
      setVocalSeparationEnabled: (vocalSeparationEnabled) => set({ vocalSeparationEnabled }),
      setReadingMode: (readingMode) => set({ readingMode }),
      setTapLookupEnabled: (tapLookupEnabled) => set({ tapLookupEnabled }),
    }),
    { name: 'utasync-settings' }
  )
)
