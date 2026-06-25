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

export function alignSteps(tier: DeviceTier, vocalSeparation = false): ProcessStep[] {
  const steps: ProcessStep[] = [PREPARING]
  if (vocalSeparation && tier === 'full') {
    steps.push({ label: 'Separating vocals', detail: 'Isolating vocals before transcription' })
  }
  steps.push(
    { label: 'Loading AI model', detail: 'Preparing on-device speech recognition' },
    { label: 'Transcribing audio', detail: 'Running on-device speech recognition' },
    { label: 'Aligning to lyrics', detail: 'Matching the transcript to your lyric lines' },
  )
  return steps
}

export function alignStepIndex(tier: DeviceTier, stage: AlignStage, vocalSeparation = false): number {
  const keys: AlignStage[] = vocalSeparation && tier === 'full'
    ? ['preparing', 'separating', 'loading', 'transcribing', 'aligning']
    : ['preparing', 'loading', 'transcribing', 'aligning']

  const idx = keys.indexOf(stage)
  return idx >= 0 ? idx : 0
}
