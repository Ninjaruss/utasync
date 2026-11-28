// Does rung 2 ask LRCLIB the wrong way? See README.md for the gate, written first.
//
// Takes a folder of audio files. Reads each file's duration with ffprobe, strips the
// L67 download tail from its name, and asks /api/search four ways. A probe is a hit
// only when some returned record's duration is within TOLERANCE_S of the file's own.
//
// Prints shapes and counts. Never prints lyric text (rule 6), and never writes the
// corpus into the repository: the names live only in the folder you pass.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/** Wide enough for a true match (veil: 218.0 vs 218.8), narrow enough to exclude a
 *  studio cut standing in for a live recording (1:55 out). Stated in the README
 *  before the run; it is the gate's own constant, not a tuned one. */
const TOLERANCE_S = 3
const AUDIO = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav'])
/** Below this, a file is a clip, not a song — an A-B loop excerpt saved for practice,
 *  say. Nobody looks such a thing up by name, and counting one would quietly make the
 *  corpus look worse than it is. Reported, not silently dropped. */
const MIN_SONG_S = 60
const UA = 'utasync-lookup-probe/1.0'

const EXT = /\.[A-Za-z0-9]{1,5}$/
const LAST = /^(.*[^-_ ])[-_ ]+([^-_ ]+)$/
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/
const RATE = /^\d{2,4}k?(bps)?$/i

/** The shipped L67 rule, repeated here so the probe sees exactly what the app sees. */
function dropDownloaderTail(name) {
  const host = LAST.exec(name)
  if (!host) return name
  const [, beforeHost, hostToken] = host
  if (!HOST.test(hostToken)) return name
  const rate = LAST.exec(beforeHost)
  const hasRate = rate !== null && RATE.test(rate[2])
  let stripped
  if (hasRate) stripped = rate[1]
  else if ((hostToken.match(/\./g) || []).length >= 2) stripped = beforeHost
  else return name
  if (!stripped.trim() || RATE.test(stripped)) return name
  return stripped
}

function durationSec(path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ], { encoding: 'utf8' })
  return Number.parseFloat(out.trim())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function search(params) {
  const url = `https://lrclib.net/api/search?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  await sleep(400)
  if (!res.ok) return null
  const body = await res.json()
  return Array.isArray(body) ? body : null
}

/** 1-based rank of the first record whose length matches the file, or 0 for none. */
function hitRank(records, fileSec) {
  if (!records) return 0
  const i = records.findIndex(
    (r) => typeof r.duration === 'number' && Math.abs(r.duration - fileSec) <= TOLERANCE_S,
  )
  return i + 1
}

const folder = process.argv[2]
if (!folder) {
  console.error('usage: node probe.mjs <folder-of-audio-files> [names.json]')
  process.exit(2)
}
// Optional sidecar: { "<filename>": { "title": "…", "artist": "…" } }, the names a
// user would type after a rename. Kept outside the repository on purpose.
const namesPath = process.argv[3]
const typed = namesPath && existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, 'utf8')) : {}

const files = readdirSync(folder).filter((f) => AUDIO.has(extname(f).toLowerCase())).sort()
const rows = []
const skipped = []
for (const file of files) {
  const secs = durationSec(join(folder, file))
  if (secs < MIN_SONG_S) {
    skipped.push({ file, secs })
    continue
  }
  const name = dropDownloaderTail(file.replace(EXT, ''))
  const t = typed[file]

  const row = { file, secs, name, hasTyped: !!(t && t.title) }
  row.filenameTrack = hitRank(await search({ track_name: name }), secs)
  row.filenameQ = hitRank(await search({ q: name }), secs)

  if (t && t.title && t.artist) {
    row.typedTrack = hitRank(await search({ track_name: t.title, artist_name: t.artist }), secs)
    row.typedQ = hitRank(await search({ q: `${t.artist} ${t.title}` }), secs)
  } else if (t && t.title) {
    row.typedTrack = hitRank(await search({ track_name: t.title }), secs)
    row.typedQ = hitRank(await search({ q: t.title }), secs)
  }
  rows.push(row)
}

const n = rows.length
const col = (k) => rows.filter((r) => r[k] > 0).length
const withTyped = rows.filter((r) => r.typedTrack !== undefined)

for (const s of skipped) {
  console.log(`  skipped ${s.secs.toFixed(0)}s clip (under ${MIN_SONG_S}s, not a song)`)
}
console.log(`corpus: ${n} files, tolerance +-${TOLERANCE_S}s, hit = a record whose length matches the file\n`)
console.log('  rank of first matching record (0 = none), by how the question is asked')
console.log('  filename:            track_name   q        typed name: track_name   q')
for (const r of rows) {
  const typedCols = r.typedTrack === undefined
    ? '    (no typed name)'
    : `${String(r.typedTrack).padStart(14)}${String(r.typedQ).padStart(10)}`
  console.log(
    `  ${String(r.secs.toFixed(0) + 's').padStart(6)}` +
    `${String(r.filenameTrack).padStart(12)}${String(r.filenameQ).padStart(8)}  ${typedCols}`,
  )
}
console.log(`\n  files with a matching record found:`)
console.log(`    from the filename:  track_name ${col('filenameTrack')}/${n}   q ${col('filenameQ')}/${n}`)
console.log(`    from a typed name:  track_name ${col('typedTrack')}/${withTyped.length}   q ${col('typedQ')}/${withTyped.length}`)

const lost = rows.filter((r) => (r.filenameTrack > 0 && r.filenameQ === 0)
  || (r.typedTrack > 0 && r.typedQ === 0))
const gainedFilename = col('filenameQ') > col('filenameTrack')
const gainedTyped = col('typedQ') > col('typedTrack')
console.log(`\n  gate 1 (q finds strictly more, in some regime): ${gainedFilename || gainedTyped ? 'PASS' : 'FAIL'}`)
console.log(`  gate 2 (q loses nothing track_name found):      ${lost.length === 0 ? 'PASS' : `FAIL (${lost.length})`}`)
console.log(`\n  VERDICT: ${(gainedFilename || gainedTyped) && lost.length === 0 ? 'switch rung 2 to q' : 'keep rung 2 as it is'}`)
