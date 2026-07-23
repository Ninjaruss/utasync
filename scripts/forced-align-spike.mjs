/**
 * SPIKE: CTC forced alignment of the KNOWN lyrics against the vocal stem, using
 * the MMS-300M 1130-language forced-aligner (romanized char vocab).
 * Unlike the Whisper path this aligns the lyrics we already have, so it cannot be
 * derailed by mis-transcription. Scored against the same synced-LRC truth.
 *
 *   npx tsx scripts/_tmp-forced-align.mjs <stem.pcm> <lyrics.txt> <truth.json>
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AutoModel, AutoProcessor, AutoTokenizer, env } from '@huggingface/transformers'
import KuroshiroPkg from 'kuroshiro'
import KuromojiAnalyzerPkg from 'kuroshiro-analyzer-kuromoji'
const Kuroshiro = KuroshiroPkg?.default ?? KuroshiroPkg
const KuromojiAnalyzer = KuromojiAnalyzerPkg?.default ?? KuromojiAnalyzerPkg

env.allowLocalModels = false
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ID = 'onnx-community/mms-300m-1130-forced-aligner-ONNX'
const STEM_SR = 44100
const TARGET_SR = 16000
const CHUNK_S = 30

const [, , pcmPath, lyricsPath, truthPath] = process.argv
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

// ---------- 1. lyrics → romaji → token ids ----------
const lineTexts = readFileSync(lyricsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const kuro = new Kuroshiro()
await kuro.init(new KuromojiAnalyzer({ dictPath: join(root, 'node_modules/kuromoji/dict') }))
const VOCAB = ['<blank>', '<pad>', '</s>', '<unk>', 'a', 'i', 'e', 'n', 'o', 'u', 't', 's', 'r', 'm', 'k', 'l', 'd', 'g', 'h', 'y', 'b', 'p', 'w', 'c', 'v', 'j', 'z', 'f', "'", 'q', 'x']
const CHAR2ID = new Map(VOCAB.map((t, i) => [t, i]).filter(([t]) => t.length === 1))
const BLANK = 0

const romanizeLine = async (t) => {
  const r = await kuro.convert(t, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
  return r.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z']/g, '')
}
const tokens = [] // flat token ids
const lineStartTok = [] // index into tokens where each line begins
for (const t of lineTexts) {
  const r = await romanizeLine(t)
  lineStartTok.push(tokens.length)
  for (const ch of r) { const id = CHAR2ID.get(ch); if (id != null) tokens.push(id) }
}
console.log(`lines=${lineTexts.length} romaji tokens=${tokens.length}`)
if (!tokens.length) { console.error('no tokens'); process.exit(2) }

// ---------- 2. source → 16k mono (raw .mp3 MIX or pre-separated .pcm stem) ----------
let src, srcRate
if (pcmPath.toLowerCase().endsWith('.mp3')) {
  const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
  const dec = await decodeMp3ToMono(pcmPath)
  src = dec.data
  srcRate = dec.sampleRate
} else {
  const buf = readFileSync(pcmPath)
  src = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  srcRate = STEM_SR
}
const ratio = srcRate / TARGET_SR
const n16 = Math.floor(src.length / ratio)
const audio = new Float32Array(n16)
for (let i = 0; i < n16; i++) {
  const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, src.length - 1)
  audio[i] = src[lo] * (1 - (pos - lo)) + src[hi] * (pos - lo)
}
console.log(`audio ${(audio.length / TARGET_SR).toFixed(1)}s @${TARGET_SR} (src ${srcRate}Hz, ${pcmPath.endsWith('.mp3') ? 'MIX' : 'STEM'})`)

// ---------- 3. chunked emissions (log-softmax) ----------
const model = await AutoModel.from_pretrained(ID, { dtype: 'q8' })
const proc = await AutoProcessor.from_pretrained(ID)
const V = VOCAB.length
const emParts = []
let totalFrames = 0
const chunkLen = CHUNK_S * TARGET_SR
for (let off = 0; off < audio.length; off += chunkLen) {
  const slice = audio.subarray(off, Math.min(off + chunkLen, audio.length))
  if (slice.length < TARGET_SR * 0.5) break
  const inputs = await proc(slice)
  const out = await model(inputs)
  const lg = out.logits
  const [, F, C] = lg.dims
  const d = lg.data
  const part = new Float32Array(F * C)
  for (let f = 0; f < F; f++) { // log-softmax per frame
    let mx = -Infinity
    for (let c = 0; c < C; c++) mx = Math.max(mx, d[f * C + c])
    let sum = 0
    for (let c = 0; c < C; c++) sum += Math.exp(d[f * C + c] - mx)
    const lse = mx + Math.log(sum)
    for (let c = 0; c < C; c++) part[f * C + c] = d[f * C + c] - lse
  }
  emParts.push({ part, F })
  totalFrames += F
  process.stdout.write(`  chunk @${(off / TARGET_SR).toFixed(0)}s frames=${F}\r`)
}
const em = new Float32Array(totalFrames * V)
let w = 0
for (const p of emParts) { em.set(p.part, w); w += p.part.length }
const fps = totalFrames / (audio.length / TARGET_SR)
console.log(`\nemissions frames=${totalFrames} fps=${fps.toFixed(2)}`)

// ---------- 4. CTC forced-alignment trellis (torchaudio-style) ----------
const N = tokens.length
const T = totalFrames
if (T < N) { console.error(`audio too short for tokens (T=${T} < N=${N})`); process.exit(2) }
const NEG = -1e30
// trellis[t][j]; keep two rows + a full backpointer matrix (bit per cell)
let prev = new Float32Array(N + 1).fill(NEG)
let cur = new Float32Array(N + 1).fill(NEG)
const bp = new Uint8Array((T + 1) * (N + 1)) // 1 = came from advance (j-1)
prev[0] = 0
for (let t = 1; t <= T; t++) {
  const e = (t - 1) * V
  cur[0] = prev[0] + em[e + BLANK]
  bp[t * (N + 1)] = 0
  const jMax = Math.min(N, t)
  for (let j = 1; j <= jMax; j++) {
    const stay = prev[j] + em[e + BLANK]
    const adv = prev[j - 1] + em[e + tokens[j - 1]]
    if (adv > stay) { cur[j] = adv; bp[t * (N + 1) + j] = 1 } else { cur[j] = stay; bp[t * (N + 1) + j] = 0 }
  }
  for (let j = jMax + 1; j <= N; j++) cur[j] = NEG
  const tmp = prev; prev = cur; cur = tmp
}
// backtrack: frame at which each token was consumed
const tokFrame = new Int32Array(N).fill(-1)
let j = N
for (let t = T; t > 0 && j > 0; t--) {
  if (bp[t * (N + 1) + j] === 1) { tokFrame[j - 1] = t - 1; j-- }
}
if (j > 0) console.warn(`WARN: ${j} tokens unaligned`)

// ---------- 5. per-line start times + score ----------
const lineTime = lineStartTok.map((s) => (tokFrame[s] >= 0 ? tokFrame[s] / fps : null))
const tj = JSON.parse(readFileSync(truthPath, 'utf8'))
const truth = matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics))
const diffs = []
for (let i = 0; i < lineTexts.length; i++) if (truth[i] != null && lineTime[i] != null) diffs.push(lineTime[i] - truth[i])
const so = [...diffs].sort((a, b) => a - b)
const off = so.length ? so[Math.floor(so.length / 2)] : 0
const errs = []
console.log(`\noffset ${off.toFixed(2)}s removed\nidx   aligned |   truth |    err   text`)
for (let i = 0; i < lineTexts.length; i++) {
  if (truth[i] == null || lineTime[i] == null) continue
  const err = lineTime[i] - (truth[i] + off)
  errs.push(Math.abs(err))
  const flag = Math.abs(err) > 1.5 ? '!!' : Math.abs(err) > 1 ? ' !' : '  '
  if (Math.abs(err) > 1) console.log(`${flag}#${String(i).padStart(2)} ${lineTime[i].toFixed(2).padStart(8)} | ${truth[i].toFixed(2).padStart(7)} | ${err.toFixed(2).padStart(6)}`)
}
const s = [...errs].sort((a, b) => a - b)
const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)
console.log(`\nFORCED-ALIGN SUMMARY n=${errs.length} mean=${mean.toFixed(2)}s p50=${(s[Math.floor(0.5 * s.length)] ?? 0).toFixed(2)}s p90=${(s[Math.floor(0.9 * s.length)] ?? 0).toFixed(2)}s >1s=${errs.filter((e) => e > 1).length} >1.5s=${errs.filter((e) => e > 1.5).length}`)
