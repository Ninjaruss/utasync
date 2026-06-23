/**
 * Audits JA↔EN line pairing and word pairing for "Rock'n'Roll, Morning Light
 * Falls on You" (転がる岩、君に朝が降る) using the real on-device pipeline:
 * kuromoji tokenizer, smartAttachSecondLanguage for line pairing, and
 * alignLinesTokens (gloss + real embedding model) for word pairing.
 * Run: npx tsx scripts/audit-rockn-roll-pairings.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import kuromoji from 'kuromoji'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const JA_LINES = `
出来れば世界を僕は塗り変えたい
戦争をなくすような大逸れたことじゃない
だけどちょっと それもあるよな
俳優や映画スターには成れない
それどころか 君の前でさえも上手に笑えない
そんな僕に術はないよな
嗚呼...
何を間違った それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
凍てつく地面を転がるように走り出した
理由もないのに何だか悲しい
泣けやしないから 余計に救いがない
そんな夜を温めるように歌うんだ
岩は転がって 僕たちを何処かに連れて行くように ように
固い地面を分けて命が芽生えた
あの丘を越えたその先は
光輝いたように ように
君の孤独も全て暴き出す朝だ
赤い 赤い小さな車は君を乗せて
遠く向こうの角を曲がって
此処からは見えなくなった
何をなくした それさえもわからないんだ
ローリング ローリング
初めから持ってないのに胸が痛んだ
僕らはきっとこの先も
心絡まって ローリング ローリング
`.trim().split('\n')

const EN_BLOCK = `
If possible, I want to repaint the world
It's not a grand thing like eliminating wars
But there's a bit of that too

I can't become an actor or a movie star, in fact
I can't even smile well in front of you
There's no way for me

What did I do wrong? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
We started running as if rolling on the freezing ground

For no reason, I feel somewhat sad
I can't cry, so there's even less comfort
I sing to warm up such nights

The rocks roll us
As if taking us somewhere
Life sprouted breaking through the hard ground

Beyond that hill
Shining brightly
It's a morning that exposes all your loneliness

The small red car carries you
Turning the corner far away
It disappeared from view from here

What did we lose? Even that
I don't understand, rolling, rolling
My heart ached even though I didn't have it from the beginning

Surely we will continue
Our hearts entwined, rolling, rolling
`.trim()

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

  console.log('Running line pairing (smartAttachSecondLanguage) with real embedding model...\n')

  const songStart = 12
  const songEnd = 272
  const duration = songEnd - songStart
  const weights = JA_LINES.map((t) => lineWeightLocal(t))
  const total = weights.reduce((a, b) => a + b, 0)
  let cumFrac = 0
  const primaryLines = JA_LINES.map((original, i) => {
    cumFrac += weights[i]
    const startFrac = (cumFrac - weights[i]) / total
    const endFrac = cumFrac / total
    return {
      original,
      translation: '',
      startTime: songStart + startFrac * duration,
      endTime: songStart + endFrac * duration,
    }
  })

  const attached = await smartAttachSecondLanguage(primaryLines, EN_BLOCK, embedTexts)
  console.log(`Line pairing method: ${attached.method}\n`)

  const lineIssues = []
  for (let i = 0; i < attached.lines.length; i++) {
    const l = attached.lines[i]
    console.log(`${String(i + 1).padStart(2)} JA: ${l.original}`)
    console.log(`   EN: ${(l.translation || '(none)').replace(/\n/g, ' / ')}\n`)
    if (!l.translation?.trim()) lineIssues.push({ line: l.original, problem: 'no translation paired' })
  }

  console.log('\n=== Word pairing (gloss + real embedding) per line ===\n')

  const jobs = []
  for (const line of attached.lines) {
    if (!line.translation?.trim()) continue
    const tokens = tokenize(line.original, tokenizer)
    jobs.push({ line, tokens, job: buildAlignJob({ ...line, tokens }) })
  }

  const aligned = await alignLinesTokens(
    jobs.map((j) => j.job),
    embedTexts,
    { maxTextsPerBatch: 64 },
  )

  const wordIssues = []
  jobs.forEach(({ line, tokens }, li) => {
    const result = aligned[li]
    const words = splitTranslationWords(line.translation)

    console.log(`--- ${line.original}`)
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
          wordIssues.push({ line: line.original, token: t.surface, gloss, problem: 'unpaired' })
          console.log(`    ? ${t.surface} (${gloss}) — no pair`)
        }
        continue
      }
      const en = idx.map((i) => words[i]).join('+')
      console.log(`    ✓ ${t.surface} (${gloss}) → ${en}`)
    }
    console.log()
  })

  console.log('\n=== Summary ===')
  console.log(`Line pairing issues: ${lineIssues.length}`)
  for (const u of lineIssues) console.log(`  [no translation] ${u.line}`)
  console.log(`Unpaired alignable tokens: ${wordIssues.length}`)
  for (const u of wordIssues) console.log(`  [${u.line}] ${u.token} (${u.gloss})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
