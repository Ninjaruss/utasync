import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { scoreLineAlignment } from '../../src/ai-pipeline/contentAligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import type { TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const CACHE = join(root, '.cache/auto-align-audit')
const OUT = join(root, '.cache/user-mp3-audit')

const AKFG_MP3 =
  '/Users/ninjaruss/Downloads/asian-kung-fu-generation-rockn-roll-morning-light-falls-on-you-the-first-take-128-ytshorts.savetube.me.mp3'
const VEIL_MP3 =
  '/Users/ninjaruss/Downloads/xu-tian-jing-ci-veil-mv-128-ytshorts.savetube.me.mp3'

const AKFG_LYRICS = join(here, 'fixtures/akfg-user-ja.txt')
const VEIL_LYRICS = join(here, 'fixtures/veil/lyrics.ja.txt')

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '--:--'
  const m = Math.floor(t / 60)
  return `${m}:${(t % 60).toFixed(1).padStart(4, '0')}`
}

function loadTranscript(cacheName: string) {
  const path = join(CACHE, cacheName)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const words = sanitizeTranscript(
    (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
      return [{ word, startTime: start, endTime: end }]
    }),
  )
  return { words, path }
}

function analyzeSong(
  name: string,
  lineTexts: string[],
  words: ReturnType<typeof sanitizeTranscript>,
  refined: ReturnType<typeof refineAlignmentWithPhrases>,
): string {
  const { lines, mode, confidence, anchorSources, lineAlignmentQuality, report, phraseLayout } =
    refined
  const linesOut: string[] = []
  linesOut.push(`=== ${name} ===`)
  linesOut.push(
    `mode=${mode} confidence=${confidence.toFixed(3)} layout=${phraseLayout} lines=${lines.length}/${lineTexts.length}`,
  )
  linesOut.push(`phrases: merges=${report.merges} splits=${report.splits} lowConf=${report.lowConfidence}`)
  const qCounts = { good: 0, approximate: 0, needs_review: 0 }
  for (const q of lineAlignmentQuality ?? []) {
    if (q === 'good') qCounts.good++
    else if (q === 'approximate') qCounts.approximate++
    else qCounts.needs_review++
  }
  linesOut.push(`quality: good=${qCounts.good} approx=${qCounts.approximate} needs_review=${qCounts.needs_review}`)
  const lcs = anchorSources?.filter((s) => s === 'lcs').length ?? 0
  const interp = anchorSources?.filter((s) => s === 'interpolated').length ?? 0
  linesOut.push(`anchors: lcs=${lcs} interpolated=${interp}`)

  linesOut.push('\n--- flagged lines ---')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const dur = l.endTime - l.startTime
    const q = lineAlignmentQuality?.[i]
    const src = anchorSources?.[i]
    const windowWords = words.filter(
      (w) => w.endTime > l.startTime - 4 && w.startTime < l.endTime + 6,
    )
    const rescore = scoreLineAlignment(l.original, windowWords, 'ja')
    const flags: string[] = []
    if (q === 'needs_review') flags.push('needs_review')
    if (src === 'interpolated') flags.push('interp-anchor')
    if (dur <= 0.1) flags.push('zero-dur')
    if (dur > 18) flags.push('long-dur')
    if (rescore.quality === 'needs_review' && q !== 'good') flags.push(`rescore=${rescore.coverage.toFixed(2)}`)
    if (flags.length === 0) continue
    linesOut.push(
      `#${i + 1} [${fmt(l.startTime)}-${fmt(l.endTime)}] (${dur.toFixed(1)}s) ${flags.join(' ')} | ${l.original.slice(0, 50)}`,
    )
  }

  linesOut.push('\n--- all timings ---')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const dur = l.endTime - l.startTime
    linesOut.push(
      `${String(i + 1).padStart(2)} [${fmt(l.startTime)}-${fmt(l.endTime)}] q=${lineAlignmentQuality?.[i] ?? '?'} src=${anchorSources?.[i] ?? '?'} | ${l.original}`,
    )
    if (dur <= 0) linesOut.push('    ^ zero duration')
  }

  let monoIssues = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startTime < lines[i - 1].startTime) monoIssues++
  }
  linesOut.push(`\nmonotonicity issues: ${monoIssues}`)
  return linesOut.join('\n')
}

async function mp3DurationSec(path: string): Promise<number | null> {
  if (!existsSync(path)) return null
  try {
    const { decodeMp3ToMono } = await import(
      pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href
    )
    const { data, sampleRate } = await decodeMp3ToMono(path)
    return data.length / sampleRate
  } catch {
    return null
  }
}

describe.skipIf(!existsSync(AKFG_MP3) || !existsSync(join(CACHE, 'AKFG_FirstTake_segment.json')))(
  'User AKFG MP3 audit',
  () => {
    it('aligns with segment transcript and writes report', async () => {
      const duration = await mp3DurationSec(AKFG_MP3)
      const lineTexts = readFileSync(AKFG_LYRICS, 'utf8')
        .trim()
        .split('\n')
      const { words, path: cachePath } = loadTranscript('AKFG_FirstTake_segment.json')
      const sheetRows: TimedLine[] = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const report = analyzeSong('AKFG First Take', lineTexts, words, refined)
      mkdirSync(OUT, { recursive: true })
      writeFileSync(join(OUT, 'akfg-report.txt'), `${report}\n\nmp3=${AKFG_MP3}\nduration=${duration?.toFixed(1)}s\ncache=${cachePath}\n`)

    expect(refined.lines).toHaveLength(30)
    expect(refined.phraseLayout).toBe('sheet')
    expect(refined.mode).toBe('content')
    expect(refined.lineAlignmentQuality?.filter((q) => q === 'needs_review').length ?? 99).toBeLessThanOrEqual(2)

      const red = refined.lines.find((l) => l.original.includes('赤い 赤い'))
      const corner = refined.lines.find((l) => l.original.includes('角を曲が'))
      const finalRun = refined.lines.find((l) => l.original.includes('凍てつく世界'))
      expect(red?.startTime).toBeGreaterThan(255)
      expect(corner!.startTime).toBeGreaterThan(red!.startTime)
      expect(finalRun!.endTime - finalRun!.startTime).toBeGreaterThan(2)
    })
  },
)

describe.skipIf(!existsSync(VEIL_MP3) || !existsSync(join(CACHE, 'veil.json')))(
  'User Veil MP3 audit',
  () => {
    it('aligns with word transcript and writes report', async () => {
      const duration = await mp3DurationSec(VEIL_MP3)
      const lineTexts = readFileSync(VEIL_LYRICS, 'utf8')
        .trim()
        .split('\n')
      const { words, path: cachePath } = loadTranscript('veil.json')
      const sheetRows: TimedLine[] = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const report = analyzeSong('Veil', lineTexts, words, refined)
      mkdirSync(OUT, { recursive: true })
      writeFileSync(join(OUT, 'veil-report.txt'), `${report}\n\nmp3=${VEIL_MP3}\nduration=${duration?.toFixed(1)}s\ncache=${cachePath}\n`)

      expect(refined.lines).toHaveLength(lineTexts.length)
      expect(refined.mode).toBe('content')
      expect(refined.lineAlignmentQuality?.filter((q) => q === 'needs_review').length ?? 99).toBeLessThan(11)

      const saveYou = refined.lines.filter((l) => l.original.includes('あなたを救えない'))
      expect(saveYou.length).toBe(3)
      for (const row of saveYou) {
        expect(row.endTime - row.startTime).toBeGreaterThan(0.8)
      }
    })
  },
)
