import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildWhisperPrompt,
  WHISPER_MAX_PROMPT_TOKENS,
  type WhisperPromptPipeline,
} from '../../src/ai-pipeline/whisperPrompt'

// buildWhisperPrompt reads a handful of UNDOCUMENTED transformers.js internals off
// the ASR pipeline object to assemble `decoder_input_ids`. The pipeline is mocked
// with just those pieces so the assembly (and the feature-gate that must NEVER
// crash a transcription) is unit-testable without a real 1.5GB model.

const START_OF_PREV = 50361
const NO_TIMESTAMPS = 50363
const DECODER_START = 50258
const JA_ID = 50266
const EN_ID = 50259
const TRANSCRIBE_ID = 50359
const TRANSLATE_ID = 50358

/** One fake token per whitespace word, numbered from 100 (order-preserving so the
 * assembled prefix is observable). */
function fakeEncode(text: string): number[] {
  return text.split(/\s+/).filter(Boolean).map((_, i) => 100 + i)
}

function makeStubAsr(): WhisperPromptPipeline {
  const tokens_to_ids = new Map<string, number>([
    ['<|startofprev|>', START_OF_PREV],
    ['<|notimestamps|>', NO_TIMESTAMPS],
  ])
  return {
    tokenizer: {
      model: {
        tokens_to_ids,
        convert_tokens_to_ids: (tokens: string[]) => tokens.map((t) => tokens_to_ids.get(t) ?? -1),
      },
      encode: (text: string) => fakeEncode(text),
    },
    model: {
      generation_config: {
        decoder_start_token_id: DECODER_START,
        lang_to_id: { '<|ja|>': JA_ID, '<|en|>': EN_ID },
        task_to_id: { transcribe: TRANSCRIBE_ID, translate: TRANSLATE_ID },
        no_timestamps_token_id: NO_TIMESTAMPS,
      },
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildWhisperPrompt', () => {
  it('assembles [startofprev, ...lyricTokens, decoder_start, langId, taskId] in segment mode (no <|notimestamps|>)', () => {
    const asr = makeStubAsr()
    const ids = buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')
    expect(ids).toEqual([START_OF_PREV, 100, 101, DECODER_START, JA_ID, TRANSCRIBE_ID])
    // Segment mode is return_timestamps:true → the <|notimestamps|> token must be absent.
    expect(ids).not.toContain(NO_TIMESTAMPS)
  })

  it('maps the English lang token', () => {
    const ids = buildWhisperPrompt(makeStubAsr(), 'hello there', 'en', 'transcribe', 'segment')
    expect(ids).toEqual([START_OF_PREV, 100, 101, DECODER_START, EN_ID, TRANSCRIBE_ID])
  })

  it('returns null in word mode (word-mode prompt-prefix trim is missing in 3.8.1 → phantom words)', () => {
    expect(buildWhisperPrompt(makeStubAsr(), 'two words', 'ja', 'transcribe', 'word')).toBeNull()
  })

  it('returns null for empty / whitespace-only prompt text', () => {
    expect(buildWhisperPrompt(makeStubAsr(), '', 'ja', 'transcribe', 'segment')).toBeNull()
    expect(buildWhisperPrompt(makeStubAsr(), '   ', 'ja', 'transcribe', 'segment')).toBeNull()
  })

  it('returns null for a language with no lang_to_id entry (e.g. mixed)', () => {
    // 'mixed' has no single <|xx|> token — cannot build a valid init sequence.
    expect(
      buildWhisperPrompt(makeStubAsr(), 'two words', 'mixed', 'transcribe', 'segment'),
    ).toBeNull()
  })

  describe('feature-gate: a missing internal → null (never crash a transcription)', () => {
    it('null when generation_config is absent', () => {
      const asr = makeStubAsr()
      asr.model = { generation_config: null }
      expect(buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')).toBeNull()
    })

    it('null when convert_tokens_to_ids is missing', () => {
      const asr = makeStubAsr()
      delete (asr.tokenizer!.model as { convert_tokens_to_ids?: unknown }).convert_tokens_to_ids
      expect(buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')).toBeNull()
    })

    it('null when tokenizer.encode is missing', () => {
      const asr = makeStubAsr()
      delete (asr.tokenizer as { encode?: unknown }).encode
      expect(buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')).toBeNull()
    })

    it('null when the <|startofprev|> special token is not in the vocab', () => {
      const asr = makeStubAsr()
      asr.tokenizer!.model!.tokens_to_ids!.delete('<|startofprev|>')
      expect(buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')).toBeNull()
    })

    it('null when decoder_start_token_id is absent', () => {
      const asr = makeStubAsr()
      delete (asr.model!.generation_config as { decoder_start_token_id?: unknown })
        .decoder_start_token_id
      expect(buildWhisperPrompt(asr, 'two words', 'ja', 'transcribe', 'segment')).toBeNull()
    })

    it('logs the feature-gate reason at most once across calls', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const asr = makeStubAsr()
      asr.model = { generation_config: null }
      buildWhisperPrompt(asr, 'a', 'ja', 'transcribe', 'segment')
      buildWhisperPrompt(asr, 'b', 'ja', 'transcribe', 'segment')
      buildWhisperPrompt(asr, 'c', 'ja', 'transcribe', 'segment')
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    })
  })

  it('truncates an over-long lyric prefix so the total stays ≤ 448 tokens', () => {
    const asr = makeStubAsr()
    // 500-word prompt → 500 lyric tokens, well over the 448 decoder context.
    const longText = Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ')
    const ids = buildWhisperPrompt(asr, longText, 'ja', 'transcribe', 'segment')!
    expect(ids).not.toBeNull()
    expect(ids.length).toBeLessThanOrEqual(WHISPER_MAX_PROMPT_TOKENS)
    // Prefix kept from the FRONT (the hole opens right after a good anchor, so its
    // early lines matter most); suffix intact.
    expect(ids[0]).toBe(START_OF_PREV)
    expect(ids.slice(-3)).toEqual([DECODER_START, JA_ID, TRANSCRIBE_ID])
    expect(ids[1]).toBe(100) // first lyric token retained
  })
})
