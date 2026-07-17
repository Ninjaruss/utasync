import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language, ReadingMode, UserSettings } from '../core/types'

interface SettingsState extends UserSettings {
  setDefaultSongLanguage: (lang: Language) => void
  setVocalSeparationEnabled: (enabled: boolean) => void
  setReadingMode: (mode: ReadingMode) => void
  setTapLookupEnabled: (enabled: boolean) => void
  setImmersionDefinitions: (enabled: boolean) => void
  setModelDownloadConsented: (consented: boolean) => void
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
      immersionDefinitions: false,
      modelDownloadConsented: false,
      setDefaultSongLanguage: (defaultSongLanguage) => set({ defaultSongLanguage }),
      setVocalSeparationEnabled: (vocalSeparationEnabled) => set({ vocalSeparationEnabled }),
      setReadingMode: (readingMode) => set({ readingMode }),
      setTapLookupEnabled: (tapLookupEnabled) => set({ tapLookupEnabled }),
      setImmersionDefinitions: (immersionDefinitions) => set({ immersionDefinitions }),
      setModelDownloadConsented: (modelDownloadConsented) => set({ modelDownloadConsented }),
    }),
    { name: 'utasync-settings' }
  )
)
