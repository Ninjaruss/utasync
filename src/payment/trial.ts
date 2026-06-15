import { useSettingsStore } from './SettingsStore'

export const TRIAL_LIMIT = 2

export function canUsePro(isTrialSong: boolean): boolean {
  const { isPro } = useSettingsStore.getState()
  return isPro || isTrialSong
}

export function claimTrialSlot(): boolean {
  const { trialSongsClaimed, incrementTrial } = useSettingsStore.getState()
  if (trialSongsClaimed >= TRIAL_LIMIT) return false
  incrementTrial()
  return true
}

export function trialSlotsRemaining(): number {
  const { isPro, trialSongsClaimed } = useSettingsStore.getState()
  if (isPro) return Infinity
  return Math.max(0, TRIAL_LIMIT - trialSongsClaimed)
}
