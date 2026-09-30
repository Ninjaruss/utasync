/**
 * Tier B — the developer-run audio corpus. Generate or verify its manifest.
 *
 * WHAT TIER B IS, AND WHY IT IS NOT TIER A. The accuracy claims that matter most are about
 * SINGING: a voice that vibratos, a line that melismas across its boundary, a vocal buried
 * under same-band guitars, a live take whose lyric sheet is the studio version. Nothing
 * synthesized reproduces those, and the real recordings are copyrighted — so they are not in
 * the repository and never will be. Tier A (`tests/ai-pipeline/fixtures/tier-a/`) is the
 * committed, CI-runnable half: deterministic, legally shippable, and honestly limited to
 * speech-like material with no words.
 *
 * Tier B is the other half: hashes and metadata for audio that lives on a developer's machine
 * (here, `public/e2e/`), so that every number computed from it is reproducible by anyone who
 * holds the same files, and so that a clone which does NOT hold them is told exactly what it
 * could not measure instead of silently measuring less.
 *
 * That last clause is the point. The audit that started all this found 26 tests silently
 * skipping on a clean checkout, taking ~19 of the ~30 external-truth assertions with them,
 * and there was no way to tell from a green run that they had. This manifest is the record
 * that makes the gap legible.
 *
 * Run:
 *   npx tsx scripts/tier-b-audio.mjs --write   # (re)generate the manifest from the files
 *   npx tsx scripts/tier-b-audio.mjs --check   # verify: missing files reported, changed files fatal
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const OUT_DIR = join(root, 'tests/ai-pipeline/fixtures/tier-b')
const MANIFEST = join(OUT_DIR, 'manifest.json')
const AUDIO_DIR = join(root, 'public/e2e')

const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)

const SAMPLE_RATE_44K = 44100

/**
 * The corpus. Every entry names what it is FOR, because "which songs do we have" is a much
 * less useful question than "which failure modes does this let us measure".
 */
const FILES = [
  {
    key: 'guitar-loneliness',
    file: 'guitar.mp3',
    kind: 'mix',
    covers: ['sung Japanese', 'garbled transcript (the acoustic-onset case)', 'version-EXACT LRCLIB truth'],
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    truthQuality: 'version-exact — 229.0s LRC against 228.98s audio, so its offset is OURS',
  },
  {
    key: 'veil',
    file: 'veil.mp3',
    kind: 'mix',
    covers: ['pure Japanese', 'the clean case: best offset in the corpus (-0.02s)'],
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    truthQuality: 'version-matched (203s entry against 218.77s audio is an edit difference the median-offset fit absorbs; its residual offset is -0.02s, the best in the corpus)',
  },
  {
    key: 'stranger-than-heaven',
    file: 'stranger.mp3',
    kind: 'mix',
    covers: ['mixed JA/EN', 'the ALTERNATE-TAKE case: ~30 lines with no evidence anywhere'],
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    truthQuality: 'ONE-SIDED — a 237s edit against 233.57s audio, so its offset is partly a version difference and cannot be attributed to us',
  },
  {
    key: 'recollect',
    file: 'recollect.mp3',
    kind: 'mix',
    covers: ['dense within-line JA/EN code-switching', 'non-isolated transcript, transcription-bound'],
    lyrics: 'recollect/lyrics.txt',
    truth: 'lrc-truth/recollect.json',
    truthQuality: 'version-matched, but only 16 of 47 lines carry enough matched evidence for the offset fit — the rest are transcription-bound',
  },
  {
    key: 'akfg-first-take',
    file: 'akfg.mp3',
    kind: 'mix',
    covers: ['Japanese, THE FIRST TAKE live arrangement', '98s spoken/quiet intro', 'stem path that measurably HURTS (15.4s vs 2.8s mix)'],
    lyrics: 'akfg/lyrics.ja.txt',
    truth: null,
    truthQuality: 'no LRCLIB entry exists for the First Take arrangement; truth is YouTube caption onsets (±2s), in tests/ai-pipeline/akfg-ground-truth.test.ts',
  },
  {
    key: 'going-my-way',
    file: 'going-my-way.mp3',
    kind: 'mix',
    covers: ['sung Japanese, but NOT used by any committed test', 'a song with NO committed transcript, so its evidence must be produced locally', 'an ORPHANED truth fixture: no test in the suite consumes it'],
    lyrics: 'going-my-way/lyrics.txt',
    truth: 'lrc-truth/going-my-way.json',
    truthQuality: 'matched, but scored by NO test, and its lyric sheet was derived from this very LRC (31 of 31 lines byte-identical with the timestamps stripped), so the text is circular — see the ledger on orphaned fixtures',
  },
  {
    key: 'stranger-than-heaven.vocals',
    file: 'stranger.mp3.vocals44k.f32',
    kind: 'stem',
    sampleRate: SAMPLE_RATE_44K,
    float32: true,
    covers: ['the isolated vocal of the hardest song — the only place the documented word-mode RAMP was ever measured'],
    pairsWith: 'stranger-than-heaven',
  },
  {
    key: 'veil.vocals',
    file: 'veil.mp3.vocals44k.f32',
    kind: 'stem',
    sampleRate: SAMPLE_RATE_44K,
    float32: true,
    covers: ['a clean stem, for the acoustic-verdict calibration (ledger L15: stem verifies 5.5x more lines than the mix at equal p90)'],
    pairsWith: 'veil',
  },
]

async function describe(entry) {
  const path = join(AUDIO_DIR, entry.file)
  if (!existsSync(path)) return { ...entry, available: false }
  const buf = readFileSync(path)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const bytes = statSync(path).size
  let durationSec
  let sampleRate
  if (entry.float32) {
    sampleRate = entry.sampleRate ?? SAMPLE_RATE_44K
    durationSec = +(bytes / 4 / sampleRate).toFixed(3)
  } else {
    const decoded = await decodeMp3ToMono(path)
    sampleRate = decoded.sampleRate
    durationSec = +(decoded.data.length / decoded.sampleRate).toFixed(3)
  }
  return { ...entry, available: true, bytes, sha256, sampleRate, durationSec }
}

const mode = process.argv.includes('--write') ? 'write' : 'check'

if (mode === 'write') {
  const files = []
  for (const entry of FILES) {
    const d = await describe(entry)
    files.push(d)
    console.log(
      d.available
        ? `${d.file.padEnd(34)} ${(d.bytes / 1024 / 1024).toFixed(1).padStart(6)} MiB  ${String(d.durationSec).padStart(8)}s  ${d.sha256.slice(0, 16)}…`
        : `${d.file.padEnd(34)} MISSING`,
    )
  }
  const manifest = {
    _comment:
      'Tier B: the DEVELOPER-RUN audio corpus. These recordings are copyrighted, so the files are NOT in the repository (`.gitignore` excludes public/e2e/) and this manifest is the record instead. It exists so that (a) every number computed from this audio is reproducible by anyone holding the same bytes — the hashes are the contract — and (b) a clone WITHOUT the files can see exactly what it cannot measure, rather than silently measuring less. Guarded by tests/ai-pipeline/tierB.manifest.test.ts. Tier A (fixtures/tier-a/) is the committed, CI-runnable half and is honestly limited to speech-like, word-less material.',
    verifiedWith: 'scripts/tier-b-audio.mjs',
    audioDir: 'public/e2e',
    committable: false,
    runMeasuresWith: [
      'npx tsx scripts/tier-b-audio.mjs --check',
      'npx tsx scripts/audit-vs-lrc.mjs',
      'npx tsx scripts/align-ablation.mjs',
      'npx tsx scripts/align-drift-profile.mjs',
      'npx tsx scripts/align-trust-calibration.mjs',
    ],
    files,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  const present = files.filter((f) => f.available).length
  console.log(`\nwrote ${MANIFEST} (${present}/${FILES.length} files present on this machine)`)
} else {
  if (!existsSync(MANIFEST)) {
    console.error('No manifest — run with --write first.')
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const missing = []
  const mismatched = []
  for (const entry of manifest.files) {
    const d = await describe(entry)
    if (!d.available) {
      missing.push(entry.file)
      continue
    }
    if (d.sha256 !== entry.sha256) mismatched.push(`${entry.file}: expected ${entry.sha256.slice(0, 16)}… got ${d.sha256.slice(0, 16)}…`)
    if (Math.abs(d.durationSec - entry.durationSec) > 0.05) {
      mismatched.push(`${entry.file}: duration ${entry.durationSec}s -> ${d.durationSec}s`)
    }
  }
  if (mismatched.length) {
    console.error(`\n✗ ${mismatched.length} file(s) do not match the manifest:`)
    for (const m of mismatched) console.error(`  ${m}`)
    console.error('\nThese numbers were measured against the hashed bytes; re-run with --write only if the change is deliberate.')
    process.exit(1)
  }
  if (missing.length) {
    // Not an error: absence is the expected state on a clean checkout. It IS reported,
    // loudly, because silence is what let this corpus hide its own gaps for months.
    console.log(`\n⚠ ${missing.length}/${manifest.files.length} Tier B files are not on this machine:`)
    for (const m of missing) console.log(`  ${m}`)
    console.log('\nThe singing-specific accuracy claims CANNOT be re-measured here. Tier A still runs in CI.')
    console.log(`Place them in ${manifest.audioDir}/ to reproduce the ledger's numbers.`)
  } else {
    console.log(`\n✓ all ${manifest.files.length} Tier B files present and hash-verified.`)
  }
  console.log('\nInstruments that need this audio:')
  for (const cmd of manifest.runMeasuresWith) console.log(`  ${cmd}`)
}
