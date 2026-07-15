import type { AlignmentLanguage } from '../core/types'

/**
 * Whisper's decoder context window. The assembled `decoder_input_ids` (prompt
 * prefix + start-of-transcript sequence) must fit inside it; an over-long lyric
 * prompt is truncated to stay under the cap (holes are ≤4 lines, so this is a
 * safety belt that in practice never fires).
 */
export const WHISPER_MAX_PROMPT_TOKENS = 448

/**
 * The minimal shape of the transformers.js ASR pipeline that {@link buildWhisperPrompt}
 * reads. These are UNDOCUMENTED internals (verified against @huggingface/transformers
 * 3.8.1 dist): `WhisperForConditionalGeneration.generate` honors a caller-supplied
 * `kwargs.decoder_input_ids` in place of its own `_retrieve_init_tokens`
 * (models.js: `const init_tokens = kwargs.decoder_input_ids ?? this._retrieve_init_tokens(...)`).
 * Everything here is optional so the feature-gate can detect an upgrade that moves
 * or renames a piece and fall back to unprompted transcription rather than crash.
 */
export interface WhisperPromptPipeline {
  tokenizer?: {
    model?: {
      /** vocab lookup; `convert_tokens_to_ids` silently maps unknowns to unk, so
       * this Map (when present) is used for a precise "token exists" gate. */
      tokens_to_ids?: Map<string, number>
      convert_tokens_to_ids?: (tokens: string[]) => number[]
    }
    encode?: (text: string, opts?: { add_special_tokens?: boolean }) => number[]
  }
  model?: {
    generation_config?: {
      decoder_start_token_id?: number
      lang_to_id?: Record<string, number>
      task_to_id?: Record<string, number>
      no_timestamps_token_id?: number
    } | null
  }
}

let warnedOnce = false
function gateWarn(reason: string): null {
  if (!warnedOnce) {
    warnedOnce = true
    // One-time capability notice (not per-transcription): the installed
    // transformers.js build doesn't expose an internal this hatch relies on, so
    // lyric-prompt biasing is disabled and slices transcribe unprompted.
    console.warn(`[whisperPrompt] ${reason} — lyric-prompt biasing disabled, falling back to unprompted`)
  }
  return null
}

function asIntId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Resolve a Whisper special token to its id. `convert_tokens_to_ids` maps an
 * unknown token to `unk_token_id` rather than failing, so when the vocab Map is
 * exposed we additionally require the token to be present — a missing special
 * token means this build's tokenizer differs from what we assume, and we gate.
 */
function resolveSpecialId(
  model: NonNullable<NonNullable<WhisperPromptPipeline['tokenizer']>['model']>,
  token: string,
): number | null {
  if (model.tokens_to_ids instanceof Map && !model.tokens_to_ids.has(token)) return null
  const ids = model.convert_tokens_to_ids?.([token])
  return asIntId(ids?.[0])
}

/**
 * Build the `decoder_input_ids` that bias a Whisper re-transcription toward the
 * KNOWN sheet lyrics for a gap. The sequence is the standard Whisper prompt form:
 *
 *   [ <|startofprev|>, ...lyricTokens, <|startoftranscript|>, <|lang|>, <|transcribe|> ]
 *
 * `generate()` uses this in place of its own init tokens, and the timestamp logits
 * processor derives its `begin_index` from the full length — so the prompt prefix
 * is correctly excluded from the transcribed output.
 *
 * SEGMENT MODE ONLY: transformers.js 3.8.1's word-timestamp path doesn't trim the
 * prompt prefix from its output (→ phantom prompt words), so a word-mode prompt is
 * refused (returns null). In segment mode `return_timestamps` is true, so no
 * `<|notimestamps|>` token is appended (matching `_retrieve_init_tokens`).
 *
 * FEATURE-GATED: any absent internal (missing method / generation-config id /
 * unknown special token / unmappable language) returns null so the caller
 * transcribes unprompted. It never throws — a bad prompt can only be a no-op.
 * Even a successfully-built prompt is safe: round-8 accept-if-better rejects a
 * prompt-echo hallucination (low placement coverage) byte-identical.
 */
export function buildWhisperPrompt(
  asr: WhisperPromptPipeline,
  promptText: string,
  language: AlignmentLanguage,
  task: 'transcribe' | 'translate',
  timestampMode: 'word' | 'segment',
): number[] | null {
  // Word-mode prompt-prefix trimming is missing in 3.8.1 → phantom prompt words.
  if (timestampMode !== 'segment') return null
  const text = promptText.trim()
  if (!text) return null

  const tokenizerModel = asr?.tokenizer?.model
  const encode = asr?.tokenizer?.encode
  const gen = asr?.model?.generation_config
  if (
    !tokenizerModel ||
    typeof tokenizerModel.convert_tokens_to_ids !== 'function' ||
    typeof encode !== 'function' ||
    !gen
  ) {
    return gateWarn('pipeline tokenizer/generation-config internals missing')
  }

  const startOfPrev = resolveSpecialId(tokenizerModel, '<|startofprev|>')
  const decoderStart = asIntId(gen.decoder_start_token_id)
  const langId = asIntId(gen.lang_to_id?.[`<|${language}|>`])
  const taskId = asIntId(gen.task_to_id?.[task])
  if (startOfPrev === null || decoderStart === null || langId === null || taskId === null) {
    return gateWarn('required Whisper token ids missing for this language/task')
  }

  let lyricTokens: number[]
  try {
    lyricTokens = asr.tokenizer!.encode!(text, { add_special_tokens: false })
  } catch {
    return gateWarn('lyric prompt encoding failed')
  }
  if (!Array.isArray(lyricTokens) || lyricTokens.length === 0) return null

  // Standard SOT suffix for segment mode: start-of-transcript, language, task.
  const suffix = [decoderStart, langId, taskId]
  const budget = WHISPER_MAX_PROMPT_TOKENS - 1 /* <|startofprev|> */ - suffix.length
  if (lyricTokens.length > budget) {
    // Keep the FRONT of the prompt: a gap slice is clamped to its first 30s after a
    // good anchor, so the hole's opening lines are the re-anchorable ones.
    lyricTokens = lyricTokens.slice(0, budget)
  }

  return [startOfPrev, ...lyricTokens, ...suffix]
}
