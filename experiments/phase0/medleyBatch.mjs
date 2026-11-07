#!/usr/bin/env node
/**
 * Plumbing for runAll.sh's PJS section; prints nothing but paths and ids, never lyric text.
 *
 *   medleyBatch.mjs ids    <manifest>...            one "<id>\t<manifest>" line per medley, first manifest wins
 *   medleyBatch.mjs latest <runsDir> <songId>       path of that song's newest completed arm A run, or nothing
 *
 * A run is matched by the `song` field it records, never by filename prefix: `pjs-medley-01` is
 * a prefix of `pjs-medley-01-bed`, and taking the wrong medley's run as a prior would score a
 * song against another song's audio.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifests } from '../../scripts/lib/manifestArgs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function medleyIds(manifestPaths, rootDir = root) {
  const present = manifestPaths.filter((p) => existsSync(resolve(rootDir, p)))
  const ids = []
  for (const p of present) {
    for (const s of loadManifests(rootDir, [p]).songs) if (!ids.some((x) => x.id === s.id)) ids.push({ id: s.id, manifest: p })
  }
  return ids
}

export function latestCompletedRun(runsDir, songId) {
  if (!existsSync(runsDir)) return null
  let best = null
  for (const f of readdirSync(runsDir).filter((n) => n.endsWith('.json'))) {
    let r
    try { r = JSON.parse(readFileSync(resolve(runsDir, f), 'utf8')) } catch { continue }
    if (r?.song !== songId || r.status !== 'completed' || typeof r.startedAt !== 'string') continue
    if (!best || r.startedAt > best.startedAt) best = { startedAt: r.startedAt, path: resolve(runsDir, f) }
  }
  return best?.path ?? null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'ids') for (const { id, manifest } of medleyIds(rest)) console.log(`${id}\t${manifest}`)
  else if (cmd === 'latest') { const p = latestCompletedRun(resolve(root, rest[0]), rest[1]); if (p) console.log(p) }
  else { console.error('Usage: medleyBatch.mjs ids <manifest>... | latest <runsDir> <songId>'); process.exit(2) }
}
