import type { DeviceTier } from '../core/types'

/** Full-tier auto-align: best word-timestamp quality (~240MB download). */
export const WHISPER_MODEL_FULL = 'Xenova/whisper-small'

/** Lite-tier auto-align: smaller/faster; timing quality is sufficient for align (~75MB). */
export const WHISPER_MODEL_LITE = 'Xenova/whisper-tiny'

export function getWhisperModel(tier: DeviceTier): string {
  return tier === 'lite' ? WHISPER_MODEL_LITE : WHISPER_MODEL_FULL
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
export const WHISPER_DOWNLOAD_HINT: Record<'full' | 'lite', string> = {
  full: '~240MB',
  lite: '~75MB',
}
