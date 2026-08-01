// scripts/hybrid-align-scorecard.mjs
/**
 * SPIKE (selective anchored CTC refine): does a CTC refiner applied ONLY to
 * untrusted lines, inside windows pinned by trusted anchor lines from the
 * shipped pipeline, beat the current word-mode + mixed-consensus baseline on
 * dense code-switched songs?
 *
 * Prior art: 531e0d3 measured the BLANKET hybrid (all lines, 4-line groups) —
 * mixed result, do not adopt. This is the selective variant that commit's
 * conclusion flagged as the only plausible-but-unvalidated role.
 *
 *   npx tsx scripts/hybrid-align-scorecard.mjs                # baseline table
 *   npx tsx scripts/hybrid-align-scorecard.mjs --selective    # + CTC refine
 *   npx tsx scripts/hybrid-align-scorecard.mjs --sweep        # pad/policy sweep
 *   flags: --song <name> --pad <s> --anchors consensus|good|both --debug
 *          --ja-mode word|segment   (mixed songs only; default word)
 *
 * Baseline-only runs (no --selective/--sweep) never load the CTC model or
 * kuroshiro — that machinery is loaded lazily, only when actually needed.
 *
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
const F = (p) => join(root, p)

// --- CTC constants (copied verbatim from forced-align-scorecard.mjs) ---
const ID = 'onnx-community/mms-300m-1130-forced-aligner-ONNX'
const TARGET_SR = 16000
const CHUNK_S = 30
const VOCAB = ['<blank>', '<pad>', '</s>', '<unk>', 'a', 'i', 'e', 'n', 'o', 'u', 't', 's', 'r', 'm', 'k', 'l', 'd', 'g', 'h', 'y', 'b', 'p', 'w', 'c', 'v', 'j', 'z', 'f', "'", 'q', 'x']
const CHAR2ID = new Map(VOCAB.map((t, i) => [t, i]).filter(([t]) => t.length === 1))
const BLANK = 0
const V = VOCAB.length

const SONGS = [
  {
    name: 'recollect', mixed: true,
    audio: F('public/e2e/recollect.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/recollect/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/recollect/transcript.word.json'),
    jaSegment: F('tests/ai-pipeline/fixtures/recollect/transcript.segment.json'),
    en: F('tests/ai-pipeline/fixtures/recollect/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/recollect.json'),
  },
  {
    name: 'stranger-than-heaven', mixed: true,
    audio: F('public/e2e/stranger.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json'),
    jaSegment: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.json'),
    en: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json'),
  },
  {
    name: 'guitar-loneliness', mixed: false,
    audio: F('public/e2e/guitar.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json'),
  },
  {
    name: 'veil', mixed: false,
    audio: F('public/e2e/veil.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/veil/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/veil/transcript.words.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/veil.json'),
  },
  {
    name: 'going-my-way', mixed: false,
    audio: F('public/e2e/going-my-way.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/going-my-way/lyrics.txt'),
    ja: null, // no committed transcript — skipped in baseline mode (CTC-only guard later)
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/going-my-way.json'),
  },
]

/** Word array or {chunks:[{text,timestamp}]} — mirrors forced-align-scorecard. */
function loadTranscriptWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime, endTime: w.endTime }]
    })
  }
  return (raw.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

const { refineAlignmentWithPhrases } = await import(pathToFileURL(F('src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment, consensusAgreedLines } = await import(pathToFileURL(F('src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { detectSheetLanguage } = await import(pathToFileURL(F('src/ai-pipeline/whisperLanguage.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(F('scripts/lib/lrcTruth.mjs')).href)
const { decodeMp3ToMono } = await import(pathToFileURL(F('scripts/lib/nodeAudio.mjs')).href)
const { buildSelectiveWindows } = await import(pathToFileURL(F('scripts/lib/selectiveWindows.mjs')).href)

/** Raw + offset-normalized line-start error vs truth. */
function score(lineTimes, truth) {
  const idx = []
  for (let i = 0; i < truth.length; i++) if (truth[i] != null && lineTimes[i] != null) idx.push(i)
  const raw = idx.map((i) => Math.abs(lineTimes[i] - truth[i]))
  const diffs = idx.map((i) => lineTimes[i] - truth[i]).sort((a, b) => a - b)
  const off = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  const norm = idx.map((i) => Math.abs(lineTimes[i] - (truth[i] + off)))
  const stats = (errs) => {
    const e = [...errs].sort((a, b) => a - b)
    return {
      mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
      p50: e[Math.floor(0.5 * e.length)] ?? 0,
      p90: e[Math.floor(0.9 * e.length)] ?? 0,
      over1: errs.filter((x) => x > 1).length,
      over15: errs.filter((x) => x > 1.5).length,
    }
  }
  return { scored: idx.length, offset: off, raw: stats(raw), norm: stats(norm) }
}

/**
 * Baseline app-path alignment; returns { lines, quality, anchors: {consensus, good} }.
 * `jaPath` overrides `song.ja` for mixed songs (word vs. segment JA-pass fixture —
 * see --ja-mode); single-language songs ignore it (only one transcript exists).
 */
function runBaseline(song, lineTexts, jaPath) {
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  if (song.mixed) {
    const jaWords = loadTranscriptWords(jaPath ?? song.ja)
    const enWords = loadTranscriptWords(song.en)
    const res = refineMixedLanguageAlignment(rows, jaWords, enWords)
    const consensus = consensusAgreedLines(res.passes.ja, res.passes.en).map((a) => a.li)
    const good = (res.refined.lineAlignmentQuality ?? [])
      .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
    return { lines: res.refined.lines, quality: res.refined.lineAlignmentQuality, anchors: { consensus, good } }
  }
  const words = loadTranscriptWords(song.ja)
  const lang = detectSheetLanguage(lineTexts, 'ja')
  const refined = refineAlignmentWithPhrases(rows, words, lang)
  const good = (refined.lineAlignmentQuality ?? [])
    .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
  return { lines: refined.lines, quality: refined.lineAlignmentQuality, anchors: { consensus: good, good } }
}

/** Which JA transcript fixture feeds the baseline for this song + --ja-mode. */
function jaPathForMode(song, mode) {
  if (!song.mixed) return song.ja
  return mode === 'segment' ? song.jaSegment : song.ja
}

/**
 * Default (word) mode must print the SAME label as the committed baseline —
 * required so `--song veil` (single-language, unaffected) and any mixed song
 * run with no --ja-mode flag stay byte-identical to the pre-Task-5 script.
 */
function baselineLabel(song, mode) {
  if (song.mixed && mode !== 'word') return `${song.name} (baseline ja=${mode})`
  return `${song.name} (baseline)`
}

// --- CTC machinery (copied verbatim from forced-align-scorecard.mjs) ---

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

// Model/processor/kuroshiro are loaded lazily — baseline-only runs must not
// download or load anything.
let model = null
let proc = null
let kuro = null
async function ensureCtcLoaded() {
  if (model) return
  console.log('loading MMS forced aligner + kuroshiro…')
  model = await AutoModel.from_pretrained(ID, { dtype: 'q8' })
  proc = await AutoProcessor.from_pretrained(ID)
  kuro = new Kuroshiro()
  await kuro.init(new KuromojiAnalyzer({ dictPath: F('node_modules/kuromoji/dict') }))
}

const romanize = async (t) => {
  const r = await kuro.convert(t, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
  return r.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z']/g, '')
}

/**
 * Per-song CTC prep, done ONCE regardless of how many ja-mode/anchor/pad
 * configs get swept: tokenize every lyric line (romanize + char->id), decode
 * + resample the audio to 16kHz, and run it through the model for emissions.
 * Emissions are minutes of CPU — never recompute them per config.
 */
async function ctcSetupForSong(lineTexts, audioPath) {
  await ensureCtcLoaded()
  const lineTokens = []
  for (const t of lineTexts) {
    const r = await romanize(t)
    const per = []
    for (const ch of r) { const id = CHAR2ID.get(ch); if (id != null) per.push(id) }
    lineTokens.push(per)
  }
  const dec = await decodeMp3ToMono(audioPath)
  const ratio = dec.sampleRate / TARGET_SR
  const n16 = Math.floor(dec.data.length / ratio)
  const audio = new Float32Array(n16)
  for (let i = 0; i < n16; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, dec.data.length - 1)
    audio[i] = dec.data[lo] * (1 - (pos - lo)) + dec.data[hi] * (pos - lo)
  }
  const { em, frames } = await emissionsFor(audio)
  const fps = frames / (audio.length / TARGET_SR)
  const durationSec = audio.length / TARGET_SR
  return { lineTokens, em, frames, fps, durationSec }
}

/**
 * Selective refine: keep every baseline time; re-time ONLY untrusted lines
 * inside closed anchor-bounded windows. Anchor lines are never touched — the
 * blanket hybrid (531e0d3) lost by refining lines that were already right.
 */
function refineSelective(em, frames, fps, lineTokens, baseLines, anchorIdx, durationSec, padSec, debug) {
  const out = baseLines.map((l) => l.startTime)
  const windows = buildSelectiveWindows({
    lines: baseLines, tokensPerLine: lineTokens.map((t) => t.length),
    anchorIdx, durationSec, padSec,
  })
  let refined = 0
  for (const w of windows) {
    const f0 = Math.max(0, Math.floor(w.t0 * fps))
    const f1 = Math.min(frames, Math.ceil(w.t1 * fps))
    const toks = w.lineIdx.flatMap((i) => lineTokens[i])
    if (f1 - f0 < toks.length) continue
    const r = align(em.subarray(f0 * V, f1 * V), f1 - f0, toks)
    let k = 0
    for (const i of w.lineIdx) {
      if (lineTokens[i].length && r.tokFrame[k] >= 0) { out[i] = (f0 + r.tokFrame[k]) / fps; refined++ }
      k += lineTokens[i].length
    }
    if (debug) console.log(`  win [${w.t0.toFixed(1)},${w.t1.toFixed(1)}]s lines=${w.lineIdx.join(',')} toks=${toks.length} unaligned=${r.unaligned}`)
  }
  if (debug) console.log(`  selective: ${windows.length} windows, ${refined} lines re-timed`)
  return out
}

/**
 * consensus = base.anchors.consensus; good = base.anchors.good;
 * both = sorted-deduped union; none = empty anchorIdx — the whole song
 * becomes one guarded window (monolithic CTC bounded [0,durationSec]).
 */
function pickAnchors(base, policy) {
  if (policy === 'none') return []
  if (policy === 'good') return base.anchors.good
  if (policy === 'both') return [...new Set([...base.anchors.consensus, ...base.anchors.good])].sort((a, b) => a - b)
  return base.anchors.consensus
}

const argv = process.argv
const argAfter = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def }
const only = argAfter('--song', null)
const debug = argv.includes('--debug')
const SELECTIVE = argv.includes('--selective')
const SWEEP = argv.includes('--sweep')
const jaModeArg = argAfter('--ja-mode', 'word')
if (jaModeArg !== 'word' && jaModeArg !== 'segment') {
  throw new Error(`--ja-mode must be 'word' or 'segment', got '${jaModeArg}'`)
}
const padArg = Number(argAfter('--pad', '1'))
const anchorsArg = argAfter('--anchors', 'consensus')

const rows = []
for (const song of SONGS) {
  if (only && song.name !== only) continue
  if (!song.ja || !existsSync(song.ja) || !existsSync(song.lyrics) || !existsSync(song.truth)) {
    console.log(`skip ${song.name} (missing fixture)`)
    continue
  }
  const lineTexts = readFileSync(song.lyrics, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  if (debug) {
    const jaWords = loadTranscriptWords(song.ja)
    console.log(`${song.name}: lines=${lineTexts.length} jaWords=${jaWords.length}${song.en ? ` enWords=${loadTranscriptWords(song.en).length}` : ''}`)
  }
  const tj = JSON.parse(readFileSync(song.truth, 'utf8'))
  const truth = matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics))

  // Baseline variant(s) for this song: --sweep runs BOTH ja-modes for mixed
  // songs (self-contained table); everything else runs the single --ja-mode
  // (default 'word', which is what keeps a no-flag run byte-identical).
  const jaModes = SWEEP && song.mixed ? ['word', 'segment'] : [jaModeArg]
  const baselines = {}
  for (const mode of jaModes) {
    const jaPath = jaPathForMode(song, mode)
    if (!jaPath || !existsSync(jaPath)) {
      console.log(`skip ${song.name} ja=${mode} (missing transcript fixture)`)
      continue
    }
    const base = runBaseline(song, lineTexts, jaPath)
    baselines[mode] = base
    const s = score(base.lines.map((l) => l.startTime), truth)
    rows.push({ name: baselineLabel(song, mode), ...s, anchors: base.anchors.consensus.length })
    const modeTag = mode !== 'word' ? ` ja=${mode}` : ''
    console.log(`${song.name}: baseline${modeTag} scored=${s.scored} rawMean=${s.raw.mean.toFixed(2)} normMean=${s.norm.mean.toFixed(2)} anchors=${base.anchors.consensus.length}`)
  }

  if (!SELECTIVE && !SWEEP) continue // baseline-only: never touch the CTC model
  if (!Object.keys(baselines).length) continue // no usable baseline to refine from

  // Audio decode + emissions ONCE per song — reused across every ja-mode /
  // anchor-policy / pad config below (emissions are minutes of CPU).
  const ctc = await ctcSetupForSong(lineTexts, song.audio)

  const runSelectiveConfig = (mode, policy, pad) => {
    const base = baselines[mode]
    if (!base) return
    const anchorIdx = pickAnchors(base, policy)
    if (!anchorIdx.length) console.log(`(${song.name}: 0 anchors — selective degenerates to guarded monolithic)`)
    const lineTimes = refineSelective(ctc.em, ctc.frames, ctc.fps, ctc.lineTokens, base.lines, anchorIdx, ctc.durationSec, pad, debug)
    const s = score(lineTimes, truth)
    const modeTag = song.mixed ? ` (ja=${mode})` : ''
    const label = `${song.name} sel/${policy}/pad${pad}${modeTag}`
    rows.push({ name: label, ...s, anchors: anchorIdx.length })
    console.log(`${song.name}: ${label} scored=${s.scored} rawMean=${s.raw.mean.toFixed(2)} normMean=${s.norm.mean.toFixed(2)} anchors=${anchorIdx.length}`)
  }

  if (SELECTIVE && !SWEEP) {
    runSelectiveConfig(jaModeArg, anchorsArg, padArg)
  }

  if (SWEEP) {
    const pads = [0.5, 1, 2]
    // sel/none: empty anchorIdx -> one guarded monolithic window [0,duration]
    // (buildSelectiveWindows). Pad is irrelevant here (t0/t1 clamp to song
    // edges regardless), so run it once per ja-mode rather than per pad.
    if (song.mixed) {
      for (const mode of ['word', 'segment']) {
        if (!baselines[mode]) continue
        runSelectiveConfig(mode, 'none', 1)
      }
    } else {
      runSelectiveConfig(jaModeArg, 'none', 1)
    }
    if (song.mixed) {
      for (const mode of ['word', 'segment']) {
        if (!baselines[mode]) continue
        for (const policy of ['consensus', 'both']) {
          for (const pad of pads) runSelectiveConfig(mode, policy, pad)
        }
      }
    } else {
      for (const pad of pads) runSelectiveConfig(jaModeArg, 'good', pad)
    }
  }
}

console.log('\n=== HYBRID SCORECARD ===')
console.log('config                                scored  anch | raw:  mean   p50   p90  >1s >1.5 | norm:  mean   p50   p90  >1s >1.5 | off')
for (const r of rows) {
  const f = (x) => x.toFixed(2).padStart(5)
  console.log(
    `${r.name.padEnd(37)} ${String(r.scored).padStart(5)} ${String(r.anchors ?? '').padStart(5)} |     ${f(r.raw.mean)} ${f(r.raw.p50)} ${f(r.raw.p90)} ${String(r.raw.over1).padStart(4)} ${String(r.raw.over15).padStart(4)} |      ${f(r.norm.mean)} ${f(r.norm.p50)} ${f(r.norm.p90)} ${String(r.norm.over1).padStart(4)} ${String(r.norm.over15).padStart(4)} | ${r.offset.toFixed(2)}`,
  )
}
