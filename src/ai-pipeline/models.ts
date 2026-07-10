import type { DeviceTier } from '../core/types'
import { canUseHighAccuracy } from './inferenceBackend'

/** Default speech model — WebGPU-capable (has fp16 weights), multilingual.
 * Word-timestamp quality matters more than download size. */
export const WHISPER_MODEL_SMALL = 'Xenova/whisper-small'

/** High-accuracy opt-in speech model (~1.5GB); full tier + WebGPU only. */
export const WHISPER_MODEL_MEDIUM = 'Xenova/whisper-medium'

/** Model for the tier, upgraded to medium only when high accuracy is requested
 * AND the tier can run it. */
export function getWhisperModel(tier: DeviceTier, highAccuracy = false): string {
  if (highAccuracy && canUseHighAccuracy(tier)) return WHISPER_MODEL_MEDIUM
  return WHISPER_MODEL_SMALL
}

/** Shown in auto-align loading copy for the tier's speech model. */
export function getWhisperDownloadHint(tier: DeviceTier, highAccuracy = false): string {
  return highAccuracy && canUseHighAccuracy(tier) ? WHISPER_DOWNLOAD_HINT_MEDIUM : WHISPER_DOWNLOAD_HINT
}

/** Multilingual sentence embeddings for word-pair coloring and semantic line attach. */
export const EMBED_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

/**
 * Smaller multilingual MiniLM (e.g. L6) is not published in the Xenova/transformers.js
 * catalog — only L12 and English-only L6 variants exist. A different embedding space
 * would also require retuning MATCH_THRESHOLD, so lite tier keeps L12 for now.
 */
export function getEmbedModel(_tier: DeviceTier): string {
  return EMBED_MODEL
}

/** Rough download sizes shown in AutoAlignFlow loading copy. */
export const WHISPER_DOWNLOAD_HINT = '~240MB'
export const WHISPER_DOWNLOAD_HINT_MEDIUM = '~1.5GB'
