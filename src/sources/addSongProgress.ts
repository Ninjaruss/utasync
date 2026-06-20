import type { ProcessStep } from '../core/ui/progressUtils'

export const UPLOAD_SAVE_STEPS: ProcessStep[] = [
  { label: 'Preparing lyrics', detail: 'Reading pasted text or subtitle file' },
  { label: 'Normalizing lyrics', detail: 'Finding translation and pairing lines' },
  { label: 'Saving audio', detail: 'Copying file to local storage' },
  { label: 'Saving song', detail: 'Writing to your library' },
]

export const LINK_METADATA_STEPS: ProcessStep[] = [
  { label: 'Fetching song info', detail: 'Reading YouTube metadata' },
]

export const LINK_SAVE_STEPS: ProcessStep[] = [
  { label: 'Preparing lyrics', detail: 'Reading pasted text or subtitle file' },
  { label: 'Normalizing lyrics', detail: 'Finding translation and pairing lines' },
  { label: 'Saving audio', detail: 'Copying file to local storage' },
  { label: 'Saving song', detail: 'Writing to your library' },
]

export const LYRIC_SEARCH_STEPS: ProcessStep[] = [
  { label: 'Searching for lyrics', detail: 'Checking online lyric databases' },
]

export const UPLOAD_LYRIC_SEARCH_STEPS: ProcessStep[] = [
  { label: 'Searching LRCLIB', detail: 'Looking for synced or plain lyrics by title and artist' },
]

export const LINK_LYRIC_SEARCH_STEPS: ProcessStep[] = [
  { label: 'Searching for lyrics', detail: 'Checking YouTube captions and LRCLIB' },
]

export const SECOND_LANGUAGE_ALIGN_STEPS: ProcessStep[] = [
  { label: 'Normalizing lyrics', detail: 'Matching translation lines to your lyrics' },
]

export type UploadSavePhase = 'preparing' | 'normalizing' | 'saving-audio' | 'saving-song'

export function uploadSaveStepIndex(phase: UploadSavePhase): number {
  switch (phase) {
    case 'preparing': return 0
    case 'normalizing': return 1
    case 'saving-audio': return 2
    case 'saving-song': return 3
  }
}

export type LinkSavePhase = UploadSavePhase

export function linkSaveSteps(includeAudio: boolean): ProcessStep[] {
  if (includeAudio) return LINK_SAVE_STEPS
  return LINK_SAVE_STEPS.filter((_, i) => i !== 2)
}

export function linkSaveStepIndex(phase: LinkSavePhase, includeAudio: boolean): number {
  const order: LinkSavePhase[] = includeAudio
    ? ['preparing', 'normalizing', 'saving-audio', 'saving-song']
    : ['preparing', 'normalizing', 'saving-song']
  return Math.max(0, order.indexOf(phase))
}
