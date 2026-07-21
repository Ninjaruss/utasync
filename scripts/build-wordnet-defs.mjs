/**
 * Builds monolingual definition data for immersion mode.
 *  - public/en-def.json  : Princeton WordNet, { word → [definition] }
 *  - public/wnja-def.json: Japanese WordNet, { lemma → [Japanese definition] }
 *
 * Sources:
 *  - English: the `wordnet-db` npm package (dict/data.{noun,verb,adj,adv}).
 *  - Japanese: .cache/wnja/wnjpn-ok.tab + wnjpn-def.tab (download the gzipped tab
 *    files from the Japanese WordNet (bond-lab) v1.1 release and extract them).
 *    See public/licenses/JAPANESE-WORDNET-LICENSE.txt.
 *
 * Usage: node scripts/build-wordnet-defs.mjs
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { indexEnDefs, parseWnjaDefLine, indexWnjaDefs } from './lib/wordnetDefs.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function buildEn() {
  const dbPath = require('wordnet-db').path // → node_modules/wordnet-db/dict
  const lines = []
  for (const f of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
    lines.push(...readFileSync(join(dbPath, f), 'utf8').split('\n'))
  }
  const entries = indexEnDefs(lines, { cap: 3 })
  const payload = JSON.stringify({ v: 1, source: 'princeton-wordnet-3.1', entries })
  writeFileSync(join(root, 'public/en-def.json'), payload)
  console.log(`en-def.json: ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB, ${Object.keys(entries).length} words`)
}

function buildJa() {
  const dir = join(root, '.cache/wnja')
  const okPath = join(dir, 'wnjpn-ok.tab')
  const defPath = join(dir, 'wnjpn-def.tab')
  if (!existsSync(okPath) || !existsSync(defPath)) {
    throw new Error(`Missing ${okPath} / ${defPath}. Download wnjpn-ok.tab.gz and wnjpn-def.tab.gz from https://github.com/bond-lab/wnja/releases/tag/v1.1 and extract into .cache/wnja/`)
  }
  const okLines = readFileSync(okPath, 'utf8').split('\n').filter(Boolean)
  const parsedDefs = readFileSync(defPath, 'utf8').split('\n').filter(Boolean).map(parseWnjaDefLine)
  const entries = indexWnjaDefs(okLines, parsedDefs, { cap: 3 })
  const payload = JSON.stringify({ v: 1, source: 'japanese-wordnet-1.1', entries })
  writeFileSync(join(root, 'public/wnja-def.json'), payload)
  console.log(`wnja-def.json: ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB, ${Object.keys(entries).length} lemmas`)
}

buildEn()
buildJa()
