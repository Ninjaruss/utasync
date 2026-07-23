/**
 * Corpus scorecard for CTC forced alignment of KNOWN lyrics (MMS 1130-language,
 * romanized) vs synced-LRC truth — the multi-song check that a single-song spike
 * can't give. Loads the model/analyzer once and sweeps every fixture that has BOTH
 * committed audio and LRC truth.
 *
 *   npx tsx scripts/forced-align-scorecard.mjs [--song <name>] [--extra <mp3> <lyrics> <truth>]
 *
 * Prints one row per song: mean / p50 / p90 / >1s / >1.5s line-start error.
 * Never prints lyric text — indices and times only.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers'
import KuroshiroPkg from 'kuroshiro'
import KuromojiAnalyzerPkg from 'kuroshiro-analyzer-kuromoji'
const Kuroshiro = KuroshiroPkg?.default ?? KuroshiroPkg
const KuromojiAnalyzer = KuromojiAnalyzerPkg?.default ?? KuromojiAnalyzerPkg

env.allowLocalModels = false
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ID = 'onnx-community/mms-300m-1130-forced-aligner-ONNX'
const TARGET_SR = 16000
const CHUNK_S = 30
const VOCAB = ['<blank>', '<pad>', '</s>', '<unk>', 'a', 'i', 'e', 'n', 'o', 'u', 't', 's', 'r', 'm', 'k', 'l', 'd', 'g', 'h', 'y', 'b', 'p', 'w', 'c', 'v', 'j', 'z', 'f', "'", 'q', 'x']
const CHAR2ID = new Map(VOCAB.map((t, i) => [t, i]).filter(([t]) => t.length === 1))
const BLANK = 0
const V = VOCAB.length

const F = (p) => join(root, p)
const SONGS = [
  { name: 'veil', audio: F('public/e2e/veil.mp3'), lyrics: F('tests/ai-pipeline/fixtures/veil/lyrics.ja.txt'), truth: F('tests/ai-pipeline/fixtures/lrc-truth/veil.json') },
  { name: 'guitar-loneliness', audio: F('public/e2e/guitar.mp3'), lyrics: F('tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt'), truth: F('tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json') },
  { name: 'stranger-than-heaven', audio: F('public/e2e/stranger.mp3'), lyrics: F('tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt'), truth: F('tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json') },
]
const extraAt = process.argv.indexOf('--extra')
if (extraAt >= 0) {
  SONGS.push({ name: 'extra', audio: process.argv[extraAt + 1], lyrics: process.argv[extraAt + 2], truth: process.argv[extraAt + 3] })
}
const only = process.argv.indexOf('--song') >= 0 ? process.argv[process.argv.indexOf('--song') + 1] : null

const { decodeMp3ToMono } = await import(pathToFileURL(F('scripts/lib/nodeAudio.mjs')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(F('scripts/lib/lrcTruth.mjs')).href)

console.log('loading MMS forced aligner + kuroshiro…')
const model = await AutoModel.from_pretrained(ID, { dtype: 'q8' })
const proc = await AutoProcessor.from_pretrained(ID)
const kuro = new Kuroshiro()
await kuro.init(new KuromojiAnalyzer({ dictPath: F('node_modules/kuromoji/dict') }))

const romanize = async (t) => {
  const r = await kuro.convert(t, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
  return r.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z']/g, '')
}

async function emissionsFor(audio) {
  const parts = []
  let total = 0
  for (let off = 0; off < audio.length; off += CHUNK_S * TARGET_SR) {
    const slice = audio.subarray(off, Math.min(off + CHUNK_S * TARGET_SR, audio.length))
    if (slice.length < TARGET_SR * 0.5) break
    const out = await model(await proc(slice))
    const lg = out.logits
    const [, fr, C] = lg.dims
    const d = lg.data
    const part = new Float32Array(fr * C)
    for (let f = 0; f < fr; f++) {
      let mx = -Infinity
      for (let c = 0; c < C; c++) mx = Math.max(mx, d[f * C + c])
      let sum = 0
      for (let c = 0; c < C; c++) sum += Math.exp(d[f * C + c] - mx)
      const lse = mx + Math.log(sum)
      for (let c = 0; c < C; c++) part[f * C + c] = d[f * C + c] - lse
    }
    parts.push(part)
    total += fr
  }
  const em = new Float32Array(total * V)
  let w = 0
  for (const p of parts) { em.set(p, w); w += p.length }
  return { em, frames: total }
}

/** CTC forced-alignment trellis; returns the frame each token was consumed at. */
function align(em, frames, tokens) {
  const N = tokens.length
  const T = frames
  const NEG = -1e30
  let prev = new Float32Array(N + 1).fill(NEG)
  let cur = new Float32Array(N + 1).fill(NEG)
  const bp = new Uint8Array((T + 1) * (N + 1))
  prev[0] = 0
  for (let t = 1; t <= T; t++) {
    const e = (t - 1) * V
    cur[0] = prev[0] + em[e + BLANK]
    const jMax = Math.min(N, t)
    for (let j = 1; j <= jMax; j++) {
      const stay = prev[j] + em[e + BLANK]
      const adv = prev[j - 1] + em[e + tokens[j - 1]]
      if (adv > stay) { cur[j] = adv; bp[t * (N + 1) + j] = 1 } else { cur[j] = stay; bp[t * (N + 1) + j] = 0 }
    }
    for (let j = jMax + 1; j <= N; j++) cur[j] = NEG
    const tmp = prev; prev = cur; cur = tmp
  }
  const tokFrame = new Int32Array(N).fill(-1)
  let j = N
  for (let t = T; t > 0 && j > 0; t--) if (bp[t * (N + 1) + j] === 1) { tokFrame[j - 1] = t - 1; j-- }
  return { tokFrame, unaligned: j }
}

/**
 * Windowed alignment: align groups of lines sequentially inside BOUNDED audio
 * windows advanced by a cursor, so a seam where the lyrics don't cover the audio
 * can only corrupt its own group instead of cascading through the rest of the song
 * (the failure this scorecard's monolithic baseline exhibits: p50 fine, p90 blown).
 * Each window opens slightly before the cursor and is generous enough to absorb an
 * instrumental break before the group's first sung line.
 */
function alignWindowed(em, frames, lineTokens, fps, opts) {
  const GROUP = opts?.group ?? 4
  const totalTokens = lineTokens.reduce((a, t) => a + t.length, 0)
  const secPerTok = frames / fps / Math.max(1, totalTokens)
  const lineTime = new Array(lineTokens.length).fill(null)
  let cursor = 0
  for (let g = 0; g < lineTokens.length; g += GROUP) {
    const groupLines = lineTokens.slice(g, g + GROUP)
    const toks = groupLines.flat()
    if (!toks.length) continue
    const expectedFrames = toks.length * secPerTok * fps
    const startF = Math.max(0, cursor - Math.round(2 * fps))
    const span = Math.max(Math.round(30 * fps), Math.round(expectedFrames * 4))
    const endF = Math.min(frames, startF + span)
    if (endF - startF < toks.length) continue
    const sub = em.subarray(startF * V, endF * V)
    const { tokFrame } = align(sub, endF - startF, toks)
    let k = 0
    for (let li = 0; li < groupLines.length; li++) {
      if (groupLines[li].length && tokFrame[k] >= 0) lineTime[g + li] = (startF + tokFrame[k]) / fps
      k += groupLines[li].length
    }
    const last = tokFrame[toks.length - 1]
    cursor = last >= 0 ? startF + last + 1 : endF
    if (opts?.debug) {
      const first = tokFrame[0]
      console.log(
        `  grp${String(g).padStart(3)} toks=${String(toks.length).padStart(4)} ` +
        `win=[${(startF / fps).toFixed(1)},${(endF / fps).toFixed(1)}]s ` +
        `firstTok=${first >= 0 ? ((startF + first) / fps).toFixed(1) : '—'}s ` +
        `lastTok=${last >= 0 ? ((startF + last) / fps).toFixed(1) : '—'}s ` +
        `-> cursor=${(cursor / fps).toFixed(1)}s`,
      )
    }
  }
  return lineTime
}

/**
 * Anchor-bounded re-alignment. Monolithic CTC nails the median but cascades at
 * seams; naive cursor-windowing is WORSE because an open-ended window lets CTC
 * smear tokens across it (blanks cost nothing) — the global token/audio density is
 * exactly what makes the monolithic pass work. So keep that pass, score every line
 * by how strongly the model actually saw its characters, then RE-ALIGN each run of
 * low-confidence lines inside the frame range BOUNDED ON BOTH SIDES by trusted
 * lines. Bounding both ends preserves the density constraint while containing a
 * bad seam so it cannot cascade.
 */
function alignAnchored(em, frames, lineTokens, fps, opts) {
  const flat = lineTokens.flat()
  const lineStart = []
  { let acc = 0; for (const lt of lineTokens) { lineStart.push(acc); acc += lt.length } }
  const { tokFrame } = align(em, frames, flat)
  const score = lineTokens.map((lt, i) => {
    if (!lt.length) return -Infinity
    let s = 0, n = 0
    for (let k = 0; k < lt.length; k++) {
      const f = tokFrame[lineStart[i] + k]
      if (f >= 0) { s += em[f * V + lt[k]]; n++ }
    }
    return n ? s / n : -Infinity
  })
  const valid = score.filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
  const q = opts?.suspectQuantile ?? 0.4
  const thresh = valid.length ? valid[Math.floor(q * valid.length)] : -Infinity
  const trusted = score.map((s) => Number.isFinite(s) && s >= thresh)
  const lineTime = lineTokens.map((lt, i) => (lt.length && tokFrame[lineStart[i]] >= 0 ? tokFrame[lineStart[i]] / fps : null))

  let i = 0
  let repaired = 0
  while (i < lineTokens.length) {
    if (trusted[i]) { i++; continue }
    let a = i - 1
    while (a >= 0 && !trusted[a]) a--
    let b = i
    while (b < lineTokens.length && !trusted[b]) b++
    if (a < 0 || b >= lineTokens.length) { i = b + 1; continue } // unbracketed — leave alone
    const f0 = tokFrame[lineStart[a]]
    const f1 = tokFrame[lineStart[b]]
    if (f0 >= 0 && f1 > f0) {
      const seg = []
      for (let li = a; li < b; li++) seg.push(...lineTokens[li])
      if (seg.length && f1 - f0 >= seg.length) {
        const sub = em.subarray(f0 * V, f1 * V)
        const r = align(sub, f1 - f0, seg)
        let k = 0
        for (let li = a; li < b; li++) {
          if (lineTokens[li].length && r.tokFrame[k] >= 0) lineTime[li] = (f0 + r.tokFrame[k]) / fps
          k += lineTokens[li].length
        }
        repaired++
      }
    }
    i = b + 1
  }
  if (opts?.debug) console.log(`  anchored: ${trusted.filter(Boolean).length}/${lineTokens.length} trusted, ${repaired} run(s) repaired`)
  return lineTime
}

const ANCHORED = process.argv.includes('--anchored')
const WINDOWED = process.argv.includes('--windowed')
const GROUP_N = process.argv.indexOf('--group') >= 0 ? Number(process.argv[process.argv.indexOf('--group') + 1]) : 4
const rows = []
for (const s of SONGS) {
  if (only && s.name !== only) continue
  if (!existsSync(s.audio) || !existsSync(s.lyrics) || !existsSync(s.truth)) { console.log(`skip ${s.name} (missing asset)`); continue }
  const lineTexts = readFileSync(s.lyrics, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const tokens = []
  const lineStart = []
  const lineTokens = []
  for (const t of lineTexts) {
    const r = await romanize(t)
    lineStart.push(tokens.length)
    const per = []
    for (const ch of r) { const id = CHAR2ID.get(ch); if (id != null) { tokens.push(id); per.push(id) } }
    lineTokens.push(per)
  }
  const dec = await decodeMp3ToMono(s.audio)
  const ratio = dec.sampleRate / TARGET_SR
  const n16 = Math.floor(dec.data.length / ratio)
  const audio = new Float32Array(n16)
  for (let i = 0; i < n16; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, dec.data.length - 1)
    audio[i] = dec.data[lo] * (1 - (pos - lo)) + dec.data[hi] * (pos - lo)
  }
  const { em, frames } = await emissionsFor(audio)
  const fps = frames / (audio.length / TARGET_SR)
  if (frames < tokens.length) { console.log(`skip ${s.name} (audio shorter than token count)`); continue }
  let lineTime
  let unaligned = 0
  if (ANCHORED) {
    lineTime = alignAnchored(em, frames, lineTokens, fps, { debug: process.argv.includes('--debug') })
  } else if (WINDOWED) {
    lineTime = alignWindowed(em, frames, lineTokens, fps, { group: GROUP_N, debug: process.argv.includes("--debug") })
  } else {
    const r = align(em, frames, tokens)
    unaligned = r.unaligned
    lineTime = lineStart.map((k) => (r.tokFrame[k] >= 0 ? r.tokFrame[k] / fps : null))
  }

  const tj = JSON.parse(readFileSync(s.truth, 'utf8'))
  const truth = tj.syncedLyrics ? matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics)) : lineTexts.map(() => null)
  const diffs = []
  for (let i = 0; i < lineTexts.length; i++) if (truth[i] != null && lineTime[i] != null) diffs.push(lineTime[i] - truth[i])
  const so = [...diffs].sort((a, b) => a - b)
  const off = so.length ? so[Math.floor(so.length / 2)] : 0
  const errs = []
  for (let i = 0; i < lineTexts.length; i++) {
    if (truth[i] == null || lineTime[i] == null) continue
    errs.push(Math.abs(lineTime[i] - (truth[i] + off)))
  }
  const e = [...errs].sort((a, b) => a - b)
  const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)
  rows.push({
    name: s.name, lines: lineTexts.length, scored: errs.length, unaligned,
    mean, p50: e[Math.floor(0.5 * e.length)] ?? 0, p90: e[Math.floor(0.9 * e.length)] ?? 0,
    over1: errs.filter((x) => x > 1).length, over15: errs.filter((x) => x > 1.5).length,
  })
  console.log(`done ${s.name}: mean=${mean.toFixed(2)}s`)
}

console.log('\n=== FORCED-ALIGNMENT CORPUS SCORECARD (lower is better) ===')
console.log('song                      lines scored  mean   p50    p90   >1s  >1.5s')
for (const r of rows) {
  console.log(
    `${r.name.padEnd(24)} ${String(r.lines).padStart(5)} ${String(r.scored).padStart(6)} ` +
    `${r.mean.toFixed(2).padStart(5)} ${r.p50.toFixed(2).padStart(5)} ${r.p90.toFixed(2).padStart(6)} ` +
    `${String(r.over1).padStart(4)} ${String(r.over15).padStart(6)}`,
  )
}
const all = rows.flatMap((r) => Array(r.scored).fill(r.mean))
if (rows.length) console.log(`\ncorpus mean of per-song means: ${(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(2)}s`)
void all
