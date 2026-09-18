/**
 * Dev-only flow harness: runs the REAL AutoAlignFlow component, in a real browser,
 * on a seeded song — then CLICKS the result screen's affordances programmatically.
 *
 * Why this exists: the mirror harness above reimplements the pipeline steps, so it
 * cannot verify the parts that only exist in the component (which button renders,
 * what it does when clicked, and what the next run then skips). No automation can
 * drive Firefox here, but the component can drive itself: seed the song, render the
 * flow, and dispatch real DOM clicks on what it renders.
 *
 * Reachable at `/?e2e=<song>&flow=1` (optionally `&click=<button-text-substring>`).
 * Everything is reported through the same /__e2e-status sink as the mirror harness.
 */
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { Song } from '../core/types'
import { db } from '../core/db/schema'
import { audioStoragePath, deleteAudio, saveAudio } from '../core/opfs/audio'
import { useSettingsStore } from '../payment/SettingsStore'
import { AutoAlignFlow } from '../ai-pipeline/AutoAlignFlow'
import { computeLineMatchedSpans } from '../ai-pipeline/contentAligner'

interface FlowHarnessOpts {
  root: HTMLElement
  songName: string
  /** Substring of the button to click once the first run finishes. */
  clickLabel: string
  /** Seed the song with this isolation verdict, to exercise the remembered-skip
   * path without paying for a separation this browser already knows is useless. */
  verdict?: 'unusable' | 'ok'
  say: (msg: string) => void
  beacon: (payload: unknown) => void

}

type Scored = {
  run: number
  linesWithTruth: number
  meanAbsErrS: number
  p50S: number
  p90S: number
  over1s: number
  over3s: number
  labels: { good: number; approximate: number; needs_review: number }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0
}

/** Score a completed run's saved lines against the caption-onset truth. */
function scoreSavedSong(
  song: Song,
  lineTexts: string[],
  truth: (number | null)[],
  run: number,
): Scored {
  const spans = computeLineMatchedSpans(lineTexts, song.lyrics.transcriptWords ?? [])
  const diffs: number[] = []
  for (let i = 0; i < lineTexts.length; i++) {
    const t = truth[i]
    const s = spans[i]
    if (t == null || !s) continue
    if (s.matchedChars / Math.max(1, s.totalChars) >= 0.5) diffs.push(s.firstTime - t)
  }
  const offset = median(diffs)
  const errs: number[] = []
  for (let i = 0; i < song.lyrics.lines.length; i++) {
    const t = truth[i]
    if (t == null) continue
    errs.push(Math.abs(song.lyrics.lines[i].startTime - (t + offset)))
  }
  const q = song.lyrics.lineAlignmentQuality ?? []
  return {
    run,
    linesWithTruth: errs.length,
    meanAbsErrS: +(errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)).toFixed(2),
    p50S: +pct(errs, 0.5).toFixed(2),
    p90S: +pct(errs, 0.9).toFixed(2),
    over1s: errs.filter((e) => e > 1).length,
    over3s: errs.filter((e) => e > 3).length,
    labels: {
      good: q.filter((x) => x === 'good').length,
      approximate: q.filter((x) => x === 'approximate').length,
      needs_review: q.filter((x) => x === 'needs_review').length,
    },
  }
}

export async function runFlowHarness(opts: FlowHarnessOpts): Promise<void> {
  const { root, songName, clickLabel, verdict, say, beacon } = opts
  const report: Record<string, unknown> = {
    mode: 'flow',
    song: songName,
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    webgpu: !!(navigator as Navigator & { gpu?: unknown }).gpu,
  }

  const [audioRes, lyricsRes, truthRes] = await Promise.all([
    fetch(`/e2e/${songName}.mp3`),
    fetch(`/e2e/${songName}-lyrics.txt`),
    fetch(`/e2e/${songName}-truth.json`),
  ])
  if (!audioRes.ok || !lyricsRes.ok || !truthRes.ok) throw new Error(`missing assets for ${songName}`)

  const lineTexts = (await lyricsRes.text()).split('\n').map((l) => l.trim()).filter(Boolean)
  const truthJson = (await truthRes.json()) as {
    syncedLyrics?: string
    onsets?: { idx: number; onset: number; shared?: boolean }[]
  }
  const truth: (number | null)[] = lineTexts.map(() => null)
  if (truthJson.onsets) {
    for (const g of truthJson.onsets) if (!g.shared) truth[g.idx] = g.onset
  } else if (truthJson.syncedLyrics) {
    for (const line of truthJson.syncedLyrics.split('\n')) {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
      if (!m) continue
      const idx = lineTexts.indexOf(m[3].trim())
      if (idx >= 0) truth[idx] = Number(m[1]) * 60 + Number(m[2])
    }
  }
  report.linesWithTruth = truth.filter((t) => t != null).length

  // Seed the song the app would have: audio in OPFS, row-per-line lyrics in Dexie.
  const songId = `e2e-${songName}`
  say('seeding the song (OPFS audio + lyrics)…')
  const buffer = await (await audioRes.blob()).arrayBuffer()
  await saveAudio(songId, buffer)
  // Consent so the flow starts straight away instead of showing the first-run prompt,
  // and isolation at its default (on) — the app path under test.
  useSettingsStore.setState({ modelDownloadConsented: true, vocalSeparationEnabled: true })
  const seeded: Song = {
    id: songId,
    title: songName,
    artist: 'e2e',
    sources: [],
    audioStoredPath: audioStoragePath(songId),
    ...(verdict ? { audioIsolationVerdict: verdict } : {}),
    lyrics: {
      lines: lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 })),
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    createdAt: new Date(),
  }
  await db.songs.put(seeded)
  await db.songs.delete(`${songId}-prev`).catch(() => {})

  // Capture the component's own diagnostics (timestamp mode, isolation decisions).
  const logs: string[] = []
  const origInfo = console.info
  const origWarn = console.warn
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
    origInfo(...(args as []))
  }
  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
    origWarn(...(args as []))
  }

  const mounted = document.createElement('div')
  root.appendChild(mounted)
  const reactRoot: Root = createRoot(mounted)

  const scored: Scored[] = []
  let completions = 0
  let latest: Song | null = null
  let resolveNextRun: (() => void) | null = null

  const onComplete = (updated: Song) => {
    completions++
    latest = updated
    const card = scoreSavedSong(updated, lineTexts, truth, completions)
    scored.push(card)
    report[`run${completions}`] = card
    say(`run ${completions} done: mean ${card.meanAbsErrS}s, p50 ${card.p50S}s, >3s ${card.over3s}, good ${card.labels.good}`)
    resolveNextRun?.()
    resolveNextRun = null
  }

  const waitForCompletion = (n: number) =>
    new Promise<void>((resolve) => {
      if (completions >= n) return resolve()
      resolveNextRun = resolve
    })

  say('rendering the real AutoAlignFlow (autoStart)…')
  reactRoot.render(
    <AutoAlignFlow song={seeded} autoStart onComplete={onComplete} onClose={() => {}} />,
  )
  await waitForCompletion(1)

  // onComplete runs BEFORE React flushes the setState that reaches the 'done'
  // stage, so the first synchronous DOM read still shows the progress screen
  // (observed: buttonsAfterRun1 === ['Cancel']). Wait for the render instead.
  const findButton = () =>
    Array.from(mounted.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes(clickLabel.toLowerCase()),
    )
  const deadline = Date.now() + 10_000
  while (!findButton() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  const buttons = Array.from(mounted.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim())
  report.buttonsAfterRun1 = buttons
  const clickable = findButton()
  report.clickLabel = clickLabel
  report.clickFound = !!clickable
  report.notivesAfterRun1 = Array.from(mounted.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 6)

  if (clickable) {
    say(`clicking "${(clickable.textContent ?? '').trim()}"…`)
    clickable.click()
    await waitForCompletion(2)
  }

  console.info = origInfo
  console.warn = origWarn

  // The seeded song is real app data (Dexie + OPFS) in whichever browser profile
  // ran this — remove it so a dev run never leaves a phantom song in the library.
  try {
    await db.songs.delete(songId)
    await deleteAudio(songId)
  } catch { /* best-effort cleanup */ }

  report.completions = completions
  report.flowLogs = logs
  report.modesLogged = logs.filter((l) => l.includes('timestamp mode')).map((l) => l.split('timestamp mode:')[1]?.trim())
  report.isolationLogs = logs.filter((l) => l.toLowerCase().includes('isolation') || l.includes('stem'))
  report.scores = scored
  const storedSong: Song | undefined = (latest as Song | null) ?? (await db.songs.get(songId))
  report.storedVerdict = storedSong?.audioIsolationVerdict ?? null
  beacon({ final: true, report })
  say('FLOW DONE')
}
