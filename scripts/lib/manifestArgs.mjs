// Multi-manifest handling shared by experiments/phase0/score.mjs and scripts/sync-benchmark.mjs.
// --manifest may be repeated, and each may be a comma-separated list, so one invocation can cover
// both certifying kinds: the real-song corpus (benchmarks/sync) and the PJS medleys, whose builder
// writes its own manifest to .cache/pjs/.
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export const DEFAULT_MANIFEST = 'benchmarks/sync/manifest.json'

export function manifestPathsFrom(argv) {
  const paths = argv.flatMap((a, i) => (a === '--manifest' ? (argv[i + 1] ?? '').split(',').filter(Boolean) : []))
  return paths.length ? paths : [DEFAULT_MANIFEST]
}

// argv with every `--manifest <value>` pair removed, so positional parsing is unaffected by it.
export function withoutManifestFlags(argv) {
  return argv.filter((a, i) => a !== '--manifest' && argv[i - 1] !== '--manifest')
}

// The report is a shareable artefact: it names repo-relative paths only, never a local one.
export function shownPath(root, p) {
  const abs = resolve(root, p)
  return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : `${basename(abs)} (outside the repository)`
}

// One id must mean one song, or a song scored twice would count twice toward the gate. The first
// manifest listing an id wins; later duplicates are reported in `warnings`, never silently dropped.
// `target` (the accuracy target scoreRun judges against) comes from the first manifest that has
// one: the PJS builder's manifest has none, and a medley is judged by the same target as the songs.
export function loadManifests(root, paths) {
  const warnings = []
  let target
  const songs = []
  for (const p of paths) {
    const m = JSON.parse(readFileSync(resolve(root, p), 'utf8'))
    target ??= m.target
    for (const song of m.songs ?? []) {
      if (songs.some((s) => s.id === song.id)) warnings.push(`${song.id}: duplicate song id in ${shownPath(root, p)}; the first manifest listing it wins`)
      else songs.push(song)
    }
  }
  return { target, songs, warnings }
}
