// @vitest-environment node
//
// The conversion is where silent data loss lives: a dropped entry or a mis-keyed row looks, three
// tasks later, like an accuracy problem. Every assertion here is about what went in versus what
// came out, never about a number typed in from a previous run.
import { describe, it, expect, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildJapaneseDb,
  convertAlternates,
  convertDictionary,
  GLOSS_SEPARATOR,
} from '../../scripts/build-japanese-db.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const SCHEMA = join(ROOT, 'android/data/schemas/net.ninjaruss.utasync.data.UtasyncDatabase/1.json')
const SEED = join(ROOT, 'android/data/src/main/assets/utasync-seed.db')
const ALTERNATES = join(ROOT, 'android/japanese/src/main/assets/reading-alternates.json')
const POPOVER = join(ROOT, 'public/jmdict-popover.json')

// Dictionary words only. No song text, per CLAUDE.md rule 6.
const popover = {
  明白: [
    { r: 'めいはく', pos: 'adj', g: 'obvious; clear; plain' },
    { r: 'あからさま', pos: 'adj', g: 'plain; frank; candid' },
  ],
  私: [
    { r: 'わたくし', pos: 'n', g: 'I; me' },
    { r: 'わたくし', pos: 'adj', g: 'personal (affairs, etc.); private' },
    { r: 'し', g: 'private affairs' },
  ],
  は: [{ r: 'は', pos: 'prt', g: 'indicates sentence topic' }],
  空: [{ r: 'そら', pos: 'n', g: 'sky' }],
}

function inTmp() {
  return mkdtempSync(join(tmpdir(), 'utasync-db-'))
}

function build(entries, readings = {}) {
  const dir = inTmp()
  const popoverPath = join(dir, 'popover.json')
  const readingsPath = join(dir, 'readings.json')
  writeFileSync(popoverPath, JSON.stringify({ v: 1, entries }))
  writeFileSync(readingsPath, JSON.stringify({ v: 1, readings }))
  const log = []
  const dbOut = join(dir, 'out.db')
  const alternatesOut = join(dir, 'alt.json')
  const report = buildJapaneseDb({
    popoverPath,
    readingsPath,
    schemaPath: SCHEMA,
    dbOut,
    alternatesOut,
    log: (line) => log.push(line),
  })
  return { report, log, dbOut, alternatesOut }
}

function rows(dbPath, sql, ...args) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}

describe('convertDictionary', () => {
  it('keeps every input surface: the set of surfaces out equals the set in', () => {
    const { rows: out, dropped } = convertDictionary(popover)
    expect(dropped.total).toBe(0)
    expect(new Set(out.map((r) => r.surface))).toEqual(new Set(Object.keys(popover)))
  })

  it('keeps a surface with several senses in the order the source ranked them', () => {
    const { rows: out } = convertDictionary(popover)
    const mine = out.filter((r) => r.surface === '私')
    expect(mine.map((r) => r.senseIndex)).toEqual([0, 1, 2])
    expect(mine.map((r) => r.glosses[0])).toEqual(popover['私'].map((e) => e.g.split('; ')[0]))
  })

  it('splits a gloss string into a list and leaves an absent part of speech as null', () => {
    const { rows: out } = convertDictionary(popover)
    expect(out.find((r) => r.surface === '明白' && r.reading === 'めいはく').glosses).toEqual([
      'obvious',
      'clear',
      'plain',
    ])
    expect(out.find((r) => r.surface === '私' && r.reading === 'し').posLabel).toBeNull()
  })

  it('drops an entry with no gloss, counts it by reason, and keeps the entries around it', () => {
    const { rows: out, dropped } = convertDictionary({
      空: [
        { r: 'そら', pos: 'n', g: 'sky' },
        { r: 'くう', pos: 'n', g: '  ' },
        { r: 'から', pos: 'n', g: ' ; ' },
      ],
      無: [{ r: 'む', g: '' }],
    })
    expect(dropped.byReason['no-gloss']).toBe(3)
    expect(dropped.total).toBe(3)
    expect(out.map((r) => r.reading)).toEqual(['そら'])
    // The surface whose only entry was dropped is gone, and that is the counted loss.
    expect(out.some((r) => r.surface === '無')).toBe(false)
  })

  it('numbers the surviving senses consecutively from 0 after a drop', () => {
    const { rows: out } = convertDictionary({
      空: [
        { r: 'そら', g: 'sky' },
        { r: 'くう', g: '' },
        { r: 'あき', g: 'empty' },
      ],
    })
    expect(out.map((r) => r.senseIndex)).toEqual([0, 1])
  })

  it('refuses a gloss containing the packing separator rather than corrupting the row', () => {
    const { rows: out, dropped } = convertDictionary({ 空: [{ r: 'そら', g: `sky${GLOSS_SEPARATOR}x` }] })
    expect(out).toEqual([])
    expect(dropped.byReason['separator-in-gloss']).toBe(1)
  })

  it('accounts for every entry of the real input: rows plus drops equals entries', () => {
    const entries = JSON.parse(readFileSync(POPOVER, 'utf8')).entries
    const total = Object.values(entries).reduce((n, list) => n + list.length, 0)
    const { rows: out, dropped } = convertDictionary(entries)
    expect(out.length + dropped.total).toBe(total)
  })
})

describe('convertAlternates', () => {
  it('keeps the common/uncommon split the source encodes around the pipe', () => {
    const { alternates } = convertAlternates({ 明白: 'めいはく|あからさま', 今日: 'きょう,こんにち|こんち,こんじつ' })
    expect(alternates['明白']).toEqual([['めいはく'], ['あからさま']])
    expect(alternates['今日']).toEqual([['きょう', 'こんにち'], ['こんち', 'こんじつ']])
  })

  it('reads a leading pipe as no common reading, and no pipe as no uncommon one', () => {
    const { alternates } = convertAlternates({ 白地: '|あからさま,しらじ', 明日: 'あした,あす' })
    expect(alternates['白地']).toEqual([[], ['あからさま', 'しらじ']])
    expect(alternates['明日']).toEqual([['あした', 'あす'], []])
  })

  it('drops a surface with one reading, since it cannot be ambiguous, and counts it', () => {
    const { alternates, dropped } = convertAlternates({ 空: 'そら', 偸閑: '|あからさま', 明白: 'めいはく|あからさま' })
    expect(Object.keys(alternates)).toEqual(['明白'])
    expect(dropped.byReason['single-reading']).toBe(2)
  })
})

describe('buildJapaneseDb', () => {
  let built
  beforeAll(() => {
    built = build(popover, { 明白: 'めいはく|あからさま', 空: 'そら' })
  })

  it('writes every converted row into the dictionary table, by exact key', () => {
    const count = rows(built.dbOut, 'SELECT COUNT(*) AS n FROM dictionary')[0].n
    expect(count).toBe(built.report.dictionary.rowsWritten)
    expect(count).toBe(Object.values(popover).reduce((n, l) => n + l.length, 0))
    const two = rows(built.dbOut, 'SELECT reading FROM dictionary WHERE surface = ? ORDER BY senseIndex', '私')
    expect(two.map((r) => r.reading)).toEqual(['わたくし', 'わたくし', 'し'])
  })

  it('packs glosses with the separator the Kotlin converter unpacks', () => {
    const r = rows(built.dbOut, 'SELECT glosses FROM dictionary WHERE surface = ? AND reading = ?', '明白', 'めいはく')[0]
    expect(r.glosses.split(GLOSS_SEPARATOR)).toEqual(['obvious', 'clear', 'plain'])
    expect(GLOSS_SEPARATOR).toBe('\u001F')
  })

  it('reports what it dropped and why, on the log it was given', () => {
    const b = build({ 空: [{ r: 'そら', g: 'sky' }, { r: 'くう', g: '' }] })
    const text = b.log.join('\n')
    expect(text).toMatch(/dropped 1/i)
    expect(text).toMatch(/no-gloss/)
    expect(b.report.dictionary.dropped.total).toBe(1)
  })

  it('writes the alternates file from the readings input', () => {
    expect(JSON.parse(readFileSync(built.alternatesOut, 'utf8'))).toEqual({ 明白: [['めいはく'], ['あからさま']] })
  })

  it('opens as a Room database: the identity hash and version come from the exported schema', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')).database
    const hash = rows(built.dbOut, 'SELECT identity_hash AS h FROM room_master_table WHERE id = 42')[0].h
    expect(hash).toBe(schema.identityHash)
    expect(rows(built.dbOut, 'PRAGMA user_version')[0].user_version).toBe(schema.version)
    const tables = rows(built.dbOut, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'room_%'")
    expect(new Set(tables.map((t) => t.name))).toEqual(new Set(schema.entities.map((e) => e.tableName)))
  })
})

describe('the committed seed', () => {
  it('exists and is the schema the Kotlin build exports (regenerate with scripts/build-japanese-db.mjs)', () => {
    expect(existsSync(SEED)).toBe(true)
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')).database
    expect(rows(SEED, 'SELECT identity_hash AS h FROM room_master_table WHERE id = 42')[0].h).toBe(schema.identityHash)
    expect(rows(SEED, 'PRAGMA user_version')[0].user_version).toBe(schema.version)
  })

  it('holds one row per converted entry of the real input', () => {
    const entries = JSON.parse(readFileSync(POPOVER, 'utf8')).entries
    const { rows: out } = convertDictionary(entries)
    expect(rows(SEED, 'SELECT COUNT(*) AS n FROM dictionary')[0].n).toBe(out.length)
    expect(rows(SEED, 'SELECT COUNT(DISTINCT surface) AS n FROM dictionary')[0].n).toBe(
      new Set(out.map((r) => r.surface)).size,
    )
  })

  it('ships an alternates file that is the conversion of the real readings input', () => {
    const readings = JSON.parse(readFileSync(join(ROOT, 'public/jmdict-readings.json'), 'utf8')).readings
    const { alternates } = convertAlternates(readings)
    expect(JSON.parse(readFileSync(ALTERNATES, 'utf8'))).toEqual(alternates)
    expect(statSync(ALTERNATES).size).toBeGreaterThan(0)
  })
})
