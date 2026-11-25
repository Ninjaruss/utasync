/**
 * Converts the PWA's audited JMdict data into what the Android app ships:
 *
 *   public/jmdict-popover.json  ->  android/data/src/main/assets/utasync-seed.db
 *       the whole Room database (every table, empty but for `dictionary`), loaded with
 *       Room's `createFromAsset`. The table definitions are NOT written here: they are read from
 *       the schema Room exports to android/data/schemas, so the file cannot drift from the
 *       entities. Change an entity, build :data (KSP re-exports the schema), then rerun this.
 *   public/jmdict-readings.json ->  android/japanese/src/main/assets/reading-alternates.json
 *       { surface: [[common readings], [uncommon readings]] }, only for surfaces read more than one
 *       way. The union of the two lists is "every reading this surface takes".
 *
 * The input is the committed PWA data, never raw JMdict: it is the shape the PWA's audit rounds
 * corrected, and CLAUDE.md rule 5 forbids a build-time download. Provenance: vendor/jmdict/README.md.
 *
 * Nothing is dropped silently. Every drop is counted by reason and printed.
 *
 * Usage: node scripts/build-japanese-db.mjs      (needs Node >= 22.5 for node:sqlite; no dependency)
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Must match GlossConverter.SEPARATOR in android/data (U+001F, the ASCII unit separator). */
export const GLOSS_SEPARATOR = '\u001F'

const MAX_EXAMPLES = 5

function newDropped() {
  return { total: 0, byReason: {}, examples: [] }
}

function drop(dropped, reason, example) {
  dropped.total++
  dropped.byReason[reason] = (dropped.byReason[reason] ?? 0) + 1
  if (dropped.examples.length < MAX_EXAMPLES) dropped.examples.push(`${reason}: ${example}`)
}

/**
 * entries: { surface: [{ r: reading, pos?: label, g: "gloss; gloss" }] } (the popover file).
 * senseIndex is the position among the surface's *kept* groups, so it is consecutive from 0 and
 * `(surface, senseIndex)` is a key.
 */
export function convertDictionary(entries) {
  const rows = []
  const dropped = newDropped()
  for (const [surface, list] of Object.entries(entries)) {
    let senseIndex = 0
    for (const e of list) {
      if (!surface.trim()) {
        drop(dropped, 'blank-surface', JSON.stringify(surface))
        continue
      }
      const reading = typeof e.r === 'string' ? e.r.trim() : ''
      if (!reading) {
        drop(dropped, 'no-reading', surface)
        continue
      }
      const raw = typeof e.g === 'string' ? e.g : ''
      if (raw.includes(GLOSS_SEPARATOR)) {
        drop(dropped, 'separator-in-gloss', surface)
        continue
      }
      const glosses = raw.split(';').map((g) => g.trim()).filter(Boolean)
      if (glosses.length === 0) {
        drop(dropped, 'no-gloss', `${surface} (${reading})`)
        continue
      }
      rows.push({ surface, reading, posLabel: e.pos ? e.pos : null, glosses, senseIndex: senseIndex++ })
    }
  }
  return { rows, dropped }
}

/**
 * readings: { surface: "common1,common2|uncommon1,uncommon2" } where either side may be empty and
 * the pipe may be absent (all common). A surface with fewer than two distinct readings has nothing
 * to be ambiguous about, so it is left out — and that is also what keeps the file small, and what
 * stops an inflected word's single dictionary-form reading from being shown as a rival to the
 * inflected reading the tokenizer gave it.
 */
export function convertAlternates(readings) {
  const alternates = {}
  const dropped = newDropped()
  const split = (s) => s.split(',').map((r) => r.trim()).filter(Boolean)
  for (const [surface, packed] of Object.entries(readings)) {
    const bar = packed.indexOf('|')
    const common = split(bar < 0 ? packed : packed.slice(0, bar))
    const uncommon = split(bar < 0 ? '' : packed.slice(bar + 1)).filter((r) => !common.includes(r))
    if (new Set([...common, ...uncommon]).size < 2) {
      drop(dropped, 'single-reading', surface)
      continue
    }
    alternates[surface] = [common, uncommon]
  }
  return { alternates, dropped }
}

function createSeed(dbOut, schemaPath, rows) {
  const { database } = JSON.parse(readFileSync(schemaPath, 'utf8'))
  mkdirSync(dirname(dbOut), { recursive: true })
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbOut + suffix, { force: true })
  const db = new DatabaseSync(dbOut)
  try {
    for (const entity of database.entities) {
      const sub = (sql) => sql.replaceAll('${TABLE_NAME}', entity.tableName)
      db.exec(sub(entity.createSql))
      for (const index of entity.indices ?? []) db.exec(sub(index.createSql))
    }
    // Room's own bookkeeping, verbatim from the exported schema: the identity hash it checks.
    for (const q of database.setupQueries) db.exec(q)
    db.exec(`PRAGMA user_version = ${Number(database.version)}`)
    const insert = db.prepare(
      'INSERT INTO dictionary (surface, reading, posLabel, glosses, senseIndex) VALUES (?, ?, ?, ?, ?)',
    )
    db.exec('BEGIN')
    for (const r of rows) {
      insert.run(r.surface, r.reading, r.posLabel, r.glosses.join(GLOSS_SEPARATOR), r.senseIndex)
    }
    db.exec('COMMIT')
    db.exec('VACUUM')
  } finally {
    db.close()
  }
}

function describeDrops(label, inCount, written, dropped) {
  const reasons = Object.entries(dropped.byReason).map(([k, v]) => `${k}: ${v}`).join(', ')
  return [
    `${label}: ${inCount} in, ${written} written, dropped ${dropped.total}${reasons ? ` (${reasons})` : ''}`,
    ...dropped.examples.map((e) => `  e.g. ${e}`),
  ]
}

export function buildJapaneseDb({ popoverPath, readingsPath, schemaPath, dbOut, alternatesOut, log = console.log }) {
  const entries = JSON.parse(readFileSync(popoverPath, 'utf8')).entries
  const readings = JSON.parse(readFileSync(readingsPath, 'utf8')).readings

  const dict = convertDictionary(entries)
  const entriesIn = Object.values(entries).reduce((n, list) => n + list.length, 0)
  createSeed(dbOut, schemaPath, dict.rows)

  const alt = convertAlternates(readings)
  mkdirSync(dirname(alternatesOut), { recursive: true })
  writeFileSync(alternatesOut, JSON.stringify(alt.alternates))

  const report = {
    dictionary: { entriesIn, rowsWritten: dict.rows.length, dropped: dict.dropped },
    alternates: { surfacesIn: Object.keys(readings).length, written: Object.keys(alt.alternates).length, dropped: alt.dropped },
  }
  for (const line of describeDrops('dictionary', entriesIn, dict.rows.length, dict.dropped)) log(line)
  for (const line of describeDrops('alternates', report.alternates.surfacesIn, report.alternates.written, alt.dropped)) log(line)
  return report
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  buildJapaneseDb({
    popoverPath: join(root, 'public/jmdict-popover.json'),
    readingsPath: join(root, 'public/jmdict-readings.json'),
    schemaPath: join(root, 'android/data/schemas/net.ninjaruss.utasync.data.UtasyncDatabase/1.json'),
    dbOut: join(root, 'android/data/src/main/assets/utasync-seed.db'),
    alternatesOut: join(root, 'android/japanese/src/main/assets/reading-alternates.json'),
  })
}
