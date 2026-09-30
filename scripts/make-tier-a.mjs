/**
 * Tier A committed audio: deterministic, legally shippable, CI-runnable.
 *
 * WHY (plan item W0.5, docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md):
 * no audio was in the repository. `.gitignore` excludes `public/e2e/` and `.cache/`
 * because the staged recordings are copyrighted, so every transcript fixture is a
 * snapshot of one machine and the audio -> transcript half of the pipeline had ZERO
 * regression coverage. Nothing could fail when the model, timestamp mode, language
 * forcing, chunking or separation changed.
 *
 * WHAT THIS PRODUCES, AND WHAT IT DOES NOT.
 *
 * These clips are synthesized here, from this file, so they are the project's own
 * work and can be committed. They carry a deterministic harmonic carrier with
 * syllable-shaped envelopes standing in for singing. That is enough to give the
 * AUDIO-FEATURE path real, known-by-construction ground truth, which is what makes
 * them useful:
 *
 *   - the vocal-activity envelope actually finds voiced stretches and onsets;
 *   - a global-offset estimator actually recovers a known shift from real samples;
 *   - and it correctly REFUSES when a vocal is masked in its own band.
 *
 * They do NOT validate lyric alignment, and must never be used to claim it: a
 * synthesized carrier has no words, so nothing here can tell you whether a lyric
 * line lands on the right syllable. Absolute lyric accuracy still requires real
 * singing — see `manifest.json`'s `pendingUserRecordings` and plan W0.4/W4.3.
 * Every entry is tagged `purpose: "dsp-plumbing"` and `claimsLyrics: false`.
 *
 * DETERMINISM: a fixed PRNG seed and integer sample math, so re-running produces
 * byte-identical files and a stale hash is a real error rather than noise.
 *
 * Run: npx tsx scripts/make-tier-a.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'tests/ai-pipeline/fixtures/tier-a')

/** Whisper's rate; the app resamples to this, so fixtures do too. */
const SR = 16000

/** Mulberry32 — tiny, fast, and identical across runs and platforms. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A syllable: harmonic stack with a vocal-ish formant tilt and an ADSR envelope
 * whose attack is short enough to read as an ONSET in the vocal band. */
function syllable(out, startSec, durSec, f0, gain) {
  const start = Math.round(startSec * SR)
  const n = Math.round(durSec * SR)
  const attack = Math.round(0.03 * SR)
  const release = Math.round(0.06 * SR)
  for (let i = 0; i < n; i++) {
    const idx = start + i
    if (idx < 0 || idx >= out.length) continue
    const t = i / SR
    let env = 1
    if (i < attack) env = i / attack
    else if (i > n - release) env = Math.max(0, (n - i) / release)
    let v = 0
    // Harmonics 1..8 with a 1/k tilt plus a formant bump near 700 Hz, which keeps
    // most energy inside the envelope's 150-4000 Hz band.
    for (let k = 1; k <= 8; k++) {
      const f = f0 * k
      if (f > 3800) break
      const formant = 1 + 1.6 * Math.exp(-((f - 700) ** 2) / (2 * 320 ** 2))
      v += (Math.sin(2 * Math.PI * f * t + k) / k) * formant
    }
    out[idx] += v * env * gain * 0.25
  }
}

/** Broadband bed, either concentrated BELOW the vocal band (a busy mix whose masking
 * sits outside 150-4000 Hz: bass and kick) or INSIDE it (a vocal buried by guitars).
 *
 * The 'low' variant is built from sine tones at 45-95 Hz, NOT from a one-pole-filtered
 * noise. A single one-pole at 0.25 coefficient has its corner near 640 Hz, which is
 * squarely inside the envelope's 150-4000 Hz band — the first version of this file did
 * that and the "silent intro" then read as voiced from t=0. Bass must actually be bass. */
function bed(out, durSec, amplitude, band, seed) {
  const rand = rng(seed)
  const n = Math.min(out.length, Math.round(durSec * SR))
  if (band === 'low') {
    // A few sub-vocal partials with slow amplitude movement.
    const partials = [45, 58, 72, 95]
    for (let i = 0; i < n; i++) {
      const t = i / SR
      let v = 0
      for (let k = 0; k < partials.length; k++) {
        const am = 0.7 + 0.3 * Math.sin(2 * Math.PI * (0.31 + 0.07 * k) * t)
        v += Math.sin(2 * Math.PI * partials[k] * t) * am
      }
      out[i] += (v / partials.length) * amplitude * 0.3
    }
    return
  }
  for (let i = 0; i < n; i++) {
    out[i] += (rand() * 2 - 1) * amplitude * 0.25
  }
}

/** Slow level ramp over a section, in dB. */
function applyLevel(out, fromSec, toSec, gain) {
  const a = Math.round(fromSec * SR)
  const b = Math.min(out.length, Math.round(toSec * SR))
  for (let i = a; i < b; i++) out[i] *= gain
}

function wavMono(samples, sampleRate) {
  const header = Buffer.alloc(44)
  const dataBytes = samples.length * 2
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  const data = Buffer.alloc(dataBytes)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }
  return Buffer.concat([header, data])
}

/**
 * The suite. Each clip names the condition it exists to exercise, and — where it has
 * a carrier — the TRUE onset times the estimator must recover.
 */
const CLIPS = [
  {
    file: 'onsets-clean.wav',
    sec: 14,
    condition: 'clean carrier: unambiguous onsets, nothing masking',
    expect: 'offsets recoverable',
    build: (out) => {
      const onsets = [1.0, 2.4, 3.8, 5.1, 6.6, 8.0, 9.3, 10.7, 12.1]
      for (const t of onsets) syllable(out, t, 0.9, 190 + 30 * Math.sin(t), 0.9)
      return { onsets }
    },
  },
  {
    file: 'onsets-over-bass-bed.wav',
    sec: 14,
    condition: 'same onsets under a loud BED OUTSIDE the vocal band (busy mix, bass/drums)',
    expect: 'offsets recoverable',
    build: (out) => {
      const onsets = [1.2, 2.6, 4.0, 5.3, 6.8, 8.2]
      bed(out, 14, 1.4, 'low', 11)
      for (const t of onsets) syllable(out, t, 0.9, 200, 0.55)
      return { onsets }
    },
  },
  {
    file: 'silent-intro.wav',
    sec: 14,
    condition: 'long intro with NO carrier before the first onset',
    expect: 'first onset located after the intro, not at t=0',
    build: (out) => {
      bed(out, 14, 0.5, 'low', 23)
      const onsets = [7.0, 8.4, 9.9, 11.3, 12.6]
      for (const t of onsets) syllable(out, t, 0.9, 210, 0.8)
      return { onsets, introSec: 7.0 }
    },
  },
  {
    file: 'instrumental-break.wav',
    sec: 16,
    condition: 'carrier, then a vocal-free break, then carrier again',
    expect: 'the break reads as unvoiced, not as a smeared onset',
    build: (out) => {
      const first = [1.0, 2.3, 3.6, 4.9]
      const second = [12.0, 13.3, 14.6]
      for (const t of first) syllable(out, t, 0.9, 195, 0.85)
      bed(out, 16, 0.6, 'low', 37)
      for (const t of second) syllable(out, t, 0.9, 195, 0.85)
      return { onsets: [...first, ...second], breakSec: [6.0, 11.5] }
    },
  },
  {
    file: 'level-change.wav',
    sec: 14,
    condition: 'quiet carrier (-14 dB) then loud carrier — the quiet-verse case',
    expect: 'onsets found in BOTH halves despite a 14 dB level change',
    build: (out) => {
      const quiet = [1.0, 2.4, 3.8, 5.2]
      const loud = [7.0, 8.4, 9.8, 11.2, 12.6]
      for (const t of quiet) syllable(out, t, 0.9, 200, 0.85)
      for (const t of loud) syllable(out, t, 0.9, 200, 0.85)
      applyLevel(out, 0, 6.5, 0.2)
      return { onsets: [...quiet, ...loud], quietSec: [0, 6.5] }
    },
  },
  {
    file: 'masked-carrier.wav',
    sec: 14,
    condition: 'carrier buried under a bed INSIDE the same 150-4000 Hz band',
    expect: 'estimator must REFUSE (inconclusive), not guess',
    build: (out) => {
      const onsets = [1.0, 2.4, 3.8, 5.2, 6.6, 8.0, 9.4, 10.8, 12.2]
      bed(out, 14, 3.2, 'full', 53)
      for (const t of onsets) syllable(out, t, 0.9, 200, 0.18)
      return { onsets, masked: true }
    },
  },
]

mkdirSync(OUT, { recursive: true })
const entries = []
for (const clip of CLIPS) {
  const out = new Float32Array(Math.round(clip.sec * SR))
  const meta = clip.build(out)
  const buf = wavMono(out, SR)
  const path = join(OUT, clip.file)
  writeFileSync(path, buf)
  entries.push({
    file: clip.file,
    sampleRate: SR,
    durationSec: clip.sec,
    /** Constants for the file's bytes: a change here means the fixture moved. */
    sha256: createHash('sha256').update(buf).digest('hex'),
    purpose: 'dsp-plumbing',
    claimsLyrics: false,
    condition: clip.condition,
    expect: clip.expect,
    trueOnsets: meta.onsets,
    ...(meta.introSec != null ? { introSec: meta.introSec } : {}),
    ...(meta.breakSec ? { breakSec: meta.breakSec } : {}),
    ...(meta.quietSec ? { quietSec: meta.quietSec } : {}),
    ...(meta.masked ? { masked: true } : {}),
  })
  console.log(`${clip.file.padEnd(26)} ${(buf.length / 1024).toFixed(0).padStart(4)} KiB  ${clip.condition}`)
}

const manifest = {
  _comment:
    'Tier A committed audio (plan W0.5). Synthesized by scripts/make-tier-a.mjs — deterministic, so re-running reproduces these bytes and a hash mismatch is a real error. These clips exercise the AUDIO-FEATURE path (vocal-activity envelope, onset detection, global-offset estimation) against ground truth known by construction. They contain NO WORDS and must never be used to claim lyric-alignment accuracy; see pendingUserRecordings.',
  generator: 'scripts/make-tier-a.mjs',
  sampleRate: SR,
  clips: entries,
  pendingUserRecordings: {
    why: 'Absolute lyric accuracy cannot be validated without real singing. Synthesizing a voice and calling the result a lyric-accuracy measurement is the one thing this corpus must not do.',
    what: 'Record 8-10 clips of your own singing, 55-75s each, into tests/ai-pipeline/fixtures/tier-a/source/ (any WAV/MP3), with the sung lyrics beside them as <name>.lyrics.txt. Cover: sung Japanese, sung English, mixed JA/EN, fast delivery, a repeated chorus, spoken intro, ad-libs over the lead, and one deliberately mismatched lyrics sheet.',
    then: 'Run scripts/make-tier-a.mjs --from-source to emit deterministic, degraded variants (reverb, tempo/pitch shift, level changes) plus their manifests, and wire them into the accuracy gate. See plan W0.5 and W4.3.',
  },
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`\nwrote ${entries.length} clips + manifest.json to tests/ai-pipeline/fixtures/tier-a`)
