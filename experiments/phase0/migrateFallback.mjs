#!/usr/bin/env node
/**
 * One-off: applies the pinned→prior fallback (knownTextAlign.mjs, 2026-11-04) to runs made
 * before it existed. Pure post-processing of stored values — identical to re-running, because
 * alignment is deterministic and the fallback only replaces pinned starts with the stored prior.
 * Idempotent. Skips filler runs (rejected variant, kept as recorded).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../.cache/phase0/runs')
let changed = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.includes('filler'))) {
  const p = resolve(dir, f)
  const run = JSON.parse(readFileSync(p, 'utf8'))
  if (run.lines.every((l) => 'alignedStart' in l)) continue
  for (const l of run.lines) {
    const pinned = l.startTime - l.window[0] < 0.1
    l.alignedStart = l.startTime
    l.pinned = pinned
    l.fallback = pinned ? 'prior' : null
    if (pinned) { l.startTime = l.prior; l.shift = 0 }
  }
  for (let i = 0; i < run.lines.length; i++) {
    run.lines[i].endTime = i + 1 < run.lines.length ? run.lines[i + 1].startTime : run.audioSeconds
  }
  run.migratedFallback = new Date().toISOString()
  writeFileSync(p, JSON.stringify(run, null, 2) + '\n')
  changed++
}
console.log(`migrated ${changed} run(s)`)
