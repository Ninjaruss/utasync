/**
 * Transcribe a separated vocal stem with word-level timestamps, and cache the result.
 *
 * WHY THIS EXISTS. Every accuracy claim in this project is scored against LRCLIB timestamps, which
 * is a fair arbiter for "do we agree with another transcription" and cannot answer "does the line
 * start where the singing starts". Two cheaper attempts to get an acoustic arbiter both failed:
 * the envelope offset screen (L17) peaks ~1s from the truth on real singing, and the flux-peak
 * metric (L28) is saturated — peaks land every 0.17-0.19s, so a random timestamp scores as well as
 * a correct one.
 *
 * Whisper's word timestamps are the model-based arbiter that has the resolution the question needs.
 * Run on an ISOLATED VOCAL STEM rather than the mix, the only content is the singing, so a word's
 * timestamp is anchored to the vocal event itself. That makes "where does this line's first word
 * actually start" an independent measurement rather than another opinion.
 *
 * Cost is why the output is cached to JSON: separation is the slow half in the app's own flow, and
 * transcription of a 4-minute song is minutes of CPU. The cache means the scoring can be iterated
 * on without paying for the model again.
 *
 * Run: npx tsx scripts/transcribe-stem.mjs <stem.f32> <out.json> [--language japanese] [--model id]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const stemPath = process.argv[2]
const outPath = process.argv[3]
if (!stemPath || !outPath) {
  console.error('Usage: npx tsx scripts/transcribe-stem.mjs <stem.f32> <out.json> [--language japanese]')
  process.exit(1)
}
// A cached result is the whole point: re-running Whisper to re-score is minutes wasted.
if (existsSync(outPath) && !process.argv.includes('--force')) {
  const cached = JSON.parse(readFileSync(outPath, 'utf8'))
  console.log(`cached: ${outPath} (${cached.words.length} words, ${cached.modelId}, ${cached.language}) — pass --force to redo`)
  process.exit(0)
}

const { transcribeAudio } = await import(pathToFileURL(join(root, 'scripts/lib/nodeWhisper.mjs')).href)

/**
 * Raw Float32LE mono (a separated stem) or any container the repo can decode. Supporting the mix
 * as well as the stem is what makes the LIVE-vs-FIXTURE question answerable: the audit's stored
 * transcripts and a transcription the app would actually produce can then be compared through the
 * same instrument, which is how L32's discrepancy was found.
 */
let data
let SAMPLE_RATE
if (stemPath.endsWith('.f32') || stemPath.endsWith('.pcm')) {
  SAMPLE_RATE = 44100
  const buf = readFileSync(stemPath)
  data = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
} else {
  const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
  const decoded = await decodeMp3ToMono(stemPath)
  data = decoded.data
  SAMPLE_RATE = decoded.sampleRate
}
const durationSec = data.length / SAMPLE_RATE
const language = argValue('--language', 'japanese')
const model = argValue('--model', undefined)
console.log(`stem ${stemPath}: ${durationSec.toFixed(1)}s @ ${SAMPLE_RATE}Hz, language=${language}`)

/** Whisper on a stem is the same call the app makes; `word` mode is what gives per-word times. */
const started = Date.now()
let lastLogged = -10
const result = await transcribeAudio(data, SAMPLE_RATE, {
  language,
  timestampMode: 'word',
  ...(model ? { model } : {}),
  onProgress: (pct) => {
    if (pct >= lastLogged + 10) {
      lastLogged = pct
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      console.log(`  ${pct}% after ${mins} min`)
    }
  },
})

const words = (result?.chunks ?? [])
  .map((c) => ({
    word: (c.text ?? '').trim(),
    start: Array.isArray(c.timestamp) ? c.timestamp[0] : null,
    end: Array.isArray(c.timestamp) ? c.timestamp[1] : null,
  }))
  .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end))

const elapsedSec = (Date.now() - started) / 1000
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify({
  source: stemPath,
  sampleRate: SAMPLE_RATE,
  durationSec,
  language,
  modelId: model ?? 'Xenova/whisper-small (default)',
  transcribedAt: new Date().toISOString(),
  elapsedSec: Math.round(elapsedSec),
  words,
}, null, 1))

console.log(`wrote ${outPath}: ${words.length} words in ${elapsedSec.toFixed(0)}s`)
console.log(`first 5: ${words.slice(0, 5).map((w) => `${w.word}@${w.start.toFixed(2)}`).join(' | ')}`)
