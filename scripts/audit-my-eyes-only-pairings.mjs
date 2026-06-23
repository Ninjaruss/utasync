/**
 * Audits JA↔EN word pairings for My Eyes Only using gloss + embedding heuristics.
 * Run: node scripts/audit-my-eyes-only-pairings.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import kuromoji from 'kuromoji'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Dynamic import compiled TS via tsx would be heavy; inline minimal copies of key logic
// by importing from built vitest path — use tsx to import TS modules instead.

const LINES = [
  { original: 'You always make me so happy 青空に溶けて', translation: 'You always make me so happy\nMelt into the blue sky' },
  { original: 'I promise for my eyes only キミの隣で', translation: 'I promise for my eyes only\nNext to you' },
  { original: 'ねえ いつか', translation: 'Hey someday' },
  { original: 'ねえ いつも', translation: 'Hey always' },
  { original: '滑り込むキミの横 隣り合わせのハート', translation: 'Beside you as you slide in\nAdjacent hearts' },
  { original: '一歩ずつ進んでも', translation: 'One step at a time' },
  { original: '視線に困るあたし', translation: "I'm having trouble looking at you" },
  { original: '「どうした？」なんて', translation: "What's up Oh my God" },
  { original: '覗き込まれて 爆発寸前', translation: "She peeks in and she's on the verge of exploding" },
  { original: '迷い子の粉雪が', translation: 'A stray powder snowflake' },
  { original: '恋に溶けてく', translation: 'Dissolving in love' },
  { original: '滑り出すキミの事', translation: 'About you slipping away' },
  { original: '慌てて追いかけるよ', translation: "I'll rush after you" },
  { original: '一歩だけ遅れてる', translation: 'Only one step behind' },
  { original: 'いつも通りのあたし', translation: "I'm the same as always" },
  { original: '「大丈夫？」なんて', translation: 'Are you okay Oh my God' },
  { original: '振り返るから 転倒寸前', translation: "I'm turning around I'm about to fall over" },
  { original: '恋心溶けて', translation: 'Dissolving in love' },
  { original: 'キミの背中に', translation: 'On your back' },
  { original: '風に溶けてく', translation: 'Dissolving in the wind' },
  { original: 'また 来ようね', translation: "I'll come back for you" },
]

function tokenize(text, tokenizer) {
  let index = 0
  return tokenizer.tokenize(text).map((t) => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
      startIndex,
      endIndex: index,
    }
  })
}

async function main() {
  const { alignLinesTokens, buildAlignmentUnits } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/wordAligner.ts')).href
  )
  const { buildAlignJob } = await import(pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href)
  const { splitTranslationWords } = await import(
    pathToFileURL(join(root, 'src/language/wordColors.ts')).href
  )
  const { isAlignableToken, isParticleToken } = await import(
    pathToFileURL(join(root, 'src/core/language.ts')).href
  )
  const { tokenGlossText } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/wordAligner.ts')).href
  )
  const { embedTexts } = await import(pathToFileURL(join(root, 'scripts/lib/nodeEmbedder.mjs')).href)

  const dictPath = join(root, 'public/dict')
  const tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((err, t) => (err ? reject(err) : resolve(t)))
  })

  const jobs = []
  for (const line of LINES) {
    const tokens = tokenize(line.original, tokenizer)
    jobs.push({ line, tokens, job: buildAlignJob({ ...line, tokens, startTime: 0, endTime: 1 }) })
  }

  console.log('Running embedding model alignment (may take ~30s on first load)...\n')
  const aligned = await alignLinesTokens(
    jobs.map((j) => j.job),
    embedTexts,
    { maxTextsPerBatch: 64 },
  )

  const issues = []

  jobs.forEach(({ line, tokens }, li) => {
    // buildAlignJob already bakes targetWordBaseOffset into targetIndexMap, so
    // alignmentIndices on `aligned[li]` are already in full-translation coordinates.
    // Re-applying offsetTokenAlignmentIndices here would double-shift mixed-script lines.
    const result = aligned[li]
    const words = splitTranslationWords(line.translation)

    console.log(`--- Line ${li + 1}: ${line.original}`)
    console.log(`    EN: ${line.translation.replace(/\n/g, ' / ')}`)

    const units = buildAlignmentUnits(tokens)
    console.log(`    Units: ${units.map((u) => u.embedText).join(' | ')}`)

    for (let ti = 0; ti < result.length; ti++) {
      const t = result[ti]
      if (isParticleToken(t) || !t.surface.trim()) continue
      const gloss = tokenGlossText(t)
      const idx = t.alignmentIndices
      if (!idx || idx.length === 0) {
        if (isAlignableToken(t)) {
          issues.push({ line: line.original, token: t.surface, gloss, problem: 'unpaired' })
          console.log(`    ? ${t.surface} (${gloss}) — no pair`)
        }
        continue
      }
      const en = idx.map((i) => words[i]).join('+')
      console.log(`    ✓ ${t.surface} (${gloss}) → ${en}`)
    }
    console.log()
  })

  console.log('\n=== Summary: unpaired alignable tokens ===')
  for (const u of issues) {
    console.log(`  [${u.line}] ${u.token} (${u.gloss})`)
  }
  console.log(`Total gaps: ${issues.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
