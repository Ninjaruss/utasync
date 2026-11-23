#!/usr/bin/env node
/**
 * Pins the Kotlin audit's dictionary reader against the script that builds the shipped table.
 *
 * The audit must score sense selection over REAL dictionary rows, or `right` measures whoever
 * typed the fake. But a JVM unit test cannot open the 37 MB Room seed without a driver
 * (CLAUDE.md rule 5), so the Kotlin side reads `public/jmdict-popover.json` and applies the same
 * conversion rules as `scripts/build-japanese-db.mjs`. That is a duplicated rule, and a duplicated
 * rule with nothing comparing the two is how the audit's claim to measure real data stops being
 * true without anything failing: change a drop rule in the script and the shipped table moves
 * while `right` does not.
 *
 * A fixture of rows cannot replace the Kotlin reader, because the analyzer also looks words up by
 * their dictionary form (行く for 行っ) and only the tokenizer knows those keys. So instead both
 * sides serialise the rows for the corpus's own surfaces into one canonical form and hash it. The
 * conversion rules are global, so a rule that changed would change these rows too.
 *
 * Writes a digest, not glosses, so nothing of the dictionary is duplicated into the repo.
 *
 * Usage: node scripts/build-audit-digest.mjs [--check]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertDictionary } from './build-japanese-db.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const POPOVER = resolve(root, 'public/jmdict-popover.json')
export const CORPUS = resolve(root, 'android/japanese/src/test/resources/reading-corpus.json')
export const DIGEST = resolve(root, 'android/japanese/src/test/resources/audit-dictionary-digest.json')

/** Field and gloss separators chosen to be absent from every gloss. Kotlin uses the same two. */
const FIELD = '\u0001'
const GLOSS = '\u0002'

/** Every surface the corpus names. */
export function corpusSurfaces(corpus) {
  const out = new Set()
  for (const entry of corpus.entries) for (const w of entry.words) if (w.surface) out.add(w.surface)
  return out
}

/**
 * One canonical line per row, sorted. Both sides must produce this byte for byte, so every
 * choice here is a contract: a null part of speech is the empty string, glosses keep their order
 * within a row, and the lines are sorted so neither side's row order can matter.
 */
export function canonicalLines(rows, surfaces) {
  return rows
    .filter((r) => surfaces.has(r.surface))
    .map((r) => [r.surface, r.reading, r.posLabel ?? '', r.glosses.join(GLOSS), r.senseIndex].join(FIELD))
    .sort()
}

export function digestOf(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

export function generate() {
  const entries = JSON.parse(readFileSync(POPOVER, 'utf8')).entries
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'))
  const surfaces = corpusSurfaces(corpus)
  const { rows } = convertDictionary(entries)
  const lines = canonicalLines(rows, surfaces)
  const body = {
    v: 1,
    generatedBy: 'scripts/build-audit-digest.mjs',
    note:
      'Both scripts/build-japanese-db.mjs and the Kotlin CorpusDictionary must produce these ' +
      'rows for the corpus surfaces. If this fails, the two conversions have diverged: fix the ' +
      'divergence, do not regenerate to make it pass.',
    surfaces: surfaces.size,
    surfacesFound: new Set(lines.map((l) => l.split(FIELD)[0])).size,
    rows: lines.length,
    sha256: digestOf(lines),
  }
  return JSON.stringify(body, null, 1) + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = generate()
  if (process.argv.includes('--check')) {
    if (readFileSync(DIGEST, 'utf8') !== text) {
      console.error('audit-dictionary-digest.json is stale; rerun: node scripts/build-audit-digest.mjs')
      process.exit(1)
    }
    console.log('audit-dictionary-digest.json is current')
  } else {
    writeFileSync(DIGEST, text)
    console.log(`wrote ${DIGEST}\n${text}`)
  }
}
