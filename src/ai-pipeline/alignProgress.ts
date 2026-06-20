import type { ProcessStep } from '../core/ui/progressUtils'
import type { DeviceTier } from '../core/types'

export type AlignStage =
  | 'preparing'
  | 'separating'
  | 'loading'
  | 'transcribing'
  | 'aligning'

const PREPARING: ProcessStep = {
  label: 'Preparing audio',
  detail: 'Reading and decoding your audio file',
}

export function alignSteps(tier: DeviceTier): ProcessStep[] {
  if (tier === 'full') {
    return [
      PREPARING,
      { label: 'Separating vocals', detail: 'Isolating vocals before transcription' },
      { label: 'Loading AI model', detail: 'Preparing on-device speech recognition' },
      { label: 'Transcribing audio', detail: 'Running on-device speech recognition' },
      { label: 'Aligning to lyrics', detail: 'Matching the transcript to your lyric lines' },
    ]
  }
  return [
    PREPARING,
    { label: 'Loading AI model', detail: 'Preparing on-device speech recognition' },
    { label: 'Transcribing audio', detail: 'Running on-device speech recognition' },
    { label: 'Aligning to lyrics', detail: 'Matching the transcript to your lyric lines' },
  ]
}

export function alignStepIndex(tier: DeviceTier, stage: AlignStage): number {
  if (tier === 'full') {
    switch (stage) {
      case 'preparing': return 0
      case 'separating': return 1
      case 'loading': return 2
      case 'transcribing': return 3
      case 'aligning': return 4
      default: return 0
    }
  }
  switch (stage) {
    case 'preparing': return 0
    case 'loading': return 1
    case 'transcribing': return 2
    case 'aligning': return 3
    default: return 0
  }
}
