/**
 * Transcribe an audio file with the app's Whisper model, from Node.
 *
 * Usage:
 *   npx tsx scripts/transcribe-file.mjs <audio.mp3> [--language auto|japanese|english] \
 *     [--mode word|segment] [--model <id>] [--out path.json]
 *
 * Output: { chunks: [{ text, timestamp: [start, end] }] } — the fixture format
 * accepted by scripts/audit-corpus.mjs and the tests' loadWords helpers.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

function normalizeChunks(result) {
  if (Array.isArray(result?.chunks)) {
    return result.chunks
      .map((c) => ({ text: c.text, timestamp: c.timestamp }))
      .filter((c) => c.text && Array.isArray(c.timestamp) && c.timestamp.length === 2)
  }
  if (Array.isArray(result?.words)) {
    return result.words
      .map((w) => ({ text: w.word ?? w.text, timestamp: [w.startTime ?? w.start, w.endTime ?? w.end] }))
      .filter((c) => c.text && Number.isFinite(c.timestamp[0]) && Number.isFinite(c.timestamp[1]))
  }
  return []
}

async function main() {
  const input = process.argv[2]
  if (!input || input.startsWith('--')) {
    console.error('Usage: npx tsx scripts/transcribe-file.mjs <audio.mp3> [--language auto|japanese|english] [--mode word|segment] [--model <id>] [--out path.json]')
    process.exit(1)
  }
  const language = argValue('--language', 'japanese')
  const mode = argValue('--mode', 'word')
  const model = argValue('--model', 'Xenova/whisper-small')
  const out = argValue('--out', `${input}.${mode}.${language}.json`)

  const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
  const { transcribeAudio } = await import(pathToFileURL(join(root, 'scripts/lib/nodeWhisper.mjs')).href)

  console.log(`decoding ${input}...`)
  const { data, sampleRate } = await decodeMp3ToMono(input)
  console.log(`transcribing (${mode} timestamps, language=${language}, model=${model})...`)
  const result = await transcribeAudio(data, sampleRate, {
    language,
    timestampMode: mode,
    model,
    onProgress: (p) => process.stdout.write(`\r  ${p}%`),
  })
  process.stdout.write('\n')
  const chunks = normalizeChunks(result)
  writeFileSync(out, JSON.stringify({ chunks }, null, 1))
  console.log(`wrote ${chunks.length} chunks -> ${out}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
