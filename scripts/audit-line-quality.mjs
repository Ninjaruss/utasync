/**
 * Per-line label-honesty audit: does the per-line alignment quality label
 * (good / approximate / needs_review) tell the truth about the line's timing?
 *
 * For every corpus config (tests/ai-pipeline/fixtures/corpus.json) this runs
 * the real alignment pipeline, then cross-tabulates each line's quality label
 * against independent timing evidence:
 *
 *  - ground truth start error, where truth exists:
 *      guitar-loneliness + stranger-than-heaven → human-synced LRC
 *      (lrc-truth/*.json, robust median version-offset removed),
 *      akfg → official YouTube caption onsets (embedded below);
 *  - the line's own matched-transcript span (computeLineMatchedSpans):
 *      late start   = highlight begins ≥ LATE_START_S after its evidence,
 *      clipped tail = highlight ends ≥ CLIP_TAIL_S before its evidence ends,
 *      span miss    = strong evidence exists but the highlight window never
 *                     touches it (wrong placement or repeat-stanza retarget).
 *
 * A FALSE NEGATIVE is a line labeled 'good' that any of the evidence says is
 * mistimed — the label the user is complaining about when a line "says it's
 * aligned" but isn't. A FALSE POSITIVE is a needs_review line whose start sits
 * within tolerance of truth (over-flagging dilutes trust in the label).
 *
 * Run:
 *   npx tsx scripts/audit-line-quality.mjs                 # summary table
 *   npx tsx scripts/audit-line-quality.mjs --dump <dir>    # also write per-line JSON per config
 *   npx tsx scripts/audit-line-quality.mjs --details       # print every defective line
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const DUMP_DIR = (() => {
  const i = process.argv.indexOf('--dump')
  return i >= 0 ? process.argv[i + 1] : null
})()
const DETAILS = process.argv.includes('--details')

// Thresholds. Truth thresholds are generous (LRC versions and caption rows are
// coarse); span thresholds match boundaryMetrics' EARLY_END_THRESHOLD_S.
const TRUTH_MISPLACED_S = 1.5
const LATE_START_S = 0.35
const CLIP_TAIL_S = 0.35
const MIN_SPAN_COVERAGE = 0.55

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { sanitizeTranscript } = await import(pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href)
const { computeLineMatchedSpans, isInterjectionLyricLine } = await import(pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

// Official YouTube caption onsets for the AKFG first-take corpus lyrics
// (tests/ai-pipeline/akfg-ground-truth.test.ts is the canonical copy).
// `shared` lines are the second half of a caption: the onset is a lower bound,
// not an exact start, so they are excluded from misplacement scoring.
const AKFG_TRUTH = [
  { idx: 0, onset: 98 }, { idx: 1, onset: 104 }, { idx: 2, onset: 111 },
  { idx: 3, onset: 118 }, { idx: 4, onset: 122 }, { idx: 5, onset: 131 },
  { idx: 6, onset: 131, shared: true }, { idx: 7, onset: 141 },
  { idx: 8, onset: 141, shared: true }, { idx: 9, onset: 148 },
  { idx: 10, onset: 154 }, { idx: 11, onset: 154, shared: true },
  { idx: 12, onset: 161 }, { idx: 13, onset: 177 }, { idx: 14, onset: 183 },
  { idx: 15, onset: 190 }, { idx: 16, onset: 203 }, { idx: 17, onset: 210 },
  { idx: 18, onset: 217 }, { idx: 19, onset: 217, shared: true },
  { idx: 20, onset: 223, tol: 3 }, { idx: 21, onset: 262 }, { idx: 22, onset: 275 },
  { idx: 23, onset: 282 }, { idx: 24, onset: 292 }, { idx: 25, onset: 292, shared: true },
  { idx: 26, onset: 299 }, { idx: 27, onset: 306 }, { idx: 28, onset: 306, shared: true },
  { idx: 29, onset: 312, tol: 3 },
]

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Truth start times (seconds, or null) per sheet line, plus per-line tolerance. */
function loadTruth(songName, lineTexts) {
  if (songName.startsWith('guitar-loneliness') || songName.startsWith('stranger-than-heaven')) {
    const file = songName.startsWith('guitar-loneliness')
      ? 'lrc-truth/guitar-loneliness.json'
      : 'lrc-truth/stranger-than-heaven.json'
    const lrc = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
    const t = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
    return { time: t, tol: t.map(() => TRUTH_MISPLACED_S), source: 'lrc' }
  }
  if (songName.startsWith('akfg')) {
    const time = lineTexts.map(() => null)
    const tol = lineTexts.map(() => TRUTH_MISPLACED_S)
    for (const g of AKFG_TRUTH) {
      if (g.shared) continue // onset is a lower bound only
      time[g.idx] = g.onset
      tol[g.idx] = Math.max(TRUTH_MISPLACED_S, g.tol ?? 2)
    }
    return { time, tol, source: 'captions' }
  }
  return { time: lineTexts.map(() => null), tol: lineTexts.map(() => TRUTH_MISPLACED_S), source: null }
}

function auditSong(song, lineTexts, refined, scoredWords) {
  const sanitized = sanitizeTranscript(scoredWords)
  const spans = computeLineMatchedSpans(lineTexts, sanitized)
  const truth = loadTruth(song.name, lineTexts)

  // Version offset (LRC only): median of (evidence − truth) over well-matched
  // lines, same recipe as audit-vs-lrc.mjs. Caption truth is already absolute.
  let offset = 0
  if (truth.source === 'lrc') {
    const diffs = []
    for (let i = 0; i < refined.lines.length; i++) {
      if (truth.time[i] == null) continue
      const s = spans[i]
      if (s?.firstTime != null && s.matchedChars / Math.max(1, s.totalChars) >= 0.5) {
        diffs.push(s.firstTime - truth.time[i])
      }
    }
    offset = median(diffs) ?? 0
  }

  const quality = refined.lineAlignmentQuality ?? []
  const rows = []
  for (let i = 0; i < refined.lines.length; i++) {
    const line = refined.lines[i]
    const span = spans[i]
    const label = quality[i] ?? 'unknown'
    const spanCov = span ? span.matchedChars / Math.max(1, span.totalChars) : 0
    const strongSpan = span != null && spanCov >= MIN_SPAN_COVERAGE
    const overlaps = strongSpan && span.firstTime < line.endTime && span.lastEndTime > line.startTime

    const truthTime = truth.time[i] == null ? null : truth.time[i] + offset
    const truthErr = truthTime == null ? null : line.startTime - truthTime

    const defects = []
    if (truthErr != null && Math.abs(truthErr) > truth.tol[i]) defects.push('misplaced')
    // span_miss counts as a defect only when no truth exists: with truth in
    // hand, a strong span elsewhere while the start sits at truth is the LCS
    // retargeting a repeated line's evidence (measured on mixed-* #44-47), not
    // a placement error.
    if (strongSpan && !overlaps && truthTime == null) defects.push('span_miss')
    if (overlaps && line.startTime - span.firstTime > LATE_START_S) defects.push('late_start')
    // Clipped tail: attributed evidence keeps sounding past the end — unless
    // the overhang reaches into the NEXT line's own evidence (shared/ambiguous
    // attribution, e.g. overlapping call-response vocals), which end-truth
    // showed is noise, not a clip (akfg #4).
    if (overlaps && span.lastEndTime - line.endTime > CLIP_TAIL_S) {
      const next = spans[i + 1]
      if (!next || span.lastEndTime <= next.firstTime + 0.3) defects.push('clip_tail')
    }

    rows.push({
      idx: i,
      text: lineTexts[i],
      interjection: isInterjectionLyricLine(lineTexts[i]),
      label,
      startTime: +line.startTime.toFixed(2),
      endTime: +line.endTime.toFixed(2),
      span: span
        ? { firstTime: +span.firstTime.toFixed(2), lastEndTime: +span.lastEndTime.toFixed(2), coverage: +spanCov.toFixed(2) }
        : null,
      truthTime: truthTime == null ? null : +truthTime.toFixed(2),
      truthErr: truthErr == null ? null : +truthErr.toFixed(2),
      defects,
    })
  }

  const isFalseNegative = (r) => r.label === 'good' && r.defects.length > 0
  const isApproxMisplaced = (r) => r.label === 'approximate' && (r.defects.includes('misplaced') || r.defects.includes('span_miss'))
  const isFalsePositive = (r) =>
    r.label === 'needs_review' && r.truthErr != null && Math.abs(r.truthErr) <= 1.0

  const summary = {
    lines: rows.length,
    withTruth: rows.filter((r) => r.truthTime != null).length,
    truthSource: truth.source,
    offset: +offset.toFixed(2),
    good: rows.filter((r) => r.label === 'good').length,
    approximate: rows.filter((r) => r.label === 'approximate').length,
    needs_review: rows.filter((r) => r.label === 'needs_review').length,
    good_misplaced: rows.filter((r) => r.label === 'good' && r.defects.includes('misplaced')).length,
    good_span_miss: rows.filter((r) => r.label === 'good' && r.defects.includes('span_miss')).length,
    good_late_start: rows.filter((r) => r.label === 'good' && r.defects.includes('late_start')).length,
    good_clip_tail: rows.filter((r) => r.label === 'good' && r.defects.includes('clip_tail')).length,
    false_negatives: rows.filter(isFalseNegative).length,
    approx_misplaced: rows.filter(isApproxMisplaced).length,
    false_positives: rows.filter(isFalsePositive).length,
  }
  return { rows, summary }
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  if (DUMP_DIR) mkdirSync(DUMP_DIR, { recursive: true })

  const table = []
  for (const song of manifest.songs) {
    const lineTexts = readLines(join(FIXTURES, song.lyrics))
    let words = loadWords(join(FIXTURES, song.transcript))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    let refined
    if (song.transcriptEn) {
      const enWords = loadWords(join(FIXTURES, song.transcriptEn))
      const mixed = refineMixedLanguageAlignment(sheetRows, words, enWords)
      refined = mixed.refined
      words = mixed.transcriptWords
    } else {
      refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)
    }

    const { rows, summary } = auditSong(song, lineTexts, refined, words)
    table.push({ name: song.name, ...summary })

    if (DUMP_DIR) {
      writeFileSync(join(DUMP_DIR, `${song.name}.json`), JSON.stringify({ song: song.name, summary, rows }, null, 2))
    }
    if (DETAILS) {
      for (const r of rows) {
        if (!r.defects.length) continue
        const spanStr = r.span ? `span=[${r.span.firstTime},${r.span.lastEndTime}] cov=${r.span.coverage}` : 'span=none'
        console.log(
          `${song.name} #${String(r.idx).padStart(2)} [${r.label.padEnd(12)}] ${r.defects.join('+').padEnd(22)} ` +
          `line=[${r.startTime},${r.endTime}] ${spanStr} ` +
          `truth=${r.truthTime ?? 'n/a'} err=${r.truthErr ?? 'n/a'} ${r.text.slice(0, 24)}`,
        )
      }
    }
  }

  const cols = [
    'name', 'lines', 'withTruth', 'good', 'approximate', 'needs_review',
    'good_misplaced', 'good_span_miss', 'good_late_start', 'good_clip_tail',
    'false_negatives', 'approx_misplaced', 'false_positives',
  ]
  const widths = cols.map((c) => Math.max(c.length, ...table.map((r) => String(r[c] ?? '').length)))
  console.log('\n=== Per-line label honesty (false_negatives = lines labeled good that are mistimed) ===\n')
  console.log(cols.map((c, i) => c.padStart(widths[i])).join('  '))
  console.log(widths.map((w) => '-'.repeat(w)).join('--'))
  for (const r of table) {
    console.log(cols.map((c, i) => String(r[c] ?? '').padStart(widths[i])).join('  '))
  }
  const totals = table.reduce(
    (a, r) => ({ fn: a.fn + r.false_negatives, am: a.am + r.approx_misplaced, fp: a.fp + r.false_positives }),
    { fn: 0, am: 0, fp: 0 },
  )
  console.log(`\nTotals: false_negatives=${totals.fn} approx_misplaced=${totals.am} false_positives=${totals.fp}`)
}

await main()
