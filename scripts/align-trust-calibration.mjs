/**
 * Calibrate the truth-free trust verdict against human-synced LRC truth (plan W2.1).
 *
 * THE QUESTION THIS ANSWERS, and it is the precondition for the whole product intent:
 * "the aligner does its best and is then AUTO-CORRECTED until the sync is accurate"
 * requires an acceptance test that works at runtime, where there is no answer key. The
 * app's per-line labels are not that test — they are demotions tuned for zero collateral
 * and catch 22 of 41 known >1.5s errors. So `src/ai-pipeline/alignmentTrust.ts` produces
 * a three-tier verdict from evidence-only signals, and the only thing that makes such a
 * verdict meaningful is whether it is CALIBRATED:
 *
 *     do lines it calls `verified` really have lower true error than lines it calls
 *     `weak`, and those lower than `unverified`?
 *
 * This script measures exactly that, per tier, per config, against LRC truth. If the
 * tiers do not separate, an automatic correction loop cannot know when to stop, and the
 * honest answer is to say so rather than to ship a confident-looking score.
 *
 * It also reports the operational properties a loop needs:
 *   - `converged` accuracy: when the verdict says "good enough", is it? (false-confidence)
 *     and when it says "keep correcting", was there anything left to fix? (wasted work)
 *   - the recall of `repairableLineIndices` for lines actually worse than a threshold.
 *
 * Run: npx tsx scripts/align-trust-calibration.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { sanitizeTranscript } = await import(pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href)
const { computeLineMatchedSpans } = await import(pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href)
const { assessAlignmentTrust } = await import(pathToFileURL(join(root, 'src/ai-pipeline/alignmentTrust.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)
const { computeVocalActivity } = await import(pathToFileURL(join(root, 'src/ai-pipeline/vocalActivity.ts')).href)
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)

/**
 * Real audio, for the acoustic signal. NOT committed: `.gitignore` excludes `public/e2e/`
 * because these are copyrighted recordings, and it stays that way. Only the resulting
 * NUMBERS are recorded, in the ledger and the plan. The envelope is computed from the mix,
 * which is the weaker source (`source: 'mix'`), matching what the app has when it has no
 * stem — so this understates what a stem would give.
 */
const AUDIO = { 'guitar word': 'guitar.mp3', 'guitar segment': 'guitar.mp3', 'veil word': 'veil.mp3', 'stranger word 2p': 'stranger.mp3', 'stranger segment 2p': 'stranger.mp3', 'stranger seg-medium': 'stranger.mp3', 'recollect word 2p': 'recollect.mp3', 'recollect segment 2p': 'recollect.mp3' }
/**
 * Pre-separated vocal stems, when present. Also NOT committed (copyrighted), same rule as
 * the mix audio: numbers recorded, audio untouched. `src/ai-pipeline/vocalActivity.ts`
 * notes that only a STEM envelope is decisive — a mix envelope is the weaker prior — so
 * this is the fairer test of whether acoustic corroboration is as strict as the mix made
 * it look.
 */
const STEM_AUDIO = {
  'stranger word 2p': 'stranger.mp3.vocals44k.f32',
  'stranger segment 2p': 'stranger.mp3.vocals44k.f32',
  'stranger seg-medium': 'stranger.mp3.vocals44k.f32',
  'veil word': 'veil.mp3.vocals44k.f32',
}
const envelopeCache = new Map()
/** Read a raw f32le mono stem and compute the envelope with `source: 'stem'`. */
async function stemEnvelopeFor(file) {
  if (!file) return null
  const key = `stem:${file}`
  if (envelopeCache.has(key)) return envelopeCache.get(key)
  const path = join(root, 'public/e2e', file)
  if (!existsSync(path)) { envelopeCache.set(key, null); return null }
  const buf = readFileSync(path)
  const data = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const sig = computeVocalActivity(data, 44100, { source: 'stem' })
  envelopeCache.set(key, sig)
  return sig
}

async function envelopeFor(file) {
  if (envelopeCache.has(file)) return envelopeCache.get(file)
  const path = join(root, 'public/e2e', file)
  if (!existsSync(path)) { envelopeCache.set(file, null); return null }
  const { data, sampleRate } = await decodeMp3ToMono(path)
  const sig = computeVocalActivity(data, sampleRate, { source: 'mix' })
  envelopeCache.set(file, sig)
  return sig
}

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const f = (x, w = 5) => (x == null ? '  n/a' : x.toFixed(2).padStart(w))

const CONFIGS = [
  { name: 'guitar word', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja', t: 'guitar-loneliness/transcript.word.json' },
  { name: 'guitar segment', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja', t: 'guitar-loneliness/transcript.segment.json' },
  { name: 'veil word', lyrics: 'veil/lyrics.ja.txt', truth: 'lrc-truth/veil.json', lang: 'ja', t: 'veil/transcript.words.json' },
  { name: 'stranger word 2p', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed', t: 'stranger-than-heaven/transcript.word.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
  { name: 'stranger segment 2p', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed', t: 'stranger-than-heaven/transcript.segment.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
  { name: 'stranger seg-medium', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed', t: 'stranger-than-heaven/transcript.segment.medium.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
  { name: 'recollect word 2p', lyrics: 'recollect/lyrics.txt', truth: 'lrc-truth/recollect.json', lang: 'mixed', t: 'recollect/transcript.word.json', en: 'recollect/transcript.segment.forced-en.json' },
  { name: 'recollect segment 2p', lyrics: 'recollect/lyrics.txt', truth: 'lrc-truth/recollect.json', lang: 'mixed', t: 'recollect/transcript.segment.json', en: 'recollect/transcript.segment.forced-en.json' },
]

const GOOD_S = 0.5   // a line "accurate enough" at half a second
const BAD_S = 2.0    // a line a listener would call broken

const all = { verified: [], weak: [], unverified: [] }
const allText = { verified: [] }
const allAcoustic = { verified: [], weak: [], unverified: [] }
const allStem = { verified: [], weak: [], unverified: [] }
const stemConfigs = []
const perConfig = []
let convergedClaimed = [] // { converged, p90, worst, badLines }

for (const c of CONFIGS) {
  const lineTexts = readLines(join(FIXTURES, c.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, c.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const ja = loadWords(join(FIXTURES, c.t))
  let refined
  let scored = ja
  if (c.en && existsSync(join(FIXTURES, c.en))) {
    const m = refineMixedLanguageAlignment(rows, ja, loadWords(join(FIXTURES, c.en)))
    refined = m.refined
    scored = m.transcriptWords
  } else {
    refined = refineAlignmentWithPhrases(rows, ja, c.lang)
  }
  const sanitized = sanitizeTranscript(scored)
  const spans = computeLineMatchedSpans(lineTexts, sanitized)
  const sig = await envelopeFor(AUDIO[c.name])
  const sigStem = await stemEnvelopeFor(STEM_AUDIO[c.name])
  const textOnly = assessAlignmentTrust({ lines: refined.lines, spans, words: sanitized, quality: refined.lineAlignmentQuality })
  const trust = assessAlignmentTrust({
    lines: refined.lines, spans, words: sanitized, quality: refined.lineAlignmentQuality,
    sig: sig ?? undefined, durationSec: sig ? sig.activity.length * sig.hopSec : undefined,
  })

  // True absolute error per line, and the tier each line was assigned.
  const errs = []
  const byTier = { verified: [], weak: [], unverified: [] }
  for (let i = 0; i < refined.lines.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    const e = Math.abs(refined.lines[i].startTime - t)
    errs.push(e)
    const tier = trust.lines[i].trust
    byTier[tier].push(e)
    all[tier].push(e)
  }
  const badLines = errs.filter((e) => e > BAD_S).length
  const repairableSet = new Set(trust.repairableLineIndices)
  // Recall of the repairable list for lines that are actually bad.
  let badTotal = 0
  let badCaught = 0
  for (let i = 0; i < refined.lines.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    if (Math.abs(refined.lines[i].startTime - t) > BAD_S) {
      badTotal++
      if (repairableSet.has(i)) badCaught++
    }
  }
  // The comparison that matters: does acoustic corroboration tighten the top tier?
  const textVerified = []
  const acoVerified = []
  for (let i = 0; i < refined.lines.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    const e = Math.abs(refined.lines[i].startTime - t)
    if (textOnly.lines[i].trust === 'verified') textVerified.push(e)
    if (trust.lines[i].trust === 'verified') acoVerified.push(e)
  }
  allText.verified.push(...textVerified)
  if (sigStem) {
    const stemTrust = assessAlignmentTrust({
      lines: refined.lines, spans, words: sanitized, quality: refined.lineAlignmentQuality,
      sig: sigStem, durationSec: sigStem.activity.length * sigStem.hopSec,
    })
    const stemVerified = []
    for (const v of stemTrust.lines) {
      const t = truthTime[v.lineIndex]
      if (t == null) continue
      allStem[v.trust].push(Math.abs(refined.lines[v.lineIndex].startTime - t))
      if (v.trust === 'verified') stemVerified.push(Math.abs(refined.lines[v.lineIndex].startTime - t))
    }
    console.log(`  STEM envelope: verified n=${stemVerified.length}` +
      (stemVerified.length ? ` p50=${f(median(stemVerified))} p90=${f(pct(stemVerified, 0.9))} worst=${f(Math.max(...stemVerified))} <=0.5s=${Math.round((stemVerified.filter((e) => e <= 0.5).length / stemVerified.length) * 100)}%` : '') +
      `  checked=${stemTrust.acousticallyChecked}  converged=${stemTrust.converged}`)
    stemConfigs.push({
      name: c.name, verified: stemVerified, checked: stemTrust.acousticallyChecked, converged: stemTrust.converged,
      n: trust.lines.length,
      noEvidence: trust.lines.filter((l) => l.reasons.includes('no-evidence')).length,
      eligibleShare: trust.verifiedShare,
      noEvidenceShare: trust.noEvidenceShare,
      bindingGate:
        trust.noEvidenceShare > 0.25 && trust.verifiedShare < 0.7 ? 'both'
        : trust.noEvidenceShare > 0.25 ? 'coverage'
        : trust.verifiedShare < 0.7 ? 'placement'
        : 'none',
      mixVerified: trust.lines
        .map((l, idx) => ({ l, idx }))
        .filter(({ l }) => l.trust === 'verified' && truthTime[l.lineIndex] != null)
        .map(({ l }) => Math.abs(refined.lines[l.lineIndex].startTime - truthTime[l.lineIndex])),
    })
  }
  for (const v of trust.lines) {
    const t = truthTime[v.lineIndex]
    if (t == null) continue
    allAcoustic[v.trust].push(Math.abs(refined.lines[v.lineIndex].startTime - t))
  }
  perConfig.push({
    name: c.name, trust, byTier, p90: pct(errs, 0.9), worst: Math.max(...errs), badLines, badTotal, badCaught,
    frac250: errs.length ? errs.filter((e) => e <= 0.25).length / errs.length : 0,
  })
  console.log(`  acoustic: ${trust.acousticallyChecked}/${refined.lines.length} lines judged from the mix; text-only 'verified' n=${textVerified.length} p90=${f(pct(textVerified, 0.9))}  →  with-audio 'verified' n=${acoVerified.length} p90=${f(pct(acoVerified, 0.9))}`)
  convergedClaimed.push({ name: c.name, converged: trust.converged, verifiedShare: trust.verifiedShare, p90: pct(errs, 0.9), worst: Math.max(...errs), badLines, n: errs.length })

  console.log(`\n=== ${c.name}  (verifiedShare=${(trust.verifiedShare * 100).toFixed(0)}%  converged=${trust.converged}  acousticallyChecked=${trust.acousticallyChecked})`)
  for (const tier of ['verified', 'weak', 'unverified']) {
    const xs = byTier[tier]
    if (!xs.length) { console.log(`  ${tier.padEnd(11)} n=  0`); continue }
    const within = xs.filter((e) => e <= GOOD_S).length
    console.log(
      `  ${tier.padEnd(11)} n=${String(xs.length).padStart(3)}  true err p50=${f(median(xs))} p90=${f(pct(xs, 0.9))} worst=${f(Math.max(...xs))}  <=${GOOD_S}s=${String(Math.round((within / xs.length) * 100)).padStart(3)}%`,
    )
  }
  console.log(`  repairable list: ${trust.repairableLineIndices.length} lines; caught ${badCaught}/${badTotal} lines truly >${BAD_S}s`)
}

console.log('\n\n=== OVERALL: does the truth-free tier separate true accuracy? (all configs pooled)')
console.log('  tier         n     true p50   true p90   true worst   <=0.5s   <=1s')
for (const tier of ['verified', 'weak', 'unverified']) {
  const xs = all[tier]
  if (!xs.length) continue
  const w05 = xs.filter((e) => e <= 0.5).length
  const w1 = xs.filter((e) => e <= 1).length
  console.log(
    `  ${tier.padEnd(11)} ${String(xs.length).padStart(4)}  ${f(median(xs))}   ${f(pct(xs, 0.9))}    ${f(Math.max(...xs))}    ${String(Math.round((w05 / xs.length) * 100)).padStart(3)}%  ${String(Math.round((w1 / xs.length) * 100)).padStart(3)}%`,
  )
}
const v = all.verified
const u = all.unverified
if (v.length && u.length) {
  const vp90 = pct(v, 0.9)
  const up90 = pct(u, 0.9)
  console.log(`\n  separation: verified p90 ${f(vp90)} vs unverified p90 ${f(up90)}  → ${vp90 < up90 / 2 ? 'SEPARATES' : vp90 < up90 ? 'separates weakly' : 'DOES NOT SEPARATE'}`)
  const vWithin = v.filter((e) => e <= GOOD_S).length / v.length
  console.log(`  a line called 'verified' is within ${GOOD_S}s ${(vWithin * 100).toFixed(0)}% of the time (this is the reliability figure the UI would be claiming)`)
}

console.log('\n=== TEXT-ONLY vs ACOUSTIC: does audio corroboration tighten the top tier?')
for (const [label, bucket] of [['text-only  ', allText.verified], ['with-audio ', allAcoustic.verified]]) {
  if (!bucket.length) { console.log(`  ${label} verified: n=0`); continue }
  const w05 = bucket.filter((e) => e <= 0.5).length
  console.log(
    `  ${label} verified: n=${String(bucket.length).padStart(3)}  p50=${f(median(bucket))} p90=${f(pct(bucket, 0.9))} worst=${f(Math.max(...bucket))}  <=0.5s=${String(Math.round((w05 / bucket.length) * 100)).padStart(3)}%`,
  )
}
// And what the audio calibration pushes DOWN into the lower tiers.
console.log('  with-audio tier separation (pooled):')
for (const tier of ['verified', 'weak', 'unverified']) {
  const xs = allAcoustic[tier]
  if (!xs.length) continue
  const w05 = xs.filter((e) => e <= 0.5).length
  console.log(`    ${tier.padEnd(11)} n=${String(xs.length).padStart(3)}  p50=${f(median(xs))} p90=${f(pct(xs, 0.9))} worst=${f(Math.max(...xs))}  <=0.5s=${String(Math.round((w05 / xs.length) * 100)).padStart(3)}%`)
}

if (allStem.verified.length || stemConfigs.length) {
  console.log('\n=== MIX vs STEM envelope: does a better acoustic source tighten the top tier?')
  const bucket = (xs, label) => {
    if (!xs.length) { console.log(`  ${label}: n=0`); return }
    const w05 = xs.filter((e) => e <= 0.5).length
    console.log(`  ${label}: n=${String(xs.length).padStart(3)}  p50=${f(median(xs))} p90=${f(pct(xs, 0.9))} worst=${f(Math.max(...xs))}  <=0.5s=${String(Math.round((w05 / xs.length) * 100)).padStart(3)}%`)
  }
  bucket(allAcoustic.verified, 'mix-envelope  verified')
  bucket(allStem.verified, 'stem-envelope verified')
  console.log('  (bounded to the 4 configs that have a stem: stranger x3, veil)')
  console.log('  SAME-CONFIG comparison — only these 4, mix vs stem, so the sources are comparable:')
  const sameMix = stemConfigs.flatMap((c) => c.mixVerified)
  bucket(sameMix, '  those 4, mix')
  bucket(allStem.verified, '  those 4, stem')
  console.log('  WHICH GATE IS BINDING (mix audio + acoustic, i.e. what the app has without a')
  console.log('  stem). Two independent gates, reported separately on purpose: `eligibility` is')
  console.log('  lines the transcript could reach, `placement` is how many of those the')
  console.log('  alignment actually got right:')
  for (const c of stemConfigs) {
    console.log(
      `    ${c.name.padEnd(20)} verifiedShare ${String(Math.round(c.eligibleShare * 100)).padStart(3)}% (need 70%)` +
      `  noEvidenceShare ${String(Math.round(c.noEvidenceShare * 100)).padStart(3)}% (max 25%)` +
      `  → binding gate: ${c.bindingGate}`,
    )
  }
}

/**
 * ALERT THRESHOLD — what should the off-timing banner key on?
 *
 * Plan item 3 is to surface this verdict in the UI instead of the shipped per-line labels,
 * which catch 22 of 41 known >1.5s errors (54% recall). Swapping the number that drives a
 * user-facing alert is a behaviour change, so the threshold has to be MEASURED rather than
 * chosen. This prints the candidate signals next to truth so a separation can be seen, and
 * reports whether any single threshold both flags every bad song and stays quiet on the good
 * one.
 */
console.log('\n=== ALERT THRESHOLD: which truth-free signal separates "worth alerting" from "fine"?')
console.log('  (truth columns are absolute error vs LRC; the signals are all computable at runtime)')
console.log('  config                        repairable  repairable%  noEv%  verified%  absP90  <=250ms  verdict')
const rows = []
for (const c of perConfig) {
  const n = c.trust.lines.length
  const repairable = c.trust.repairableLineIndices.length
  const repairableShare = n ? repairable / n : 0
  const absP90 = c.p90
  const within = all.verified.length ? null : null // computed per config below
  // A song is "worth alerting about" when a listener would notice: p90 beyond the
  // perceptual contract's C4 (worst line <= 1.0s) is the strictest defensible line.
  const bad = absP90 > 2.0
  rows.push({ name: c.name, repairableShare, noEvidenceShare: c.trust.noEvidenceShare, verifiedShare: c.trust.verifiedShare, absP90, bad })
  console.log(
    `  ${c.name.padEnd(28)} ${String(repairable).padStart(3)}/${String(n).padEnd(3)}   ${(repairableShare * 100).toFixed(0).padStart(3)}%       ` +
      `${(c.trust.noEvidenceShare * 100).toFixed(0).padStart(3)}%    ${(c.trust.verifiedShare * 100).toFixed(0).padStart(3)}%    ` +
      `${f(absP90)}    ${String(Math.round(c.frac250 * 100)).padStart(4)}%   ${bad ? 'ALERT' : 'quiet'}`,
  )
}
const candidates = [
  ['repairableShare >= 0.30', (r) => r.repairableShare >= 0.3],
  ['repairableShare >= 0.20', (r) => r.repairableShare >= 0.2],
  ['noEvidenceShare >= 0.25', (r) => r.noEvidenceShare >= 0.25],
  ['verifiedShare <= 0.50', (r) => r.verifiedShare <= 0.5],
  ['verifiedShare <= 0.35', (r) => r.verifiedShare <= 0.35],
]
console.log('\n  threshold candidate          alerts bad  quiet on good  separation')
let anyClean = false
for (const [label, test] of candidates) {
  const badFlagged = rows.filter((r) => r.bad).every(test)
  const goodQuiet = rows.filter((r) => !r.bad).every((r) => !test(r))
  const clean = badFlagged && goodQuiet
  if (clean) anyClean = true
  console.log(`  ${label.padEnd(28)} ${String(badFlagged).padEnd(11)} ${String(goodQuiet).padEnd(14)} ${clean ? 'CLEAN ✓' : 'does not separate'}`)
}
console.log(
  `\n  ${anyClean ? 'At least one threshold separates cleanly on this corpus.' : 'NO single threshold separates cleanly on this corpus.'}`,
)
console.log('  A signal that cannot separate is not a usable alert trigger: item 3 must not be wired')
console.log('  onto it without further work, and the shipped label-based count stays until then.')

console.log('\n=== OPERATIONAL: is `converged` a safe stop signal?')
const claimed = convergedClaimed.filter((c) => c.converged)
const notClaimed = convergedClaimed.filter((c) => !c.converged)
console.log(`  configs claiming converged: ${claimed.length}/${convergedClaimed.length}`)
for (const c of claimed) {
  console.log(`    ${c.name.padEnd(20)} p90=${f(c.p90)} worst=${f(c.worst)} lines>${BAD_S}s=${c.badLines}/${c.n}  <-- must be near zero to be safe`)
}
for (const c of notClaimed) {
  console.log(`    (not converged) ${c.name.padEnd(20)} p90=${f(c.p90)} worst=${f(c.worst)} lines>${BAD_S}s=${c.badLines}/${c.n}`)
}
