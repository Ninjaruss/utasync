/**
 * Sizes the drag re-timing window (src/player/dragTiming.ts) from evidence.
 *
 * For exactly the lines the strip actually offers -- selectAnchorTargets over
 * real aligner output, not all lines -- how far is the stored start from
 * human-synced LRC truth? The window must reach that far, because a user who
 * runs out of slider commits the clamped edge and the line is then marked
 * 'good' and never offered again.
 *
 * Reports symmetric and asymmetric candidates with their span and the resulting
 * ms-per-CSS-pixel on a 194px strip (measured live in the app at a 375px viewport).
 *
 * Run: npx tsx scripts/audit-drag-window.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const imp = (p) => import(pathToFileURL(join(root, p)).href)

const { refineAlignmentWithPhrases } = await imp('src/lyrics/phraseAlignment.ts')
const { refineMixedLanguageAlignment } = await imp('src/ai-pipeline/mixedLanguageAlign.ts')
const { sanitizeTranscript } = await imp('src/ai-pipeline/aligner.ts')
const { computeLineMatchedSpans } = await imp('src/ai-pipeline/contentAligner.ts')
const { selectAnchorTargets } = await imp('src/lyrics/anchorRefit.ts')
const { parseLrc, matchSheetToLrc } = await imp('scripts/lib/lrcTruth.mjs')

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a,b)=>a-b); return s[Math.floor(s.length/2)] }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(p*s.length))] }

const SONGS = [
  { name: 'guitar-loneliness', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja',
    configs: [{ label: 'word', transcript: 'guitar-loneliness/transcript.word.json' }, { label: 'segment', transcript: 'guitar-loneliness/transcript.segment.json' }] },
  { name: 'stranger-than-heaven', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed',
    configs: [
      { label: 'segment mixed 2-pass', transcript: 'stranger-than-heaven/transcript.segment.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
      { label: 'word mixed 2-pass', transcript: 'stranger-than-heaven/transcript.word.json', transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json' },
    ] },
  { name: 'recollect', lyrics: 'recollect/lyrics.txt', truth: 'lrc-truth/recollect.json', lang: 'mixed',
    configs: [
      { label: 'segment mixed 2-pass', transcript: 'recollect/transcript.segment.json', transcriptEn: 'recollect/transcript.segment.forced-en.json' },
      { label: 'word mixed 2-pass', transcript: 'recollect/transcript.word.json', transcriptEn: 'recollect/transcript.segment.forced-en.json' },
    ] },
  { name: 'veil', lyrics: 'veil/lyrics.ja.txt', truth: 'lrc-truth/veil.json', lang: 'ja',
    configs: [{ label: 'word', transcript: 'veil/transcript.words.json' }] },
]

const allTargetErrs = []
const allSigned = []
const HALVES = [1.5, 2.5, 4, 6]

for (const song of SONGS) {
  const lineTexts = readLines(join(FIXTURES, song.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, song.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  console.log(`\n=== ${song.name}`)
  for (const cfg of song.configs) {
    const p = join(FIXTURES, cfg.transcript)
    if (!existsSync(p)) { console.log(`  ${cfg.label}: missing`); continue }
    const words = loadWords(p)
    let refined, scoredWords = words
    if (cfg.transcriptEn) {
      const m = refineMixedLanguageAlignment(sheetRows, words, loadWords(join(FIXTURES, cfg.transcriptEn)))
      refined = m.refined; scoredWords = m.transcriptWords
    } else {
      refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)
    }
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
    // Same version-offset removal audit-vs-lrc.mjs uses.
    const diffs = []
    for (let i = 0; i < refined.lines.length; i++) {
      if (truthTime[i] == null) continue
      if (spans[i]?.firstTime != null && spans[i].matchedChars / Math.max(1, spans[i].totalChars) >= 0.5) diffs.push(spans[i].firstTime - truthTime[i])
    }
    const offset = median(diffs) ?? 0

    const quality = refined.lineAlignmentQuality
    // Exactly what PlayerView offers: the strip's targets, no prior anchors.
    const targets = selectAnchorTargets(refined.lines, quality, { alreadyAnchored: [] })
    const rows = []
    for (const i of targets) {
      if (truthTime[i] == null) continue
      const t = truthTime[i] + offset
      rows.push({ i, q: quality[i], err: refined.lines[i].startTime - t })
    }
    const abs = rows.map((r) => Math.abs(r.err))
    allTargetErrs.push(...abs); allSigned.push(...rows.map(r=>r.err))
    console.log(`  ${cfg.label.padEnd(22)} targets=[${targets.join(',')}] withTruth=${rows.length}`)
    for (const r of rows) console.log(`      line ${String(r.i).padStart(3)} ${r.q.padEnd(13)} err ${r.err >= 0 ? '+' : ''}${r.err.toFixed(2)}s`)
    if (abs.length) console.log(`      |err| p50=${median(abs).toFixed(2)} max=${Math.max(...abs).toFixed(2)}  reach: ${HALVES.map(h => `${h}s->${abs.filter(e=>e<=h).length}/${abs.length}`).join(' ')}`)
  }
}

console.log(`\n=== ALL offered lines (n=${allTargetErrs.length})`)
console.log(`|err| p50=${median(allTargetErrs)?.toFixed(2)} p90=${pct(allTargetErrs,0.9)?.toFixed(2)} max=${Math.max(...allTargetErrs).toFixed(2)}`)
console.log(`signed: ${allSigned.filter(e=>e<0).length} early (need to drag LATER), ${allSigned.filter(e=>e>0).length} late`)
console.log(`need-later magnitudes: ${allSigned.filter(e=>e<0).map(e=>(-e).toFixed(1)).sort((a,b)=>a-b).join(' ')}`)
for (const h of HALVES) {
  const ok = allTargetErrs.filter((e) => e <= h).length
  console.log(`  symmetric +/-${h}s  span=${(2*h).toFixed(1)}s  ${String(Math.round(2*h*1000/194)).padStart(3)}ms/px  reaches ${ok}/${allTargetErrs.length} (${(100*ok/allTargetErrs.length).toFixed(0)}%)`)
}
console.log('\n=== asymmetric candidates (back/forward), 194px slider on a 375px phone')
const CAND = [[1.5,3],[2,4],[2,6],[2.5,5],[2.5,6],[3,6],[2.5,8],[3,9],[6,6]]
for (const [back, fwd] of CAND) {
  // signed err = ourStart - truth. err<0 => must drag LATER by |err| (uses fwd budget).
  const ok = allSigned.filter((e) => (e < 0 ? -e <= fwd : e <= back)).length
  const span = back + fwd
  console.log(`  back ${back}s / fwd ${fwd}s  span=${span.toFixed(1)}s  ${String(Math.round(span*1000/194)).padStart(3)}ms/px  reaches ${ok}/${allSigned.length} (${(100*ok/allSigned.length).toFixed(0)}%)`)
}
