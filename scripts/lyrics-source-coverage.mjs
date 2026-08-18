#!/usr/bin/env node
/**
 * LRCLIB coverage + candidate-spread instrument.
 *
 * Answers the two questions that decide whether Phase 2 (retiming imported
 * timings) is worth building:
 *
 *   1. How often does a song have a SYNCED entry at all? Songs with none can
 *      never be timed from sourcing, no matter how good the matching gets —
 *      they are the population a retiming fallback would serve.
 *   2. How often do candidates differ enough in DURATION for that signal to
 *      change the pick? If every song has one candidate, the duration fix is
 *      correct but inert.
 *
 * Deliberately hits the real LRCLIB API and reports what is actually there.
 * Network-only, run by hand — never part of the test suite.
 *
 *   node scripts/lyrics-source-coverage.mjs
 */

const CORPUS = [
  { title: '幸せにさよなら', artist: '山下達郎', note: 'the reported case (vocal version)' },
  { title: 'RIDE ON TIME', artist: '山下達郎', note: 'popular, many reissues' },
  { title: 'クリスマス・イブ', artist: '山下達郎', note: 'heavily re-released' },
  { title: 'Rockn Roll Morning Lights Falls On You', artist: 'ASIAN KUNG-FU GENERATION', note: 'known-good baseline' },
  { title: '夜に駆ける', artist: 'YOASOBI', note: 'plain popular track' },
  { title: 'Lemon', artist: '米津玄師', note: 'plain popular track' },
  { title: 'Pretender', artist: 'Official髭男dism', note: 'plain popular track' },
  { title: 'マリーゴールド', artist: 'あいみょん', note: 'plain popular track' },
  { title: '白日', artist: 'King Gnu', note: 'plain popular track' },
  { title: 'ただ君に晴れ', artist: 'ヨルシカ', note: 'plain popular track' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function search(title, artist) {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'utasync-coverage-probe' } })
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return { results: await res.json() }
}

const fmt = (s) => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

const rows = []
for (const song of CORPUS) {
  const { results, error } = await search(song.title, song.artist)
  if (error) {
    rows.push({ ...song, error })
    continue
  }
  const synced = results.filter((r) => r.syncedLyrics)
  const durations = synced.map((r) => r.duration).filter((d) => d != null)
  const spread = durations.length > 1 ? Math.max(...durations) - Math.min(...durations) : 0

  rows.push({
    ...song,
    total: results.length,
    synced: synced.length,
    spread,
    // A spread beyond the matcher's ±2s tolerance means duration can actually
    // decide between candidates. Below it, every candidate looks the same.
    durationDecisive: spread > 2,
    sample: synced.slice(0, 3).map((r) => `${fmt(r.duration)} ${r.artistName} - ${r.trackName}`),
  })
  await sleep(400) // be polite to a free community API
}

console.log('\n=== LRCLIB coverage ===\n')
for (const r of rows) {
  if (r.error) {
    console.log(`${r.artist} - ${r.title}\n   ERROR ${r.error}\n`)
    continue
  }
  console.log(`${r.artist} - ${r.title}   (${r.note})`)
  console.log(`   results=${r.total}  synced=${r.synced}  durationSpread=${r.spread.toFixed(1)}s  durationDecisive=${r.durationDecisive}`)
  for (const s of r.sample) console.log(`     ${s}`)
  console.log('')
}

const ok = rows.filter((r) => !r.error)
const noSynced = ok.filter((r) => r.synced === 0)
const decisive = ok.filter((r) => r.durationDecisive)

console.log('=== decision numbers ===')
console.log(`corpus size                        : ${ok.length}`)
console.log(`songs with NO synced entry         : ${noSynced.length}  <- population a Phase 2 retiming fallback would serve`)
console.log(`  ${noSynced.map((r) => r.title).join(', ') || '(none)'}`)
console.log(`songs where duration is decisive   : ${decisive.length}  <- where the Phase 1 duration fix can change the pick`)
console.log(`  ${decisive.map((r) => r.title).join(', ') || '(none)'}`)
