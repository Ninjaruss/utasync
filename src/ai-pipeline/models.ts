import type { DeviceTier } from '../core/types'

/** Auto-align speech model — word-timestamp quality matters more than download size. */
export const WHISPER_MODEL_FULL = 'Xenova/whisper-small'

/** Same model on lite tier: whisper-tiny regressed line timing (fc423db). */
export const WHISPER_MODEL_LITE = WHISPER_MODEL_FULL

export function getWhisperModel(_tier: DeviceTier): string {
  return WHISPER_MODEL_FULL
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

/** Rough download size shown in AutoAlignFlow loading copy. */
export const WHISPER_DOWNLOAD_HINT = '~240MB'
