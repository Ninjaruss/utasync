import type { ProcessStep } from '../core/ui/progressUtils'
import type { DeviceTier } from '../core/types'

export type AlignStage =
  | 'separating'
  | 'loading'
  | 'transcribing'
  | 'aligning'

export function alignSteps(tier: DeviceTier): ProcessStep[] {
  if (tier === 'full') {
    return [
      { label: 'Separating vocals', detail: 'Isolating vocals before transcription' },
      { label: 'Loading AI model', detail: 'Preparing on-device speech recognition' },
      { label: 'Transcribing audio', detail: 'Running on-device speech recognition' },
      { label: 'Aligning to lyrics', detail: 'Matching the transcript to your lyric lines' },
    ]
  }
  return [
    { label: 'Loading AI model', detail: 'Preparing on-device speech recognition' },
    { label: 'Transcribing audio', detail: 'Running on-device speech recognition' },
    { label: 'Aligning to lyrics', detail: 'Matching the transcript to your lyric lines' },
  ]
}

export function alignStepIndex(tier: DeviceTier, stage: AlignStage): number {
  if (tier === 'full') {
    switch (stage) {
      case 'separating': return 0
      case 'loading': return 1
      case 'transcribing': return 2
      case 'aligning': return 3
      default: return 0
    }
  }
  switch (stage) {
    case 'loading': return 0
    case 'transcribing': return 1
    case 'aligning': return 2
    default: return 0
  }
}
