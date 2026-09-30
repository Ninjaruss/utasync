import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Provenance and staleness guard for the committed Whisper TRANSCRIPT fixtures.
 *
 * Why this exists (plan item W0.3,
 * docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md): the audio the
 * fixtures were produced from is not in the repository — `.gitignore` excludes
 * `public/e2e/` and `.cache/` — so every transcript in `tests/ai-pipeline/fixtures/`
 * is a snapshot of one machine that nobody else can re-derive. They also carried no
 * record of HOW they were made: no model id, no transformers.js version, no
 * timestamp mode, no language forcing, no pipeline version.
 *
 * The consequence is that "the metric did not move" is indistinguishable from "the
 * fixture is stale", and a change to the transcription stage (model, timestamp mode,
 * language detection, prompt, chunking, separation) cannot fail any test, because no
 * test produces a transcript from audio.
 *
 * This module cannot recover provenance that was never recorded. What it can do, and
 * does:
 *  - name the exact configuration in force NOW, as one comparable fingerprint;
 *  - make every transcript fixture in the corpus carry an explicit entry, so
 *    "unknown" is a recorded fact rather than an absence;
 *  - refuse to let the set of unverified fixtures grow silently — adding a fixture,
 *    or changing the transcription config, fails the guard until someone records it.
 *
 * It deliberately does not hash the fixture CONTENTS: that would fail on any
 * legitimate re-derivation and would not tell you what produced them.
 */

const here = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = join(here, '..', 'fixtures')

/**
 * The transcription configuration in force today, in the terms that actually change
 * the timestamps we align against. Kept as explicit fields rather than a single
 * opaque hash so a failure message says which part moved.
 */
export interface WhisperConfig {
  /** `whisperBackend()` — hard-wired to WASM. See inferenceBackend.ts: onnxruntime's
   * WebGPU backend cannot produce correct long-form Whisper timestamps. */
  device: string
  dtype: string
  /** Default model for every transcribing tier (`models.ts`). */
  model: string
  /** Model when "high accuracy" is requested. */
  modelHighAccuracy: string
  /** `preferredWhisperTimestampMode()` — currently a constant. */
  defaultTimestampMode: string
  /** Forced language for the second pass of a mixed-language sheet. */
  forcedSecondPassLanguage: string
  /** Granularity the forced second pass always uses. */
  forcedSecondPassTimestampMode: string
  /** `ALIGNMENT_PIPELINE_VERSION` — the source labels it belongs to. */
  alignmentPipelineVersion: number
}

/**
 * Read the live config. Imports the real modules rather than restating their values,
 * so this guard breaks when the code changes rather than when someone forgets to edit
 * a copy. `whisperPipeline.ts` resolves the transformers.js pipeline lazily and is not
 * imported here (it pulls a browser-only dependency graph).
 */
export async function currentWhisperConfig(): Promise<WhisperConfig> {
  const { whisperBackend } = await import('../../../src/ai-pipeline/inferenceBackend')
  const { WHISPER_MODEL_SMALL, WHISPER_MODEL_MEDIUM } = await import('../../../src/ai-pipeline/models')
  const { preferredWhisperTimestampMode } = await import('../../../src/ai-pipeline/alignTimestampMode')
  const { ALIGNMENT_PIPELINE_VERSION } = await import('../../../src/lyrics/phraseAlignment')
  const backend = whisperBackend()
  return {
    device: backend.device,
    dtype: backend.dtype,
    model: WHISPER_MODEL_SMALL,
    modelHighAccuracy: WHISPER_MODEL_MEDIUM,
    // Both arguments are ignored by that function today; passing the values the app
    // passes keeps this honest if it ever starts varying by tier or duration.
    defaultTimestampMode: preferredWhisperTimestampMode('full', 240),
    forcedSecondPassLanguage: 'en',
    forcedSecondPassTimestampMode: 'segment',
    alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION,
  }
}

/** Stable fingerprint of a config, for comparing a fixture's record to the live one. */
export function whisperConfigFingerprint(cfg: WhisperConfig): string {
  const canonical = JSON.stringify(cfg, Object.keys(cfg).sort())
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

export interface FixtureProvenance {
  /** Set when the recording pipeline was actually recorded for this fixture. */
  config?: WhisperConfig
  /** Set instead of `config` for fixtures whose origin was never written down. */
  unverified?: boolean
  /** Why it is unverified, or anything a future reader needs. */
  note?: string
}

export interface ProvenanceRegistry {
  _comment: string
  fixtures: Record<string, FixtureProvenance>
}

export function readProvenance(): ProvenanceRegistry {
  return JSON.parse(readFileSync(join(FIXTURES, 'transcript-provenance.json'), 'utf8')) as ProvenanceRegistry
}

export interface CorpusSong {
  name: string
  transcript: string
  transcriptEn?: string
}

export function readCorpus(): { songs: CorpusSong[] } {
  return JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as { songs: CorpusSong[] }
}

/** Every transcript file the corpus actually aligns against (JA + forced-EN rows). */
export function corpusTranscriptPaths(corpus = readCorpus()): string[] {
  const paths = new Set<string>()
  for (const s of corpus.songs) {
    paths.add(s.transcript)
    if (s.transcriptEn) paths.add(s.transcriptEn)
  }
  return [...paths].sort()
}
