/**
 * DOES THE LINE START WHERE THE SINGING STARTS? — asked with a model, on isolated vocals.
 *
 * This is the instrument L28 said was needed. The cheap acoustic arbiters are all dead ends: the
 * envelope offset screen peaks ~1s from the truth on real singing (L17), and the flux-peak metric
 * is saturated because sung Japanese produces a peak every 0.17-0.19s, so a RANDOM timestamp scores
 * as well as a correct one (L28). What does have the resolution is a model-based forced alignment:
 * Whisper's word-level timestamps computed on the ISOLATED VOCAL STEM, where the only thing to
 * align against is the singing itself.
 *
 * So each lyric line's opening is matched, in order, into the stem's word sequence, and the start
 * of that matched word becomes an independent measurement of where the line is actually sung. The
 * app's starts and the LRC's starts are then scored against it through identical code.
 *
 *     ours -> stem truth    vs    LRC -> stem truth
 *
 * WHY THE COMPARISON IS SOUND DESPITE WHISPER'S OWN ERROR. Word timestamps carry error of order
 * 100-300ms, which is the same size as the effect being judged. But that error is applied to BOTH
 * columns by the same model on the same audio, so the SIGNED differences and their comparison
 * survive even though neither absolute column should be read as ground truth to 100ms. This is why
 * the script reports the difference and a bootstrap interval on it, and why it scores both columns
 * on the SAME lines only.
 *
 * Run: npx tsx scripts/align-stem-forced-truth.mjs
 * Needs: .cache/stem-words-<song>.json from scripts/transcribe-stem.mjs, plus the uncommitted audio.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const OUT = join(root, '.cache/align-stem-forced-truth.json')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const fmt = (x, w = 7) => (x == null ? '    n/a' : x.toFixed(3).padStart(w))
const share = (xs, b) => (xs.length === 0 ? null : xs.filter((d) => Math.abs(d) <= b).length / xs.length)

/** Normalise for matching: NFKC, no spaces, no punctuation. Long-vowel marks are CONTENT. */
const norm = (s) => (s ?? '')
  .normalize('NFKC')
  .replace(/[\s\u3000]/g, '')
  .replace(/[、。，．,.!?！？「」『』（）()[\]…・:;'"“”‘’]/g, '')

const CONFIGS = [
  {
    name: 'veil',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    lang: 'ja',
    transcript: 'veil/transcript.words.json',
    stemWords: '.cache/stem-words-veil.json',
    note: 'LRC agrees with the audio timeline (-0.02s systematic), so any disagreement is attributable',
  },
  {
    // The arbiter's POWER depends on how much of the sheet the model resolves: whisper-small anchors
    // about half of veil. A better recogniser hears more of the words, which means more judgeable
    // lines and a tighter interval on the comparison. Same audio, same code, stronger arbiter.
    name: 'veil (medium arbiter)',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    lang: 'ja',
    transcript: 'veil/transcript.words.json',
    stemWords: '.cache/stem-words-veil-medium.json',
    note: 'same song and same reference as veil above, arbiter transcribed with whisper-medium',
  },
  {
    name: 'stranger',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    lang: 'mixed',
    transcript: 'stranger-than-heaven/transcript.segment.json',
    en: 'stranger-than-heaven/transcript.segment.forced-en.json',
    stemWords: '.cache/stem-words-stranger.json',
    note: 'LRC is a DIFFERENT TAKE (237s vs 233.6s) — its column is one-sided by construction',
  },
  {
    name: 'guitar',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    lang: 'ja',
    transcript: 'guitar-loneliness/transcript.segment.json',
    stemWords: '.cache/stem-words-guitar.json',
    note: 'LRC is VERSION-EXACT and we are +0.31s late against it — the case that most needs arbitration',
  },
]

/**
 * GLOBAL FORCED ALIGNMENT of the lyric sheet against the stem's word stream.
 *
 * The first version of this script matched each line's opening with a local substring search up to
 * 30 words ahead. That produced p50 13.5s and p90 53s, which is not measurement error but a matching
 * pathology: when a line's text is not what the model heard, the search grabs any short word that
 * happens to occur in the line, a minute away, and the forward pointer drags every later line with
 * it. A local greedy match cannot be trusted to anchor a global question.
 *
 * So the sheet and the word stream are aligned GLOBALLY, character to character, minimising
 * mismatches plus gaps (standard edit-distance alignment). Two properties follow that the greedy
 * version could not have: the alignment is monotone by construction, and a line's anchor is chosen
 * in the context of every other line rather than in isolation.
 */
const GAP_COST = 1
const SUB_COST = 1
/** The anchor must land on one of the line's opening characters, or the line is not judgeable.
 * Overridable with `--anchor-head=N` so the conclusion can be shown not to depend on it. */
const ANCHOR_HEAD_CHARS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--anchor-head='))
  const n = arg ? Number(arg.split('=')[1]) : 3
  return Number.isFinite(n) && n > 0 ? n : 3
})()
/**
 * WHEN THE ARBITER MAY NOT SPEAK. Two conditions, both about the alignment rather than about the
 * answer:
 *   - coverage: fewer than a third of the sheet's characters matched the sung stream means the model
 *     and the sheet are not describing the same words, so any anchor is a coincidence;
 *   - impossible anchors: for a line of >=5 characters, consecutive anchors closer than 0.5s assert
 *     that a line was sung faster than a human can sing it. Zero tolerance — one such anchor proves
 *     the alignment put a line in the wrong place.
 * The coverage floor is a judgement call, stated as one: it sits below what veil achieves (47%) and
 * above what stranger achieves (25%), and it exists so that a quarter-resolved sheet cannot be
 * quoted as a measurement, not because a third is a magic number.
 */
const MIN_COVERAGE = 1 / 3

/** Character-level global alignment; returns the matched [sheetIdx, wordIdx] pairs in order. */
function alignChars(sheetChars, wordChars) {
  const n = sheetChars.length
  const m = wordChars.length
  const at = (i, j) => i * (m + 1) + j
  const dp = new Int32Array((n + 1) * (m + 1))
  for (let i = 0; i <= n; i++) dp[at(i, 0)] = i * GAP_COST
  for (let j = 0; j <= m; j++) dp[at(0, j)] = j * GAP_COST
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = sheetChars[i - 1].ch === wordChars[j - 1].ch ? 0 : SUB_COST
      const diag = dp[at(i - 1, j - 1)] + sub
      const up = dp[at(i - 1, j)] + GAP_COST
      const left = dp[at(i, j - 1)] + GAP_COST
      dp[at(i, j)] = diag < up ? (diag < left ? diag : left) : (up < left ? up : left)
    }
  }
  const matched = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const sub = sheetChars[i - 1].ch === wordChars[j - 1].ch ? 0 : SUB_COST
    if (dp[at(i, j)] === dp[at(i - 1, j - 1)] + sub) {
      if (sub === 0) matched.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[at(i, j)] === dp[at(i - 1, j)] + GAP_COST) i--
    else j--
  }
  matched.reverse()
  return matched
}

function loadWordsFixture(p) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}

/** Deterministic bootstrap (LCG) on the median paired difference, so a "winner" needs an interval. */
function bootstrapMedianDiff(pairs, iterations = 4000, seed = 987654321) {
  if (pairs.length < 3) return null
  let x = seed
  const rand = () => (x = (1103515245 * x + 12345) % 2147483648) / 2147483648
  const meds = []
  for (let it = 0; it < iterations; it++) {
    const sample = []
    for (let i = 0; i < pairs.length; i++) sample.push(pairs[Math.floor(rand() * pairs.length)])
    meds.push(median(sample))
  }
  meds.sort((a, b) => a - b)
  return { lo: meds[Math.floor(0.025 * meds.length)], hi: meds[Math.floor(0.975 * meds.length)] }
}

const results = []

for (const c of CONFIGS) {
  const stemPath = join(root, c.stemWords)
  if (!existsSync(stemPath)) {
    console.log(`\n=== ${c.name}: no stem transcript yet (${c.stemWords}) — run scripts/transcribe-stem.mjs first ===`)
    continue
  }
  const stem = JSON.parse(readFileSync(stemPath, 'utf8'))
  const lineTexts = readLines(join(FIXTURES, c.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, c.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const ja = loadWordsFixture(join(FIXTURES, c.transcript))
  const refined = c.en && existsSync(join(FIXTURES, c.en))
    ? refineMixedLanguageAlignment(rows, ja, loadWordsFixture(join(FIXTURES, c.en))).refined
    : refineAlignmentWithPhrases(rows, ja, c.lang)
  const ours = refined.lines.map((l) => l.startTime)

  // Forced-align the sheet against the stem's word stream, then read each line's anchor off it.
  const sheetChars = []
  const lineFirstChar = lineTexts.map(() => -1)
  for (let i = 0; i < lineTexts.length; i++) {
    const t = norm(lineTexts[i])
    if (t.length > 0) lineFirstChar[i] = sheetChars.length
    for (const ch of t) sheetChars.push({ ch, line: i })
  }
  const wordChars = []
  for (let wi = 0; wi < stem.words.length; wi++) {
    for (const ch of norm(stem.words[wi].word)) wordChars.push({ ch, wi })
  }
  const matchedPairs = alignChars(sheetChars, wordChars)
  // The first matched character of each line, and how deep into the line it sits.
  const anchor = new Map()
  for (const [si, wj] of matchedPairs) {
    const line = sheetChars[si].line
    if (anchor.has(line)) continue
    anchor.set(line, { stemStart: stem.words[wordChars[wj].wi].start, word: stem.words[wordChars[wj].wi].word, offsetInLine: si - lineFirstChar[line] })
  }
  const matches = lineTexts.map((_, i) => {
    const a = anchor.get(i)
    // An anchor that lands in the middle of a line is not evidence about where the line STARTS.
    if (!a || a.offsetInLine >= ANCHOR_HEAD_CHARS) return null
    return { lineIndex: i, stemStart: a.stemStart, word: a.word, offsetInLine: a.offsetInLine }
  })
  const sheetMatched = matchedPairs.length
  const sheetCharsTotal = sheetChars.length
  /**
   * THE ARBITER'S OWN QUALITY CHECK. An anchor is only evidence if it is a plausible line start:
   * a line of >=5 characters cannot be sung in under half a second, so consecutive anchors closer
   * than that mean the alignment put one of them in the wrong place. Reported rather than silently
   * trusted, because the whole point of this instrument is that the cheap ones looked fine and
   * were not.
   */
  const anchoredTimes = matches.filter(Boolean).map((m) => ({ i: m.lineIndex, t: m.stemStart, chars: norm(lineTexts[m.lineIndex]).length }))
  const intervals = []
  for (let k = 1; k < anchoredTimes.length; k++) {
    intervals.push({ gap: anchoredTimes[k].t - anchoredTimes[k - 1].t, from: anchoredTimes[k - 1], to: anchoredTimes[k] })
  }
  const impossible = intervals.filter((v) => v.gap < 0.5 && v.to.chars >= 5)
  const anchorOffsets = matches.filter(Boolean).map((m) => m.offsetInLine)

  const paired = []
  for (const m of matches) {
    if (!m) continue
    const t = truthTime[m.lineIndex]
    if (t == null) continue // no LRC reference for this line, so it cannot arbitrate the comparison
    paired.push({
      lineIndex: m.lineIndex,
      stemTruth: m.stemStart,
      ours: ours[m.lineIndex],
      lrc: t,
      word: m.word,
      dOurs: ours[m.lineIndex] - m.stemStart,
      dLrc: t - m.stemStart,
    })
  }

  const judged = matches.filter(Boolean).length
  const sOurs = { signed: median(paired.map((p) => p.dOurs)), p50: pct(paired.map((p) => Math.abs(p.dOurs)), 0.5), p90: pct(paired.map((p) => Math.abs(p.dOurs)), 0.9), w100: share(paired.map((p) => p.dOurs), 0.1), w250: share(paired.map((p) => p.dOurs), 0.25), w500: share(paired.map((p) => p.dOurs), 0.5) }
  const sLrc = { signed: median(paired.map((p) => p.dLrc)), p50: pct(paired.map((p) => Math.abs(p.dLrc)), 0.5), p90: pct(paired.map((p) => Math.abs(p.dLrc)), 0.9), w100: share(paired.map((p) => p.dLrc), 0.1), w250: share(paired.map((p) => p.dLrc), 0.25), w500: share(paired.map((p) => p.dLrc), 0.5) }
  // Same lines, same arbiter: the difference is what attribution needs.
  const diffs = paired.map((p) => Math.abs(p.dOurs) - Math.abs(p.dLrc))
  const ci = bootstrapMedianDiff(diffs)
  // The SYSTEMATIC comparison: how late is each column relative to the singing. A CI that excludes
  // zero here says one of them is reliably further from the vocal, even though per-line scatter can
  // still be as wide as the other's.
  const signedDiffs = paired.map((p) => p.dOurs - p.dLrc)
  const ciSigned = bootstrapMedianDiff(signedDiffs)
  // Each column's OWN systematic lag, with an interval: without this, "+0.30s late" and "noise"
  // look the same. This is the number that decides whether a lag is attributable or not.
  const ciAppLag = bootstrapMedianDiff(paired.map((p) => p.dOurs))
  const ciLrcLag = bootstrapMedianDiff(paired.map((p) => p.dLrc))

  console.log(`\n=== ${c.name} — stem transcribed by ${stem.modelId}, ${stem.words.length} words ===`)
  console.log(`    ${c.note}`)
  console.log(`    forced alignment: ${sheetMatched} of ${sheetCharsTotal} sheet characters matched a sung character (${((sheetMatched / Math.max(1, sheetCharsTotal)) * 100).toFixed(0)}%)`)
  console.log(`    anchored ${judged} of ${lineTexts.length} lines at their own opening; ${paired.length} of those also have LRC truth to compare against`)
  console.log(`    anchor quality: offsets into the line p50=${pct(anchorOffsets, 0.5)} max=${Math.max(0, ...anchorOffsets)}; implied sung intervals p10=${fmt(pct(intervals.map((v) => v.gap), 0.1), 4)}s p50=${fmt(pct(intervals.map((v) => v.gap), 0.5), 4)}s p90=${fmt(pct(intervals.map((v) => v.gap), 0.9), 4)}s; IMPOSSIBLE (gap<0.5s for a >=5-char line): ${impossible.length}${impossible.length ? ' -> ' + impossible.slice(0, 3).map((v) => `line${v.from.i}->${v.to.i} ${v.gap.toFixed(2)}s`).join(', ') : ''}`)
  console.log('                        signedMed     p50     p90    <=100ms  <=250ms  <=500ms')
  const row = (label, s) => console.log(`    ${label.padEnd(20)}${fmt(s.signed)}${fmt(s.p50)}${fmt(s.p90)}   ${s.w100 == null ? 'n/a' : (s.w100 * 100).toFixed(0).padStart(4) + '%'}   ${s.w250 == null ? 'n/a' : (s.w250 * 100).toFixed(0).padStart(4) + '%'}   ${s.w500 == null ? 'n/a' : (s.w500 * 100).toFixed(0).padStart(4) + '%'}`)
  row('app -> stem truth', sOurs)
  row('LRC -> stem truth', sLrc)
  const winner = sOurs.p50 == null || sLrc.p50 == null ? 'n/a'
    : sOurs.p50 < sLrc.p50 ? 'the APP' : 'the LRC'
  console.log(`    median |app - stem| - |LRC - stem| = ${fmt(median(diffs), 6)}s  95% CI [${ci ? ci.lo.toFixed(3) : 'n/a'}, ${ci ? ci.hi.toFixed(3) : 'n/a'}]  (negative favours the app, and a CI spanning 0 means indistinguishable)`)
  console.log(`    median (app lag - LRC lag) vs the singing = ${fmt(median(signedDiffs), 6)}s  95% CI [${ciSigned ? ciSigned.lo.toFixed(3) : 'n/a'}, ${ciSigned ? ciSigned.hi.toFixed(3) : 'n/a'}]  (negative means the app is LESS late than the LRC)`)
  const lagSig = (ci) => (ci && (ci.lo > 0 || ci.hi < 0) ? 'SIGNIFICANT' : 'includes 0 (not significant)')
  console.log(`    app's own lag:  ${fmt(sOurs.signed, 6)}s  CI [${ciAppLag ? ciAppLag.lo.toFixed(3) : 'n/a'}, ${ciAppLag ? ciAppLag.hi.toFixed(3) : 'n/a'}] ${lagSig(ciAppLag)}`)
  console.log(`    LRC's own lag:  ${fmt(sLrc.signed, 6)}s  CI [${ciLrcLag ? ciLrcLag.lo.toFixed(3) : 'n/a'}, ${ciLrcLag ? ciLrcLag.hi.toFixed(3) : 'n/a'}] ${lagSig(ciLrcLag)}`)
  const coverage = sheetMatched / Math.max(1, sheetCharsTotal)
  const arbiterOk = coverage >= MIN_COVERAGE && impossible.length === 0
  if (!arbiterOk) {
    console.log(`    VERDICT: NO VERDICT — the arbiter failed its own quality check (coverage ${(coverage * 100).toFixed(0)}% vs floor ${(MIN_COVERAGE * 100).toFixed(0)}%, impossible anchors ${impossible.length}). Every number above is an artifact of a broken alignment and must not be quoted.`)
  } else {
    console.log(`    VERDICT: closer to the singing is ${winner}${ci && ci.lo < 0 && ci.hi < 0 ? ' (the app is significantly closer)' : ci && ci.lo > 0 && ci.hi > 0 ? ' (the LRC is significantly closer)' : ' (NOT a significant difference)'}`)
  }
  console.log(`    first 5 matched lines: ${paired.slice(0, 5).map((p) => `"${p.word}"@${p.stemTruth.toFixed(2)} app${p.dOurs >= 0 ? '+' : ''}${p.dOurs.toFixed(2)} lrc${p.dLrc >= 0 ? '+' : ''}${p.dLrc.toFixed(2)}`).join(' | ')}`)

  results.push({
    config: c.name, note: c.note, model: stem.modelId, stemWords: stem.words.length,
    lines: lineTexts.length, judged, paired: paired.length, sheetMatched, sheetCharsTotal,
    app: sOurs, lrc: sLrc, medianDiffAbs: median(diffs), ci, ciSigned, medianSignedDiff: median(signedDiffs), ciAppLag, ciLrcLag,
    anchorOffsets, impliedIntervals: intervals.map((v) => +v.gap.toFixed(3)), impossibleAnchors: impossible.length,
    coverage: +coverage.toFixed(3), arbiterOk,
    perLine: paired.map((p) => ({ i: p.lineIndex, word: p.word, stemTruth: +p.stemTruth.toFixed(3), app: +p.dOurs.toFixed(3), lrc: +p.dLrc.toFixed(3) })),
  })
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ results }, null, 1))
console.log(`\nwrote ${OUT}`)
