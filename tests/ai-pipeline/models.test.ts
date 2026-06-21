import { describe, it, expect } from 'vitest'
import {
  getWhisperModel,
  getWhisperDownloadHint,
  getEmbedModel,
  WHISPER_MODEL_FULL,
  WHISPER_MODEL_LITE,
  WHISPER_DOWNLOAD_HINT,
  EMBED_MODEL,
} from '../../src/ai-pipeline/models'

describe('getWhisperModel', () => {
  it('uses whisper-small on full tier', () => {
    expect(getWhisperModel('full')).toBe(WHISPER_MODEL_FULL)
    expect(getWhisperModel('full')).toBe('Xenova/whisper-small')
  })
  it('uses whisper-small on lite tier (same as full — tiny regressed timing)', () => {
    expect(getWhisperModel('lite')).toBe(WHISPER_MODEL_LITE)
    expect(getWhisperModel('lite')).toBe('Xenova/whisper-small')
  })
  it('uses whisper-small on manual tier (fallback if ever invoked)', () => {
    expect(getWhisperModel('manual')).toBe(WHISPER_MODEL_FULL)
  })
})

describe('getWhisperDownloadHint', () => {
  it('reports the whisper-small download size for capable tiers', () => {
    expect(getWhisperDownloadHint('full')).toBe(WHISPER_DOWNLOAD_HINT)
    expect(getWhisperDownloadHint('lite')).toBe('~240MB')
  })
})

describe('getEmbedModel', () => {
  it('returns the multilingual L12 model for all tiers', () => {
    expect(getEmbedModel('full')).toBe(EMBED_MODEL)
    expect(getEmbedModel('lite')).toBe(EMBED_MODEL)
    expect(getEmbedModel('manual')).toBe(EMBED_MODEL)
  })
})
