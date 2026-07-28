import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language, ReadingMode, UserSettings } from '../core/types'

interface SettingsState extends UserSettings {
  setDefaultSongLanguage: (lang: Language) => void
  setVocalSeparationEnabled: (enabled: boolean | null) => void
  setReadingMode: (mode: ReadingMode) => void
  setTapLookupEnabled: (enabled: boolean) => void
  setModelDownloadConsented: (consented: boolean) => void
}

export function getDefaultSongLanguage(): Language {
  return useSettingsStore.getState().defaultSongLanguage ?? 'ja'
}

/** Persist migration for the settings store. v0 stored vocalSeparationEnabled as
 * a plain boolean defaulting to false — the opt-in default for every user, not an
 * explicit choice. Isolation is now default-on (guarded by a stem sanity-check),
 * so clear that stale default and let the new tri-state default (null → on when
 * supported) apply. Explicit toggles made from here on persist as true/false and
 * are honored. Exported for direct testing. */
export function migrateSettings(persisted: unknown, version: number): unknown {
  if (version < 1 && persisted && typeof persisted === 'object') {
    delete (persisted as Record<string, unknown>).vocalSeparationEnabled
  }
  return persisted
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      defaultSpeed: 1,
      clozeDifficulty: 'medium',
      defaultSongLanguage: 'ja',
      // null = "use the default" (on when the device supports it). See UserSettings.
      vocalSeparationEnabled: null,
      readingMode: 'dictionary',
      tapLookupEnabled: true,
      modelDownloadConsented: false,
      setDefaultSongLanguage: (defaultSongLanguage) => set({ defaultSongLanguage }),
      setVocalSeparationEnabled: (vocalSeparationEnabled) => set({ vocalSeparationEnabled }),
      setReadingMode: (readingMode) => set({ readingMode }),
      setTapLookupEnabled: (tapLookupEnabled) => set({ tapLookupEnabled }),
      setModelDownloadConsented: (modelDownloadConsented) => set({ modelDownloadConsented }),
    }),
    {
      name: 'utasync-settings',
      version: 1,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
    }
  )
)
