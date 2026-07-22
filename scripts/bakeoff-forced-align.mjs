// scripts/bakeoff-forced-align.mjs — forced-alignment bake-off vs LRC truth.
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIX = join(root, 'tests/ai-pipeline/fixtures')
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { forceAlignLines } = await import(pathToFileURL(join(root, 'src/ai-pipeline/forcedAlign/forcedAligner.ts')).href)
const { parseLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

// The app's toRomaji (kuroshiro) is browser-configured; build a Node-working
// romanizer here (ESM .default interop + the real kuromoji dict path). Falls
// back to '' so a romanizer failure skips JA lines instead of crashing.
let romajiFn = null
async function buildRomanizer() {
  try {
    const KuroshiroNS = (await import('kuroshiro')).default
    const K = KuroshiroNS.default ?? KuroshiroNS
    const AnalyzerNS = (await import('kuroshiro-analyzer-kuromoji')).default
    const Analyzer = AnalyzerNS.default ?? AnalyzerNS
    const k = new K()
    await k.init(new Analyzer({ dictPath: join(root, 'node_modules/kuromoji/dict') }))
    romajiFn = async (t) => k.convert(t, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
    console.log('romanizer: kuroshiro (Node) OK')
  } catch (e) {
    console.log(`romanizer: UNAVAILABLE (${String(e).slice(0, 80)}) — JA lines will be skipped`)
    romajiFn = async () => ''
  }
}
const romanize = async (t) => { try { return await romajiFn(t) } catch { return '' } }

const JA = /[぀-ヿ㐀-鿿]/
const med = (xs) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0
const p90 = (xs) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 0

const SONGS = [
  { name: 'stranger', mp3: join(root, 'public/e2e/stranger.mp3'), truth: join(FIX, 'lrc-truth/stranger-than-heaven.json'), baseline: 'app-path p50 0.56' },
  { name: 'veil', mp3: join(root, 'public/e2e/veil.mp3'), truth: join(FIX, 'lrc-truth/veil.json'), baseline: 'p50 0.24' },
  { name: 'recollect', mp3: join(root, 'public/e2e/recollect.mp3'), truth: join(FIX, 'lrc-truth/recollect.json'), baseline: 'p50 1.89' },
]

await buildRomanizer()
for (const s of SONGS) {
  if (!existsSync(s.mp3)) { console.log(`\n${s.name}: no audio — skipped`); continue }
  const lrc = parseLrc(JSON.parse(readFileSync(s.truth, 'utf8')).syncedLyrics)
  const lines = lrc.map((r) => ({ text: r.text, lang: JA.test(r.text) ? 'ja' : 'en' }))
  const truth = lrc.map((r) => r.time)
  const { data, sampleRate } = await decodeMp3ToMono(s.mp3)
  const ratio = sampleRate / 16000, n = Math.floor(data.length / ratio)
  const a16 = new Float32Array(n)
  for (let i = 0; i < n; i++) a16[i] = data[Math.floor(i * ratio)]
  const t0 = performance.now()
  const { lineTimings } = await forceAlignLines(a16, 16000, lines, { romanize })
  const ms = Math.round(performance.now() - t0)

  const rows = lineTimings.map((lt, i) => ({ lang: lines[i].lang, start: lt.start, score: lt.score, truth: truth[i] }))
  const placed = rows.filter((r) => r.score > 0 && Number.isFinite(r.truth))
  const offset = med(placed.map((r) => r.start - r.truth))
  const errOf = (r) => Math.abs(r.start - (r.truth + offset))
  console.log(`\n${s.name}  (${ms}ms, offset=${offset.toFixed(2)}s)  [baseline ${s.baseline}]`)
  const report = (label, subset) => {
    if (!subset.length) { console.log(`  ${label}: none placed`); return }
    const e = subset.map(errOf)
    console.log(`  ${label.padEnd(11)}: n=${String(subset.length).padStart(2)} p50=${med(e).toFixed(2)}s p90=${p90(e).toFixed(2)}s over1s=${e.filter((x) => x > 1).length} over3s=${e.filter((x) => x > 3).length}`)
  }
  report('EN lines', placed.filter((r) => r.lang === 'en'))
  report('JA lines', placed.filter((r) => r.lang === 'ja'))
  report('ALL placed', placed)
  console.log(`  skipped (score 0): ${rows.length - placed.length}/${rows.length}`)
}
