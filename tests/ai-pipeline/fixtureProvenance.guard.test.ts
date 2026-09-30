import { describe, it, expect } from 'vitest'
import {
  corpusTranscriptPaths,
  currentWhisperConfig,
  readProvenance,
  whisperConfigFingerprint,
} from './helpers/whisperProvenance'

/**
 * Every committed Whisper transcript fixture must declare its provenance, and the
 * set of fixtures whose origin is UNKNOWN must not grow (plan item W0.3,
 * docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md).
 *
 * The audio these were produced from is deliberately not in the repository, so none
 * of them can be re-derived by anyone else; before this guard they also recorded
 * nothing about how they were made. That combination made "the metric did not move"
 * indistinguishable from "the fixture is stale".
 *
 * What this locks:
 *  1. Every transcript the audit corpus aligns against has a registry entry.
 *  2. A fixture that records a config is checked against the LIVE config's
 *     fingerprint, so changing the model, dtype, device, timestamp mode, forced
 *     -language policy, or ALIGNMENT_PIPELINE_VERSION fails here loudly instead of
 *     silently invalidating every number computed from it.
 *  3. The number of fixtures declared `unverified` equals a recorded count. Lowering
 *     that count requires re-deriving a fixture (plan W0.5 needs committed audio);
 *     raising it requires a deliberate edit, with a reason, in the registry.
 *  4. No fixture may be both verified and unverified, or carry a reason-less entry.
 */

const registry = readProvenance()
const corpusPaths = corpusTranscriptPaths()

// Recorded in the registry's _unverifiedBaseline. See the note there: these predate
// provenance, and their true config is unknowable rather than merely unrecorded.
// The 18 corpus transcripts plus one retained-unreferenced forced-EN word pass.
const EXPECTED_UNVERIFIED = 19

describe('Whisper transcript fixture provenance', () => {
  it('declares provenance for every transcript the corpus aligns against', () => {
    const missing = corpusPaths.filter((p) => !registry.fixtures[p])
    expect(
      missing,
      'these corpus transcripts have no registry entry — add one to tests/ai-pipeline/fixtures/transcript-provenance.json',
    ).toEqual([])
    // And the corpus must be the only thing we claim to cover.
    expect(corpusPaths.length).toBeGreaterThan(0)
  })

  it('does not let the unverified set grow silently', () => {
    const unverified = Object.entries(registry.fixtures)
      .filter(([, v]) => v.unverified)
      .map(([k]) => k)
    expect(
      unverified.length,
      `unverified transcript fixtures: ${unverified.length} (recorded baseline ${EXPECTED_UNVERIFIED}). ` +
        'A new fixture must either record the config that produced it, or be added to the registry ' +
        'with a reason AND this count raised deliberately. See _unverifiedBaseline in the registry.',
    ).toBe(EXPECTED_UNVERIFIED)
  })

  it('keeps every entry unambiguous and explained', () => {
    for (const [path, entry] of Object.entries(registry.fixtures)) {
      expect(!!entry.config, `${path}: declares config`).not.toBe(!!entry.unverified)
      expect((entry.note ?? '').length, `${path}: has an explanatory note`).toBeGreaterThan(10)
    }
  })

  it('matches a recorded config against the config actually in force', async () => {
    const live = whisperConfigFingerprint(await currentWhisperConfig())
    // Fixtures that DO record a config must still agree with today's pipeline: a
    // mismatch means the code changed and the fixture must be re-derived.
    for (const [path, entry] of Object.entries(registry.fixtures)) {
      if (!entry.config) continue
      expect(
        whisperConfigFingerprint(entry.config),
        `${path} was produced by a different transcription config than the one in force — re-derive it`,
      ).toBe(live)
    }
  })

  it('records, rather than hides, the fact that nothing is verified yet', () => {
    // Honesty about vacuity. The loop above currently iterates ZERO times, because all 19
    // fixtures are `unverified` — so on its own it proves nothing, and a test that cannot
    // fail is the defect this entire plan exists to remove. This assertion makes that
    // vacuity explicit and forces it to be updated deliberately: the moment a fixture
    // records a real config, this fails, and whoever added it must confirm the
    // comparison above is actually exercising something.
    const withConfig = Object.entries(registry.fixtures)
      .filter(([, v]) => v.config)
      .map(([k]) => k)
    expect(
      withConfig,
      'a fixture now records a config — confirm the comparison above is non-vacuous, then drop this assertion',
    ).toEqual([])
  })

  it('proves the config comparison works, on a constructed entry', async () => {
    // The mechanism the loop above depends on, proven without needing real Whisper output.
    // No model is available in this environment, and adding an unrun harness would be
    // worth less than this assertion; when scripts DO re-derive a transcript against
    // committed audio, this is the comparison that accepts it.
    const liveCfg = await currentWhisperConfig()
    const live = whisperConfigFingerprint(liveCfg)
    expect(whisperConfigFingerprint({ ...liveCfg })).toBe(live)
    const mutations: Array<[string, Partial<typeof liveCfg>]> = [
      ['model', { model: 'Xenova/whisper-tiny' }],
      ['modelHighAccuracy', { modelHighAccuracy: 'Xenova/whisper-tiny' }],
      ['defaultTimestampMode', { defaultTimestampMode: 'segment' }],
      ['forcedSecondPassTimestampMode', { forcedSecondPassTimestampMode: 'word' }],
      ['forcedSecondPassLanguage', { forcedSecondPassLanguage: 'ja' }],
      ['device', { device: 'webgpu' }],
      ['dtype', { dtype: 'fp16' }],
      ['alignmentPipelineVersion', { alignmentPipelineVersion: liveCfg.alignmentPipelineVersion - 1 }],
    ]
    for (const [field, mutation] of mutations) {
      expect(
        whisperConfigFingerprint({ ...liveCfg, ...mutation }),
        `${field} must be able to break the fingerprint on its own`,
      ).not.toBe(live)
    }
  })

  it('fingerprints the configuration fields that actually move timestamps', async () => {
    const cfg = await currentWhisperConfig()
    // Guards the guard: if a field is dropped from WhisperConfig, this fails rather
    // than the fingerprint quietly covering less.
    expect(Object.keys(cfg).sort()).toEqual(
      [
        'alignmentPipelineVersion',
        'defaultTimestampMode',
        'device',
        'dtype',
        'forcedSecondPassLanguage',
        'forcedSecondPassTimestampMode',
        'model',
        'modelHighAccuracy',
      ].sort(),
    )
    // A fingerprint must actually depend on its contents.
    const changed = whisperConfigFingerprint({ ...cfg, model: 'someone/else' })
    expect(changed).not.toBe(whisperConfigFingerprint(cfg))
  })

  it('records the wasm/q8 backend, because that hard-wiring is load-bearing', async () => {
    // Word mode rides transformers.js's long-form merge precisely BECAUSE
    // transcription is pinned to WASM (see inferenceBackend.ts). If this ever
    // changes, every transcript fixture is stale and the long-form word-merge
    // caveat in alignTimestampMode.ts needs re-measuring.
    const cfg = await currentWhisperConfig()
    expect(cfg.device).toBe('wasm')
    expect(cfg.dtype).toBe('q8')
  })
})
