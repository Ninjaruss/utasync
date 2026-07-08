/**
 * Deterministic, fixture-based audit of the three core AI features across a
 * corpus of songs. Unlike the per-song audit-*.mjs scripts, this needs no MP3s
 * and no Whisper run: it reads committed transcripts + lyrics from
 * tests/ai-pipeline/fixtures/ (see corpus.json) and runs the real alignment /
 * reading / pairing logic, emitting a one-row-per-song scorecard.
 *
 * Run:
 *   npx tsx scripts/audit-corpus.mjs                  # alignment + readings
 *   npx tsx scripts/audit-corpus.mjs --pairing        # also word pairing (needs embed model)
 *   npx tsx scripts/audit-corpus.mjs --write-baseline  # snapshot scorecard to fixtures
 *   npx tsx scripts/audit-corpus.mjs --check-baseline  # fail on regression vs snapshot
 *
 * The scorecard is the before/after instrument for edge-case fixes: lower is
 * better for every metric.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import kuromoji from 'kuromoji'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const BASELINE = join(FIXTURES, 'corpus-baseline.json')

const WANT_PAIRING = process.argv.includes('--pairing')
const WRITE_BASELINE = process.argv.includes('--write-baseline')
const CHECK_BASELINE = process.argv.includes('--check-baseline')

/** Normalize either a word array or a {chunks:[{text,timestamp:[s,e]}]} transcript to TranscriptWord[]. */
function loadTranscriptWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime, endTime: w.endTime }]
    })
  }
  return (raw.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

async function main() {
  const { refineAlignmentWithPhrases } = await import(
    pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href
  )
  const { reconcileTokenReadings } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/readingReconciler.ts')).href
  )
  const { applyReadingCorrections } = await import(
    pathToFileURL(join(root, 'src/language/japanese/readingCorrections.ts')).href
  )
  const { resolveTokenReading } = await import(
    pathToFileURL(join(root, 'src/lyrics/readingDisplay.ts')).href
  )
  const { katakanaToHiragana } = await import(
    pathToFileURL(join(root, 'src/language/japanese/phonetics.ts')).href
  )
  const { alignLyrics, sanitizeTranscript } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href
  )
  const { computeLineMatchedSpans, isInterjectionLyricLine } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href
  )
  const { computeBoundaryMetrics } = await import(
    pathToFileURL(join(root, 'scripts/lib/boundaryMetrics.mjs')).href
  )

  const tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: join(root, 'public/dict') }).build((err, t) => (err ? reject(err) : resolve(t)))
  })
  function tokenizeJa(text) {
    let index = 0
    const tokens = tokenizer.tokenize(text).map((t) => {
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
    return applyReadingCorrections(tokens)
  }

  // Optional pairing deps (model download) — only loaded with --pairing.
  let pairingDeps = null
  if (WANT_PAIRING) {
    const { alignLinesTokens } = await import(pathToFileURL(join(root, 'src/ai-pipeline/wordAligner.ts')).href)
    const { buildAlignJob } = await import(pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href)
    const { isAlignableToken, isParticleToken } = await import(pathToFileURL(join(root, 'src/core/language.ts')).href)
    const { splitTranslationWords } = await import(pathToFileURL(join(root, 'src/language/wordColors.ts')).href)
    const { embedTexts } = await import(pathToFileURL(join(root, 'scripts/lib/nodeEmbedder.mjs')).href)
    pairingDeps = { alignLinesTokens, buildAlignJob, isAlignableToken, isParticleToken, splitTranslationWords, embedTexts }
  }

  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  // Ground-truth sung readings for tricky tokens: the sung-mode ruby must
  // resolve to exactly what the singer sings (see reading-truth.json).
  const readingTruth = JSON.parse(readFileSync(join(FIXTURES, 'reading-truth.json'), 'utf8'))
  const scorecard = {}

  for (const song of manifest.songs) {
    const lineTexts = readLines(join(FIXTURES, song.lyrics))
    const words = loadTranscriptWords(join(FIXTURES, song.transcript))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)

    // --- boundary metrics, attributed per pass ---
    const sanitized = sanitizeTranscript(words)
    const spans = computeLineMatchedSpans(lineTexts, sanitized)
    // refineAlignmentWithPhrases runs alignLyrics internally but doesn't expose
    // the pass-1 result, so re-run it standalone to attribute metrics per pass.
    const pass1 = alignLyrics(lineTexts, words, sheetRows, song.lang)
    const bnd1 = computeBoundaryMetrics(pass1.lines, spans, sanitized)
    const bnd2 = computeBoundaryMetrics(refined.lines, spans, sanitized)

    // --- alignment metrics ---
    const quality = refined.lineAlignmentQuality ?? []
    const needsReview = quality.filter((q) => q === 'needs_review').length
    let monotonicity = 0
    let zeroDur = 0
    let longDur = 0
    for (let i = 0; i < refined.lines.length; i++) {
      const l = refined.lines[i]
      const dur = l.endTime - l.startTime
      if (dur <= 0.1) zeroDur++
      if (dur > 18) longDur++
      if (i > 0 && l.startTime < refined.lines[i - 1].startTime) monotonicity++
    }

    // --- reading metrics ---
    let adopt = 0
    let mismatch = 0
    let readKanjiTokens = 0
    let rubyWrong = 0
    const truthEntries = readingTruth[song.name] ?? []
    for (const line of refined.lines) {
      if (!line.original.trim()) continue
      const tokens = tokenizeJa(line.original)
      const reconciled = reconcileTokenReadings(tokens, line, words)
      for (const t of reconciled) {
        if (/[一-龯]/.test(t.surface)) readKanjiTokens++
        if (t.audioReading) adopt++
        if (t.readingMismatch) mismatch++
      }
      for (const truth of truthEntries) {
        if (truth.line !== line.original) continue
        for (const t of reconciled) {
          if (t.surface !== truth.surface) continue
          // Sung mode must show exactly the sung reading; dictionary mode must
          // show either the sung reading (high-confidence promotion) or the
          // token's own dictionary reading — never a third, garbage reading.
          if (resolveTokenReading(t, 'sung').ruby !== truth.sung) rubyWrong++
          const dictRuby = resolveTokenReading(t, 'dictionary').ruby
          const dictKana = t.reading ? katakanaToHiragana(t.reading) : null
          if (dictRuby !== truth.sung && dictRuby !== dictKana) rubyWrong++
        }
      }
    }

    // --- pairing metrics (optional) ---
    let pairing = null
    if (pairingDeps) pairing = await auditPairing(song, refined.lines, pairingDeps, tokenizeJa)

    scorecard[song.name] = {
      lines: `${refined.lines.length}/${lineTexts.length}`,
      mode: refined.mode,
      align_needs_review: needsReview,
      align_monotonicity: monotonicity,
      align_zero_dur: zeroDur,
      align_long_dur: longDur,
      // Interjection/vocalization lines are un-scoreable by design (no phonetic
      // content for the JA model) — informational string, exempt from the
      // numeric regression guard like bnd_measured.
      unscoreable: String(lineTexts.filter((t) => isInterjectionLyricLine(t)).length),
      // checkBaseline() flags any NUMERIC increase as a regression. Defect
      // counts below are numeric so they're guarded; bnd_measured (higher is
      // better) and the gap percentiles (informational distribution, not a
      // defect count) are emitted as strings so they're exempt.
      bnd_measured: String(bnd2.measured),
      bnd_early_p1: bnd1.earlyEnd,
      bnd_early_p2: bnd2.earlyEnd,
      bnd_latestart_p1: bnd1.lateStart,
      bnd_latestart_p2: bnd2.lateStart,
      bnd_late_p1: bnd1.lateEnd,
      bnd_late_p2: bnd2.lateEnd,
      bnd_midword_p2: bnd2.midWord,
      bnd_beyond_audio: bnd2.beyondAudio,
      bnd_gap_p50_p2: `${bnd2.gapP50}s`,
      bnd_gap_p95_p2: `${bnd2.gapP95}s`,
      read_kanji_tokens: readKanjiTokens,
      read_adopt: adopt,
      read_mismatch: mismatch,
      read_ruby_wrong: rubyWrong,
      ...(pairing ? { pair_unpaired: pairing.unpaired, pair_magnet: pairing.magnet } : {}),
    }
  }

  printScorecard(scorecard)

  if (WRITE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(scorecard, null, 2) + '\n')
    console.log(`\nBaseline written to ${BASELINE}`)
  }
  if (CHECK_BASELINE) {
    const ok = checkBaseline(scorecard)
    process.exit(ok ? 0 : 1)
  }
}

async function auditPairing(song, lines, deps, tokenizeJa) {
  const { alignLinesTokens, buildAlignJob, isAlignableToken, isParticleToken, splitTranslationWords, embedTexts } = deps
  // Attach EN: veil has a separate block; bilingual sheets (my-eyes-only) already interleave.
  let withEn = lines
  if (song.en) {
    const { smartAttachSecondLanguage } = await import(pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href)
    const enBlock = readFileSync(join(FIXTURES, song.en), 'utf8').trim()
    withEn = (await smartAttachSecondLanguage(lines, enBlock, embedTexts)).lines
  }
  // Mirror the production pipeline (PlayerView): tokenize, then repair adjacent
  // EN clauses that fan translations front-load onto the wrong row. Without this
  // the audit measures a pre-correction state the app never displays.
  const { fixAdjacentTranslationOrder } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/translationOrder.ts')).href
  )
  const tokenized = withEn.map((line) => ({ ...line, tokens: tokenizeJa(line.original) }))
  const ordered = fixAdjacentTranslationOrder(tokenized)
  const jobs = []
  for (const line of ordered) {
    if (!line.translation?.trim()) continue
    const tokens = line.tokens ?? tokenizeJa(line.original)
    jobs.push({ line, tokens, job: buildAlignJob({ ...line, tokens }) })
  }
  if (jobs.length === 0) return { unpaired: 0, magnet: 0 }
  const aligned = await alignLinesTokens(jobs.map((j) => j.job), embedTexts, { maxTextsPerBatch: 64 })

  let unpaired = 0
  let magnet = 0
  jobs.forEach(({ line }, li) => {
    const result = aligned[li]
    // Collect, per EN target, the positions of the INDEPENDENT content tokens
    // that map to it. Auxiliary stems (い/た/たい/ない …) carry their unit's
    // alignmentIndices for coloring continuity but aren't alignable content —
    // counting them as sources would flag every verb chain as a false magnet.
    const targetSources = new Map()
    let pos = 0
    for (const t of result) {
      if (isParticleToken(t) || !t.surface.trim()) {
        pos++
        continue
      }
      const idx = t.alignmentIndices
      if (!idx || idx.length === 0) {
        if (isAlignableToken(t)) unpaired++
        pos++
        continue
      }
      if (isAlignableToken(t)) {
        for (const i of idx) {
          if (!targetSources.has(i)) targetSources.set(i, [])
          targetSources.get(i).push(pos)
        }
      }
      pos++
    }
    // A genuine magnet pile-up is one EN word claimed by 3+ independent content
    // words that are NOT a contiguous run — contiguous many-to-one (a compound
    // phrase → one word) is fine.
    for (const positions of targetSources.values()) {
      if (positions.length < 3) continue
      const contiguous = positions.every((p, k) => k === 0 || p === positions[k - 1] + 1)
      if (!contiguous) magnet++
    }
  })
  return { unpaired, magnet }
}

function printScorecard(scorecard) {
  const cols = Object.keys(Object.values(scorecard)[0] ?? {})
  const nameW = Math.max(12, ...Object.keys(scorecard).map((n) => n.length))
  const header = ['song'.padEnd(nameW), ...cols.map((c) => c.padStart(Math.max(c.length, 6)))].join('  ')
  console.log('=== Corpus scorecard (lower is better) ===\n')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const [name, row] of Object.entries(scorecard)) {
    console.log([name.padEnd(nameW), ...cols.map((c) => String(row[c]).padStart(Math.max(c.length, 6)))].join('  '))
  }
}

function checkBaseline(scorecard) {
  if (!existsSync(BASELINE)) {
    console.error(`\nNo baseline at ${BASELINE} — run with --write-baseline first.`)
    return false
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const regressions = []
  const numeric = (v) => (typeof v === 'number' ? v : null)
  for (const [name, row] of Object.entries(scorecard)) {
    const b = base[name]
    if (!b) continue
    for (const [k, v] of Object.entries(row)) {
      const cur = numeric(v)
      const prev = numeric(b[k])
      if (cur != null && prev != null && cur > prev) regressions.push(`${name}.${k}: ${prev} -> ${cur}`)
    }
  }
  if (regressions.length) {
    console.error(`\n✗ ${regressions.length} regression(s) vs baseline:`)
    for (const r of regressions) console.error(`  ${r}`)
    return false
  }
  console.log('\n✓ No regressions vs baseline.')
  return true
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
