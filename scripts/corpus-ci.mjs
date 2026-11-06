#!/usr/bin/env node
// CI guard for the committed truth corpus. CI has no audio, so it cannot score; it can prove
// the committed annotations are well-formed and current. Needs no audio or lyric sheet.
// Reports every violation, then exits 1. Prints paths and line indices, never lyric text (ADR-0004).
// Usage: node scripts/corpus-ci.mjs [repoRoot]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LYRIC_HASH_VERSION } from './lib/lyricHash.mjs'
import { isKnownKind } from './lib/truthKinds.mjs'

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..'))
const violations = []
const bad = (where, what) => violations.push(`${where}: ${what}`)

const manifest = JSON.parse(readFileSync(join(root, 'benchmarks/sync/manifest.json'), 'utf8'))
if (!Array.isArray(manifest.songs) || manifest.songs.length === 0) bad('manifest', 'has no songs; the guard would verify nothing')
const songs = Array.isArray(manifest.songs) ? manifest.songs : []
// Songs that must have a committed annotation. 'unverified-lrc' songs only name a planned path.
const required = songs.filter(x => x.reference?.kind !== 'unverified-lrc').length
let checked = 0
const seen = new Set()
const validIds = new Set()
// Songs that MUST keep a committed, validated annotation, whatever the manifest says. The floor
// lives here, not in the manifest, because the manifest is editable by whoever deletes an
// annotation. Shrinking the corpus means editing this list: a loud diff, on purpose.
const MUST_HAVE = ['akfg-first-take', 'will-death-poetry']
function validate(where, path) {
  checked++
  let a
  try { a = JSON.parse(readFileSync(path, 'utf8')) } catch { bad(where, 'unparseable JSON'); return }
  if (!isKnownKind(a.kind)) bad(where, `unknown kind ${JSON.stringify(a.kind)}`)
  if (a.lineHashVersion !== LYRIC_HASH_VERSION) bad(where, `lineHashVersion ${JSON.stringify(a.lineHashVersion)} is not the current ${LYRIC_HASH_VERSION}`)
  for (const k of ['audioSha256', 'lyricsSha256']) if (typeof a[k] !== 'string' || !/^[0-9a-f]{64}$/.test(a[k])) bad(where, `missing or malformed ${k}`)
  if (!Array.isArray(a.lines)) { bad(where, 'lines is not an array'); return }
  if (a.lines.length === 0) { bad(where, 'lines is empty; an annotation with no lines verifies nothing'); return }
  const notObj = a.lines.flatMap((l, i) => l !== null && typeof l === 'object' && !Array.isArray(l) ? [] : [i + 1])
  if (notObj.length) { bad(where, `${notObj.length} line entr(ies) are not objects (first: line ${notObj[0]})`); return }
  const withText = a.lines.flatMap((l, i) => 'text' in l ? [i + 1] : [])
  if (withText.length) bad(where, `carries a text field on ${withText.length} line(s) (first: line ${withText[0]}); song text must not be committed`)
  const noHash = a.lines.flatMap((l, i) => typeof l.textHash === 'string' && /^[0-9a-f]{64}$/.test(l.textHash) ? [] : [i + 1])
  if (noHash.length) bad(where, `missing or malformed textHash on ${noHash.length} line(s) (first: line ${noHash[0]})`)
}
// The allowlist trusts the id-to-path mapping, so it must be one-to-one.
for (const [what, vals] of [['song id', songs.map(x => x.id)], ['annotationPath', songs.map(x => x.reference?.annotationPath).filter(Boolean)]]) {
  const dup = [...new Set(vals.filter((v, i) => vals.indexOf(v) !== i))]
  for (const d of dup) bad('manifest', `duplicate ${what} ${JSON.stringify(d)}`)
}
for (const song of songs) {
  const rel = song.reference?.annotationPath
  if (!rel) {
    if (song.reference?.kind !== 'unverified-lrc') bad(song.id ?? '(unnamed song)', 'has no annotationPath in the manifest')
    continue
  }
  const where = `${song.id} (${rel})`
  const path = join(root, rel)
  if (!existsSync(path)) {
    // 'unverified-lrc' songs name a planned path; their annotation is not yet generated.
    if (song.reference.kind !== 'unverified-lrc') bad(where, 'referenced by the manifest but absent')
    continue
  }
  seen.add(rel)
  const before = violations.length
  validate(where, path)
  if (violations.length === before) validIds.add(song.id)
}

// Annotations present on disk are validated whether or not the manifest names them, so
// editing the manifest cannot hide one.
const dir = join(root, 'benchmarks/sync/annotations')
if (existsSync(dir)) for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const rel = `benchmarks/sync/annotations/${f}`
  if (seen.has(rel)) continue
  bad(rel, 'annotation is not referenced by the manifest')
  validate(rel, join(dir, f))
}

// Rule 6 backstop: no kana or CJK ideographs in committed corpus files. Typographic non-ASCII
// (± – — ’) is fine. Reports file and line only, never the matched text.
const CJK = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}|[\u30fb\u30fc]/u
const scanned = new Set(['benchmarks/sync/manifest.json', 'benchmarks/sync/README.md'])
for (const song of songs) if (song.reference?.annotationPath) scanned.add(song.reference.annotationPath)
// Every annotation present is scanned, whether or not the manifest knows about it.
const annDir = join(root, 'benchmarks/sync/annotations')
if (existsSync(annDir)) for (const f of readdirSync(annDir)) if (f.endsWith('.json')) scanned.add(`benchmarks/sync/annotations/${f}`)
for (const rel of scanned) {
  const path = join(root, rel)
  if (!existsSync(path)) {
    // Fixed required files must exist; a planned (unverified-lrc) annotation path may not yet.
    if (rel === 'benchmarks/sync/manifest.json' || rel === 'benchmarks/sync/README.md') bad(rel, 'required file is missing; the CJK scan would be reduced')
    continue
  }
  const hits = readFileSync(path, 'utf8').split(/\r?\n/).flatMap((l, i) => CJK.test(l) ? [i + 1] : [])
  if (hits.length) bad(rel, `contains Japanese/CJK characters on ${hits.length} line(s) (first: line ${hits[0]}); song text must not be committed`)
}

for (const id of MUST_HAVE) if (!validIds.has(id)) bad(id, 'must have a committed, valid annotation (guard allowlist) but none was verified')
if (checked === 0) bad('corpus', 'checked 0 annotations; the guard verified nothing')
else if (checked < required) bad('corpus', `checked ${checked} annotation(s) but the manifest requires at least ${required}`)

if (violations.length) {
  console.error(`corpus-ci: ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`corpus-ci: ok (${checked} annotation(s) checked, lineHashVersion ${LYRIC_HASH_VERSION})`)
