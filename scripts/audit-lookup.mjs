/**
 * Tap-lookup accuracy scorecard.
 *
 * Runs the REAL popover resolver (`lookupWord`) over every distinct token in the
 * fixture corpus and prints one row per word: surface, POS, reading, definition.
 * Diffing two runs is what makes a dictionary or resolver change decidable —
 * the same role `audit-corpus.mjs --dump-pairs` plays for the word pairer.
 *
 * Node has no fetch for the /jmdict-*.json payloads, so all three are injected;
 * without that this would measure a dictionary state the app never has.
 *
 *   npx tsx scripts/audit-lookup.mjs                 # full dump
 *   npx tsx scripts/audit-lookup.mjs --blanks        # only words with no definition
 *   npx tsx scripts/audit-lookup.mjs --out FILE      # write instead of stdout
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji from 'kuromoji'
import { lookupWord } from '../src/language/japanese/wordLookup.ts'
import { setJmdictGlossForTests } from '../src/ai-pipeline/jmdictGloss.ts'
import { setJmdictPopoverForTests } from '../src/ai-pipeline/jmdictPopover.ts'
import { setJmdictReadingsForTests } from '../src/language/japanese/jmdictReadings.ts'
import { applyReadingCorrections } from '../src/language/japanese/readingCorrections.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(root, 'tests/ai-pipeline/fixtures')
const blanksOnly = process.argv.includes('--blanks')
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null

setJmdictGlossForTests(JSON.parse(readFileSync(join(root, 'public/jmdict-gloss.json'), 'utf8')))
setJmdictPopoverForTests(JSON.parse(readFileSync(join(root, 'public/jmdict-popover.json'), 'utf8')))
setJmdictReadingsForTests(JSON.parse(readFileSync(join(root, 'public/jmdict-readings.json'), 'utf8')))

const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: join(root, 'public/dict') }).build((e, t) => (e ? rej(e) : res(t))))

const manifest = JSON.parse(readFileSync(join(FIX, 'corpus.json'), 'utf8'))
const seen = new Map()
for (const song of manifest.songs) {
  let text
  try { text = readFileSync(join(FIX, song.lyrics), 'utf8') } catch { continue }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let i = 0
    const toks = applyReadingCorrections(tokenizer.tokenize(line).map((x) => {
      const start = i
      i += x.surface_form.length
      return {
        surface: x.surface_form, reading: x.reading, pos: x.pos,
        posDetail1: x.pos_detail_1 !== '*' ? x.pos_detail_1 : undefined,
        baseForm: x.basic_form && x.basic_form !== '*' && x.basic_form !== x.surface_form ? x.basic_form : undefined,
        startIndex: start, endIndex: i,
      }
    }))
    for (const t of toks) {
      const key = `${t.surface}|${t.pos}|${t.posDetail1 ?? ''}|${t.reading ?? ''}`
      if (!seen.has(key)) seen.set(key, t)
    }
  }
}

const rows = []
let blank = 0
for (const [, t] of [...seen.entries()].sort()) {
  const r = await lookupWord(t)
  if (!r) continue
  const isBlank = r.glosses.length === 0
  if (isBlank) blank++
  if (blanksOnly && !isBlank) continue
  rows.push([
    t.surface.padEnd(8), (t.pos ?? '').padEnd(4), (t.posDetail1 ?? '-').padEnd(9),
    `head=${r.headword}`.padEnd(14), `read=${r.reading ?? '-'}`.padEnd(16),
    isBlank ? '*** BLANK ***' : r.glosses.join(' / '),
  ].join(' '))
}

const report = `words=${seen.size} blank=${blank}\n\n` + rows.join('\n')
if (outPath) { writeFileSync(outPath, report); console.log(`words=${seen.size} blank=${blank} → ${outPath}`) }
else console.log(report)
