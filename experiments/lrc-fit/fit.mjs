// Can a record for the wrong cut be fitted to the user's audio? See README.md for the
// arms and the gate, both written before this file existed.
//
// Prints counts, times and line INDICES only — never lyric text (rule 6). Records are
// cached under .cache/lrc-fit/ because they do contain it.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'

const TOLERANCE_REF_S = 3 // a record this close to the file is the reference
const MIN_DIFF_S = 5 // a record this far from the reference is a different cut
const MIN_SONG_S = 60
/** A record whose declared length and whose own last line disagree by more than this is
 *  internally incoherent — LRCLIB holds records claiming 8 s whose lyrics run to 200 s.
 *  Such a record is not "a different cut", it is bad metadata, and counting it would have
 *  filled the corpus with pairs whose timings are in fact identical. Found on the first
 *  run; the gate is untouched. */
const MAX_METADATA_SLACK_S = 30
const AUDIO = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav'])
const CACHE = '.cache/lrc-fit'
const UA = 'utasync-lrcfit-probe/1.0'
const EXT = /\.[A-Za-z0-9]{1,5}$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function search(params) {
  mkdirSync(CACHE, { recursive: true })
  const key = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16)
  const path = join(CACHE, `${key}.json`)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const url = `https://lrclib.net/api/search?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  await sleep(400)
  const body = res.ok ? await res.json() : []
  const records = Array.isArray(body) ? body : []
  writeFileSync(path, JSON.stringify(records))
  return records
}

function durationSec(path) {
  return Number.parseFloat(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ], { encoding: 'utf8' }).trim())
}

/** [mm:ss.xx] lines -> {t, text}. Blank lines are dropped: they time nothing. */
function parseLrc(synced) {
  const out = []
  for (const line of (synced ?? '').split('\n')) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(line.trim())
    if (!m) continue
    const text = m[3].trim()
    if (!text) continue
    out.push({ t: Number(m[1]) * 60 + Number(m[2]), text })
  }
  return out.sort((a, b) => a.t - b.t)
}

const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

/** Pairs of (reference time, input time) for lines whose text is unambiguous in both. */
function matchLines(ref, input) {
  const count = (rows) => {
    const m = new Map()
    for (const r of rows) m.set(norm(r.text), (m.get(norm(r.text)) ?? 0) + 1)
    return m
  }
  const refCount = count(ref)
  const inCount = count(input)
  const inByText = new Map(input.map((r) => [norm(r.text), r.t]))
  const pairs = []
  for (const r of ref) {
    const k = norm(r.text)
    // Repeated text cannot be matched without guessing which occurrence is which.
    if (!k || refCount.get(k) !== 1 || inCount.get(k) !== 1) continue
    pairs.push({ ref: r.t, in: inByText.get(k) })
  }
  return pairs.sort((a, b) => a.ref - b.ref)
}

/** The four arms, each returning {scale, offset}. A2 and A3 are given the reference
 *  times of the lines the user would have tapped — a tap is assumed accurate, which
 *  flatters them, and that is stated in the report. */
function arms(pairs, audioSec, inputSec) {
  const ratio = inputSec > 0 ? audioSec / inputSec : 1
  const first = pairs[0]
  const last = pairs[pairs.length - 1]
  const span = last.in - first.in
  return {
    A0: { scale: 1, offset: 0 },
    A1: { scale: ratio, offset: 0 },
    A2: { scale: ratio, offset: first.ref - ratio * first.in },
    A3: span > 0
      ? (() => {
          const scale = (last.ref - first.ref) / span
          return { scale, offset: first.ref - scale * first.in }
        })()
      : { scale: ratio, offset: first.ref - ratio * first.in },
  }
}

const ARM_NAMES = ['A0', 'A1', 'A2', 'A3']

function score(pairs, fit) {
  const errs = pairs.map((p) => Math.abs(fit.scale * p.in + fit.offset - p.ref))
  const within = (s) => (errs.filter((e) => e <= s).length / errs.length) * 100
  return { n: errs.length, p1: within(1), p05: within(0.5), worst: Math.max(...errs) }
}

const folder = process.argv[2]
if (!folder) {
  console.error('usage: node fit.mjs <folder-of-audio-files> [names.json]')
  process.exit(2)
}
const namesPath = process.argv[3]
const typed = namesPath && existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, 'utf8')) : {}

const songs = []
for (const file of readdirSync(folder).filter((f) => AUDIO.has(extname(f).toLowerCase())).sort()) {
  const audioSec = durationSec(join(folder, file))
  if (audioSec < MIN_SONG_S) continue
  const t = typed[file]
  if (!t?.title) continue
  const records = await search(t.artist ? { track_name: t.title, artist_name: t.artist } : { track_name: t.title })
  const coherent = (r) => {
    const lines = parseLrc(r.syncedLyrics)
    if (!lines.length) return false
    return Math.abs(lines[lines.length - 1].t - r.duration) <= MAX_METADATA_SLACK_S
  }
  const all = records.filter((r) => r.syncedLyrics && typeof r.duration === 'number')
  const synced = all.filter(coherent)
  const dropped = all.length - synced.length
  const reference = synced.find((r) => Math.abs(r.duration - audioSec) <= TOLERANCE_REF_S)
  if (!reference) { songs.push({ file, audioSec, pairs: [], skip: 'no reference record' }); continue }
  const refLines = parseLrc(reference.syncedLyrics)
  const cases = []
  for (const input of synced) {
    if (Math.abs(input.duration - reference.duration) <= MIN_DIFF_S) continue
    const pairs = matchLines(refLines, parseLrc(input.syncedLyrics))
    if (pairs.length < 5) continue
    cases.push({ inputSec: input.duration, pairs })
  }
  songs.push({ file, audioSec, refSec: reference.duration, cases, dropped })
}

console.log(`reference = a record within +-${TOLERANCE_REF_S}s of the file; input = a record >${MIN_DIFF_S}s from it`)
console.log(`taps in A2/A3 are assumed perfectly placed, which flatters them\n`)

let pairCount = 0
const songPass = []
const harm = { A1: false, A2: false, A3: false }
const improves = { A1: false, A2: false, A3: false }

for (const s of songs) {
  if (s.skip) { console.log(`  — ${s.audioSec.toFixed(0)}s song: ${s.skip}`); continue }
  if (!s.cases.length) { console.log(`  — ${s.audioSec.toFixed(0)}s song: no differing-cut record with enough matched lines (${s.dropped ?? 0} incoherent dropped)`); continue }
  console.log(`  ${s.audioSec.toFixed(0)}s song, reference ${s.refSec.toFixed(0)}s (${s.dropped} incoherent records dropped)`)
  const best = {}
  for (const c of s.cases) {
    pairCount++
    const fits = arms(c.pairs, s.audioSec, c.inputSec)
    const row = ARM_NAMES.map((a) => ({ a, ...score(c.pairs, fits[a]) }))
    const a0 = row[0]
    console.log(`    vs ${c.inputSec.toFixed(0)}s record, ${c.pairs.length} matched lines`)
    for (const r of row) {
      console.log(`      ${r.a}  within 1.0s ${r.p1.toFixed(0).padStart(3)}%   within 0.5s ${r.p05.toFixed(0).padStart(3)}%   worst ${r.worst.toFixed(1)}s`)
      if (r.a !== 'A0') {
        if (r.p1 < a0.p1) harm[r.a] = true
        if (r.p1 > a0.p1) improves[r.a] = true
        best[r.a] = Math.min(best[r.a] ?? 100, r.p1)
      }
    }
  }
  songPass.push({ file: s.file, best })
}

console.log(`\n  ${songPass.length} songs contributed, ${pairCount} pairs\n`)
const usable = {}
for (const a of ['A1', 'A2', 'A3']) {
  const n = songPass.filter((s) => (s.best[a] ?? 0) >= 85).length
  usable[a] = n
  console.log(`  ${a}: >=85% of lines within 1.0s on every pair of ${n}/${songPass.length} songs` +
    `   no-harm ${harm[a] ? 'VIOLATED' : 'ok'}   improves somewhere ${improves[a] ? 'yes' : 'no'}`)
}
const winners = ['A1', 'A2', 'A3'].filter((a) => usable[a] >= 4 && !harm[a] && improves[a])
console.log(`\n  gate 1 (usable on >=4 of 5 songs): ${Object.values(usable).some((n) => n >= 4) ? 'PASS' : 'FAIL'}`)
console.log(`  gate 2 (no harm, and helps somewhere): ${winners.length ? 'PASS' : 'FAIL'}`)
console.log(`\n  VERDICT: ${winners.length ? `build the fit, arm ${winners[0]}` : 'do not build the fit'}`)
