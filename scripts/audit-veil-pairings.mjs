/**
 * Audits JA↔EN line pairing and word pairing for Veil (Keina Suda).
 * Run: npx tsx scripts/audit-veil-pairings.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import kuromoji from 'kuromoji'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures/veil')

const JA_LINES = readFileSync(join(FIXTURES, 'lyrics.ja.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)
const EN_BLOCK = readFileSync(join(FIXTURES, 'lyrics.en.txt'), 'utf8').trim()

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

function lineWeightLocal(text) {
  return Math.max(1, text.replace(/\s/g, '').length)
}

async function main() {
  const { alignLinesTokens, buildAlignmentUnits } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/wordAligner.ts')).href
  )
  const { buildAlignJob, smartAttachSecondLanguage } = await import(
    pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href
  )
  const { alignLyrics } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href
  )
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

  const cachePath = join(root, '.cache/auto-align-audit/veil.json')
  if (!existsSync(cachePath)) {
    console.error('Run audit-auto-align.mjs veil first to cache transcript')
    process.exit(1)
  }
  const transcript = JSON.parse(readFileSync(cachePath, 'utf8'))
  const words = (transcript.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })

  const aligned = alignLyrics(JA_LINES, words, undefined, 'ja')
  console.log(`Alignment: mode=${aligned.mode} confidence=${aligned.confidence.toFixed(3)}\n`)

  const dictPath = join(root, 'public/dict')
  const tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((err, t) => (err ? reject(err) : resolve(t)))
  })

  console.log('=== Line pairing ===\n')
  const attached = await smartAttachSecondLanguage(aligned.lines, EN_BLOCK, embedTexts)
  console.log(`Method: ${attached.method}\n`)

  const lineIssues = []
  for (let i = 0; i < attached.lines.length; i++) {
    const l = attached.lines[i]
    const dur = (l.endTime - l.startTime).toFixed(2)
    console.log(`${String(i + 1).padStart(2)} [${l.startTime.toFixed(1)}s] JA: ${l.original}`)
    console.log(`   EN: ${(l.translation || '(none)').replace(/\n/g, ' / ')}`)
    if (!l.translation?.trim()) lineIssues.push({ line: l.original, problem: 'no translation' })
    if (l.endTime - l.startTime <= 0) lineIssues.push({ line: l.original, problem: 'zero duration' })
    if (l.endTime - l.startTime > 15) lineIssues.push({ line: l.original, problem: `long duration ${dur}s` })
    console.log()
  }

  console.log('\n=== Word pairing (sample problematic lines) ===\n')
  const jobs = []
  for (const line of attached.lines) {
    if (!line.translation?.trim()) continue
    const tokens = tokenize(line.original, tokenizer)
    jobs.push({ line, tokens, job: buildAlignJob({ ...line, tokens }) })
  }

  const wordAligned = await alignLinesTokens(
    jobs.map((j) => j.job),
    embedTexts,
    { maxTextsPerBatch: 64 },
  )

  const wordIssues = []
  jobs.forEach(({ line, tokens }, li) => {
    const result = wordAligned[li]
    const words = splitTranslationWords(line.translation)
    const units = buildAlignmentUnits(tokens)
    let unpaired = 0
    let suspicious = 0
    const pairs = []
    for (let ti = 0; ti < result.length; ti++) {
      const t = result[ti]
      if (isParticleToken(t) || !t.surface.trim()) continue
      const gloss = tokenGlossText(t)
      const idx = t.alignmentIndices
      if (!idx || idx.length === 0) {
        if (isAlignableToken(t)) { unpaired++; wordIssues.push({ line: line.original, token: t.surface, gloss }) }
        continue
      }
      const en = idx.map((i) => words[i]).join('+')
      pairs.push(`${t.surface}→${en}`)
    }
    if (unpaired >= 2 || line.endTime - line.startTime <= 0 || line.endTime - line.startTime > 15) {
      console.log(`--- ${line.original}`)
      console.log(`    EN: ${line.translation.replace(/\n/g, ' / ')}`)
      console.log(`    Units: ${units.map((u) => u.embedText).join(' | ')}`)
      for (const p of pairs) console.log(`    ✓ ${p}`)
      if (unpaired) console.log(`    ? ${unpaired} unpaired alignable tokens`)
      console.log()
    }
  })

  console.log('\n=== Summary ===')
  console.log(`Line issues: ${lineIssues.length}`)
  for (const u of lineIssues) console.log(`  [${u.problem}] ${u.line}`)
  console.log(`Unpaired alignable tokens: ${wordIssues.length}`)
  for (const u of wordIssues.slice(0, 30)) console.log(`  [${u.line}] ${u.token} (${u.gloss})`)
  if (wordIssues.length > 30) console.log(`  ... and ${wordIssues.length - 30} more`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
