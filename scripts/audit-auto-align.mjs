/**
 * Audits Whisper-based auto-align timing for a song: decode mp3 -> transcribe
 * (real Whisper model) -> alignLyrics (real contentAligner/proportional logic).
 * Run: npx tsx scripts/audit-auto-align.mjs <name> <mp3-path> <lyrics-file>
 * <lyrics-file> is a plain text file, one lyric line per line (blank lines kept
 * as blank lyric lines are dropped — see lineTexts filter below if needed).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function fmt(t) {
  if (!Number.isFinite(t)) return '--:--.--'
  const m = Math.floor(t / 60)
  const s = (t % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}

async function main() {
  const [, , name, mp3Path, lyricsPath] = process.argv
  if (!name || !mp3Path || !lyricsPath) {
    console.error('Usage: audit-auto-align.mjs <name> <mp3-path> <lyrics-file>')
    process.exit(1)
  }

  const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
  const { transcribeAudio } = await import(pathToFileURL(join(root, 'scripts/lib/nodeWhisper.mjs')).href)
  const { alignLyrics, sanitizeTranscript } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href
  )

  const lineTexts = readFileSync(lyricsPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  console.log(`=== ${name} ===`)

  const cacheDir = join(root, '.cache', 'auto-align-audit')
  const cachePath = join(cacheDir, `${name.replace(/\W+/g, '_')}.json`)
  const useCache = !process.argv.includes('--refresh')

  let result
  if (useCache && existsSync(cachePath)) {
    console.log(`Using cached transcript: ${cachePath} (pass --refresh to re-transcribe)`)
    result = JSON.parse(readFileSync(cachePath, 'utf8'))
  } else {
    console.log(`Decoding ${mp3Path}...`)
    const { data, sampleRate } = await decodeMp3ToMono(mp3Path)
    console.log(`Decoded: ${data.length} samples @ ${sampleRate}Hz (${(data.length / sampleRate).toFixed(1)}s)`)

    console.log('Transcribing with Whisper (this can take a few minutes on CPU)...')
    const t0 = Date.now()
    result = await transcribeAudio(data, sampleRate, {
      language: 'japanese',
      onProgress: (p) => process.stdout.write(`\r  transcribe progress: ${p}%   `),
    })
    console.log(`\nTranscribed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(result))
    console.log(`Cached transcript to ${cachePath}`)
  }

  const words = (result.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
  console.log(`Raw transcript words: ${words.length}`)
  const clean = sanitizeTranscript(words)
  console.log(`After sanitizeTranscript: ${clean.length} (dropped ${words.length - clean.length} hallucination/garbage tokens)`)
  console.log(`\nFull Whisper text:\n${result.text}\n`)

  const { lines, mode, confidence } = alignLyrics(lineTexts, words, undefined, 'ja')
  console.log(`Alignment mode: ${mode}  confidence: ${confidence.toFixed(3)}\n`)

  console.log('Line timings:')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const dur = l.endTime - l.startTime
    const flag = dur <= 0 ? '  <-- zero/negative duration' : dur > 20 ? '  <-- suspiciously long' : ''
    console.log(`${String(i + 1).padStart(2)} [${fmt(l.startTime)} - ${fmt(l.endTime)}] (${dur.toFixed(2)}s) ${lineTexts[i]}${flag}`)
  }

  if (process.argv.includes('--dump-words')) {
    console.log('\nSanitized transcript words (time-ordered):')
    for (const w of clean) {
      console.log(`  [${fmt(w.startTime)} - ${fmt(w.endTime)}] ${w.word}`)
    }
  }

  // Monotonicity / overlap sanity check.
  let issues = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startTime < lines[i - 1].startTime) {
      console.log(`! Non-monotonic start: line ${i + 1} starts before line ${i}`)
      issues++
    }
  }
  console.log(`\nMonotonicity issues: ${issues}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
