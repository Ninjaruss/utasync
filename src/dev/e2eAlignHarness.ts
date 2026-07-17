/**
 * Dev-only self-driving alignment E2E harness (round 11 live verification).
 *
 * Open http://localhost:<port>/?e2e=stranger in ANY browser (the point: real
 * Firefox, where no automation can click for us) and it runs the REAL
 * auto-align pipeline exactly as AutoAlignFlow does — decode → forced-language
 * Whisper pass(es) in this browser → mixed merge / refine → focused gap
 * re-transcription — then scores every line against the human-synced LRC truth
 * and renders a scorecard. It also downloads a JSON report (so an agent can
 * read the numbers from ~/Downloads) and exposes window.__E2E_RESULT.
 *
 * Assets are served from public/e2e/ (staged by the test session, not
 * committed): stranger.mp3, stranger-lyrics.txt, stranger-truth.json.
 * Guarded by import.meta.env.DEV in main.tsx — unreachable in production.
 */
import { getDeviceTier } from '../ai-pipeline/capability'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import { refineAlignmentWithPhrases, type RefinedAlignment } from '../lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from '../ai-pipeline/mixedLanguageAlign'
import { reanalyzeGaps } from '../ai-pipeline/gapReanalyze'
import { createSliceTranscriber } from '../ai-pipeline/sliceTranscriber'
import { chunksToWords } from '../ai-pipeline/transcriptChunks'
import { preferredWhisperTimestampMode } from '../ai-pipeline/alignTimestampMode'
import { detectSheetLanguage } from '../ai-pipeline/whisperLanguage'
import { transcribeAudio } from '../ai-pipeline/whisperTranscriber'
import { computeLineMatchedSpans, normalizeForMatch } from '../ai-pipeline/contentAligner'

/* ---- LRC truth helpers (browser copies of scripts/lib/lrcTruth.mjs — that
 * module imports node:path and can't load here; keep in sync) ---- */
function parseLrc(synced: string): { time: number; text: string }[] {
  const rows: { time: number; text: string }[] = []
  for (const line of synced.split('\n')) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (!m) continue
    const text = m[3].trim()
    if (!text) continue
    rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text })
  }
  return rows
}
function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (!na || !nb) return 0
  const grams = (s: string) => {
    const g = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2)
      g.set(k, (g.get(k) ?? 0) + 1)
    }
    return g
  }
  const ga = grams(na)
  const gb = grams(nb)
  let inter = 0
  for (const [k, c] of ga) inter += Math.min(c, gb.get(k) ?? 0)
  return inter / Math.max(1, Math.max(na.length, nb.length) - 1)
}
function matchSheetToLrc(sheetLines: string[], lrcRows: { time: number; text: string }[]): (number | null)[] {
  const n = sheetLines.length
  const m = lrcRows.length
  const sim = Array.from({ length: n }, (_, i) => lrcRows.map((r) => similarity(sheetLines[i], r.text)))
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const choice = Array.from({ length: n + 1 }, () => new Int8Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[i - 1][j]
      let ch = 1
      if (dp[i][j - 1] > best) { best = dp[i][j - 1]; ch = 2 }
      const s = sim[i - 1][j - 1]
      if (s >= 0.5 && dp[i - 1][j - 1] + s > best) { best = dp[i - 1][j - 1] + s; ch = 3 }
      dp[i][j] = best
      choice[i][j] = ch
    }
  }
  const truthTime: (number | null)[] = new Array(n).fill(null)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (choice[i][j] === 3) { truthTime[i - 1] = lrcRows[j - 1].time; i--; j-- }
    else if (choice[i][j] === 2) j--
    else i--
  }
  return truthTime
}
const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const pct = (xs: number[], p: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

/* ---- harness ---- */
const el = (tag: string, style: string, text = ''): HTMLElement => {
  const node = document.createElement(tag)
  node.setAttribute('style', style)
  node.textContent = text
  return node
}

export async function runE2eAlignHarness(root: HTMLElement): Promise<void> {
  root.innerHTML = ''
  const wrap = el('div', 'font-family:ui-monospace,monospace;background:#111;color:#eee;min-height:100vh;padding:24px;font-size:14px;line-height:1.5;')
  root.appendChild(wrap)
  const title = el('h1', 'font-size:18px;color:#7dd3fc;margin-bottom:8px;', 'utasync E2E align harness — STRANGER THAN HEAVEN')
  const status = el('div', 'color:#fbbf24;margin-bottom:12px;white-space:pre-wrap;', 'starting…')
  const out = el('div', 'white-space:pre-wrap;')
  wrap.append(title, status, out)
  // Fire-and-forget beacon to the dev server's /__e2e-status sink (vite.config)
  // so a run in an un-automatable browser (Firefox) is observable from outside.
  const beacon = (payload: unknown) => {
    try {
      void fetch('/__e2e-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* dev-only observability; never fail the run */
    }
  }
  const browserName = /firefox/i.test(navigator.userAgent) ? 'firefox' : 'chromium'
  let lastBeacon = 0
  const say = (msg: string) => {
    status.textContent = msg
    console.log(`[e2e] ${msg}`)
    // Throttle progress beacons; always send non-progress messages.
    const now = Date.now()
    if (/\d+%/.test(msg) && now - lastBeacon < 3000) return
    lastBeacon = now
    beacon({ browser: browserName, status: msg })
  }

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    webgpu: !!(navigator as Navigator & { gpu?: unknown }).gpu,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
  }
  const finish = (ok: boolean) => {
    report.ok = ok
    report.finishedAt = new Date().toISOString()
    ;(window as unknown as { __E2E_RESULT?: unknown }).__E2E_RESULT = report
    document.title = ok ? 'E2E DONE' : 'E2E FAILED'
    beacon({ browser: browserName, final: true, report })
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const browser = /firefox/i.test(navigator.userAgent) ? 'firefox' : 'chromium'
      a.download = `${(report.song as string) ?? 'song'}-e2e-report-${browser}.json`
      document.body.appendChild(a)
      a.click()
    } catch (e) {
      console.warn('[e2e] report download failed', e)
    }
  }

  try {
    const tier = getDeviceTier()
    report.tier = tier
    if (tier === 'manual') {
      say(`TIER=manual — this browser exposes no WebGPU (navigator.gpu missing), so auto-align is unavailable here, matching the real app. Enable WebGPU (Firefox: dom.webgpu.enabled) and reload.`)
      finish(false)
      return
    }

    const songName = (new URLSearchParams(location.search).get('e2e') ?? 'stranger').replace(/[^a-z0-9-]/g, '')
    report.song = songName
    title.textContent = `utasync E2E align harness — ${songName}`
    say(`tier=${tier}, webgpu=${report.webgpu} — fetching audio + lyrics for "${songName}"…`)
    const [audioRes, lyricsRes, truthRes] = await Promise.all([
      fetch(`/e2e/${songName}.mp3`),
      fetch(`/e2e/${songName}-lyrics.txt`),
      fetch(`/e2e/${songName}-truth.json`),
    ])
    if (!audioRes.ok || !lyricsRes.ok || !truthRes.ok) {
      throw new Error(`e2e assets for "${songName}" missing under public/e2e/`)
    }
    const audioFile = new File([await audioRes.blob()], `${songName}.mp3`, { type: 'audio/mpeg' })
    const lineTexts = (await lyricsRes.text()).split('\n').map((l) => l.trim()).filter(Boolean)
    // Truth: synced LRC ({syncedLyrics}) or official-caption onsets
    // ({onsets:[{idx,onset,shared?}]}, the only usable truth for live
    // arrangements like THE FIRST TAKE). `shared` onsets are lower bounds
    // (second half of a caption) — excluded from scoring.
    const truthJson = (await truthRes.json()) as {
      syncedLyrics?: string
      onsets?: { idx: number; onset: number; shared?: boolean }[]
    }
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))

    say('decoding audio…')
    const { data: audioData, sampleRate } = await decodeAudioFileToMono(audioFile)
    const durationSec = audioData.length / sampleRate
    const alignmentLanguage = detectSheetLanguage(lineTexts, 'ja')
    const timestampMode = preferredWhisperTimestampMode(tier, durationSec)
    Object.assign(report, { durationSec: +durationSec.toFixed(1), alignmentLanguage, timestampMode })

    // --- transcription + alignment, mirroring AutoAlignFlow's default path ---
    const t0 = performance.now()
    const opts = (language: 'ja' | 'en' | 'mixed', label: string, mode: 'word' | 'segment') => ({
      language,
      highAccuracy: false,
      timestampMode: mode,
      onLoadProgress: (p: { status?: string; progress?: number; aggregateProgress?: number }) => {
        const pctNum = p.aggregateProgress ?? p.progress
        say(`${label}: loading model (${p.status ?? ''} ${typeof pctNum === 'number' ? Math.round(pctNum) + '%' : ''})`)
      },
      onTranscribeProgress: ({ progress }: { progress: number }) =>
        say(`${label}: transcribing ${Math.round(progress)}%`),
    })

    let refined: RefinedAlignment
    let transcriptWords: TranscriptWord[]
    if (alignmentLanguage === 'mixed') {
      const jaT = await transcribeAudio(audioData, sampleRate, opts('ja', 'JA pass', timestampMode))
      const enT = await transcribeAudio(audioData, sampleRate, opts('en', 'EN pass', 'segment'))
      say('merging + aligning…')
      const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaT), chunksToWords(enT))
      refined = mixed.refined
      transcriptWords = mixed.transcriptWords
    } else {
      const tr = await transcribeAudio(audioData, sampleRate, opts(alignmentLanguage, 'pass', timestampMode))
      const words = chunksToWords(tr)
      transcriptWords = sanitizeTranscript(words)
      refined = refineAlignmentWithPhrases(sheetRows, words, alignmentLanguage)
    }
    report.transcribeMs = Math.round(performance.now() - t0)

    say('focused gap re-pass…')
    const sliceTx = createSliceTranscriber({
      audioData,
      sampleRate,
      isCancelled: () => false,
      highAccuracy: false,
      timestampMode,
    })
    const gap = await reanalyzeGaps({
      refined,
      transcriptWords,
      sheetRows,
      alignmentLanguage,
      sourceLanguage: 'ja',
      transcribeSlice: sliceTx.transcribe,
      onProgress: (n) => say(`focused gap re-pass: ${n} section(s)…`),
    })
    refined = gap.refined
    transcriptWords = gap.transcriptWords
    report.gapSectionsFilled = gap.filledCount
    report.totalMs = Math.round(performance.now() - t0)

    // --- score vs truth ---
    let truth: (number | null)[]
    if (truthJson.syncedLyrics) {
      truth = matchSheetToLrc(lineTexts, parseLrc(truthJson.syncedLyrics))
    } else if (truthJson.onsets) {
      truth = lineTexts.map(() => null)
      for (const g of truthJson.onsets) {
        if (g.shared) continue
        truth[g.idx] = g.onset
      }
    } else {
      throw new Error('truth JSON needs syncedLyrics (LRC) or onsets (captions)')
    }
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(transcriptWords))
    const diffs: number[] = []
    for (let i = 0; i < lineTexts.length; i++) {
      const t = truth[i]
      const s = spans[i]
      if (t == null || !s) continue
      if (s.matchedChars / Math.max(1, s.totalChars) >= 0.5) diffs.push(s.firstTime - t)
    }
    const offset = median(diffs) ?? 0
    const quality = refined.lineAlignmentQuality ?? []
    const rows: { i: number; err: number | null; label: string; text: string }[] = []
    const errs: number[] = []
    for (let i = 0; i < refined.lines.length; i++) {
      const t = truth[i]
      const err = t == null ? null : refined.lines[i].startTime - (t + offset)
      if (err != null) errs.push(Math.abs(err))
      rows.push({ i, err: err == null ? null : +err.toFixed(2), label: quality[i] ?? '?', text: lineTexts[i].slice(0, 40) })
    }
    const summary = {
      linesWithTruth: errs.length,
      offsetS: +offset.toFixed(2),
      meanAbsErrS: +(errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)).toFixed(2),
      p50S: +(pct(errs, 0.5) ?? 0).toFixed(2),
      p90S: +(pct(errs, 0.9) ?? 0).toFixed(2),
      over1s: errs.filter((e) => e > 1).length,
      over1_5s: errs.filter((e) => e > 1.5).length,
      over3s: errs.filter((e) => e > 3).length,
      labels: {
        good: quality.filter((q) => q === 'good').length,
        approximate: quality.filter((q) => q === 'approximate').length,
        needs_review: quality.filter((q) => q === 'needs_review').length,
      },
    }
    report.summary = summary
    report.rows = rows

    say('DONE')
    const head = el('div', 'color:#4ade80;font-size:16px;margin:10px 0;')
    head.textContent =
      `SUMMARY  tier=${tier} mode=${timestampMode} lang=${alignmentLanguage} gapFilled=${gap.filledCount}\n` +
      `lines=${summary.linesWithTruth}  mean|err|=${summary.meanAbsErrS}s  p50=${summary.p50S}s  p90=${summary.p90S}s\n` +
      `>1s: ${summary.over1s}   >1.5s: ${summary.over1_5s}   >3s: ${summary.over3s}\n` +
      `labels: good=${summary.labels.good} approx=${summary.labels.approximate} review=${summary.labels.needs_review}`
    head.setAttribute('style', head.getAttribute('style') + 'white-space:pre-wrap;')
    out.appendChild(head)
    for (const r of rows) {
      const color = r.err == null ? '#666' : Math.abs(r.err) > 1.5 ? '#f87171' : Math.abs(r.err) > 1 ? '#fbbf24' : '#4ade80'
      out.appendChild(el('div', `color:${color};`, `#${String(r.i).padStart(2)} ${r.err == null ? '  n/a' : String(r.err).padStart(6)}s [${r.label.slice(0, 6).padEnd(6)}] ${r.text}`))
    }
    finish(true)
  } catch (e) {
    say(`FAILED: ${e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`)
    report.error = e instanceof Error ? e.message : String(e)
    finish(false)
  }
}
