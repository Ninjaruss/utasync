import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { StrictMode } from 'react'
import type { Song } from '../core/types'
import { db } from '../core/db/schema'
import { audioStoragePath, deleteAudio, saveAudio } from '../core/opfs/audio'
import { PlayerView } from '../player/PlayerView'
import { usePlayerStore } from '../player/PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { ToastProvider } from '../core/ui/Toast'
import { ALIGNMENT_PIPELINE_VERSION } from '../lyrics/phraseAlignment'

/**
 * SYNC CHECK, in a real browser — the one verification this project has never run.
 *
 * Round 5 planned a browser sync check, did not run it, and only said so at the very end after
 * everything else had been declared verified (docs/superpowers/plans/2026-07-13-accuracy-audit-round5.md:230).
 * Every check since has been deterministic and model-free, which means nothing has ever confirmed
 * that the line the app HIGHLIGHTS is the line that is actually sounding. The deterministic
 * instruments score timestamps; only a browser can score what is rendered.
 *
 * It needs no AI at all, which is what makes it cheap: the lyrics are seeded ALREADY TIMED from
 * the same LRC truth the offline instruments use, so there is no transcription, no model download
 * and no WebGPU. What is under test is the render layer — the active-line computation and the
 * scroll/highlight it drives — not the aligner.
 *
 * Reachable at `/?e2e=<song>&sync=1`. Reports through the `/__e2e-status` sink like its siblings.
 *
 * Method: for each line that has truth, move the playhead to a point INSIDE that line and read
 * back the text the app has highlighted. Expected = the line whose [start, next start) contains
 * the playhead. A miss is a render-layer defect: an off-by-one, a stale active line, or a lead-time
 * error (lineTiming.VOCAL_ONSET_LEAD_S).
 */

interface SyncHarnessOptions {
  root: HTMLElement
  songName: string
  say: (msg: string) => void
  beacon: (payload: unknown) => void
}

/** Where inside a line to sample, as a fraction of its span. Early, because a lead-time error
 * shows up at the start of a line first. */
const SAMPLE_FRACTION = 0.35
/** How long to wait after moving the playhead for the app to re-render, plus two animation
 * frames. The first run of this harness used 60ms and reported no active element on about half
 * its samples, which may be a real render-layer miss or may simply be the window/scroll effect
 * not having run yet — the two are indistinguishable at 60ms, so this waits long enough that a
 * miss cannot be blamed on the measurement. */
const SETTLE_MS = 250

function parseTruth(
  lineTexts: string[],
  truthJson: { syncedLyrics?: string; onsets?: { idx: number; onset: number; shared?: boolean }[] },
): (number | null)[] {
  const truth: (number | null)[] = lineTexts.map(() => null)
  if (truthJson.onsets) {
    for (const g of truthJson.onsets) if (!g.shared) truth[g.idx] = g.onset
    return truth
  }
  for (const line of (truthJson.syncedLyrics ?? '').split('\n')) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (!m) continue
    const idx = lineTexts.indexOf(m[3].trim())
    if (idx >= 0) truth[idx] = Number(m[1]) * 60 + Number(m[2])
  }
  return truth
}

/** The highlighted line's text, as RENDERED. The active primary text is the only element carrying
 * an inline text-shadow (LyricDisplay paints a glow on it), which makes it a stable signal. */
function renderedActiveText(): string | null {
  const nodes = Array.from(document.querySelectorAll('[style*="text-shadow"]'))
  for (const n of nodes) {
    // Read the text WITHOUT ruby annotations. `textContent` interleaves furigana into the line
    // ("春はると秋あき" for "春と秋"), so a containment check against the raw text fails on every
    // line that carries readings — which is a defect in the CHECK, not in the app. Cloning and
    // dropping <rt> gives the line as the reader sees it spelled.
    const clone = n.cloneNode(true) as HTMLElement
    clone.querySelectorAll('rt, rp').forEach((el) => el.remove())
    const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return null
}

/** Two animation frames, so a scheduled scroll/window update has actually run. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

export async function runSyncHarness({ root, songName, say, beacon }: SyncHarnessOptions): Promise<void> {
  try {
    const [audioRes, lyricsRes, truthRes] = await Promise.all([
      fetch(`/e2e/${songName}.mp3`),
      fetch(`/e2e/${songName}-lyrics.txt`),
      fetch(`/e2e/${songName}-truth.json`),
    ])
    if (!audioRes.ok || !lyricsRes.ok || !truthRes.ok) throw new Error(`missing assets for ${songName}`)

    const lineTexts = (await lyricsRes.text()).split('\n').map((l) => l.trim()).filter(Boolean)
    const truth = parseTruth(lineTexts, await truthRes.json())
    const withTruth = truth.filter((t) => t != null).length
    say(`assets loaded: ${lineTexts.length} lines, ${withTruth} with truth`)

    // Seed the song ALREADY TIMED from truth: this check is about rendering, not alignment, so
    // there is no transcription and no model. `alignmentMode: 'auto'` plus a pinned pipeline
    // version stops the version-gated re-refine on open from rewriting what we just seeded.
    const songId = `sync-${songName}`
    await saveAudio(songId, await (await audioRes.blob()).arrayBuffer())
    const seeded: Song = {
      id: songId,
      title: songName,
      artist: 'e2e',
      sources: [],
      audioStoredPath: audioStoragePath(songId),
      lyrics: {
        // Each line runs until the NEXT truth line starts, not a fixed 2s. A short fixed end
        // left the playhead outside the line at every wide gap, so the app correctly highlighted
        // nothing and the check reported a phantom miss — a defect in the FIXTURE, not the app.
        lines: lineTexts.map((original, i) => ({
          original,
          translation: '',
          startTime: truth[i] ?? 0,
          endTime: truth.slice(i + 1).find((t) => t != null) ?? (truth[i] ?? 0) + 2,
        })),
        sourceLanguage: 'ja',
        translationLanguage: 'en',
        alignmentMode: 'auto',
        alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION,
        timingSource: 'aligned',
      },
      createdAt: new Date(),
    }
    await db.songs.put(seeded)
    say('seeded timed lyrics + OPFS audio')

    const reactRoot: Root = createRoot(root)
    reactRoot.render(
      <StrictMode>
        <ToastProvider>
          <PlayerView songId={songId} onBack={() => {}} />
        </ToastProvider>
      </StrictMode>,
    )

    // Wait for the rows to render before sampling.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (renderedActiveText()) break
    }
    const durationSec = await new Promise<number>((resolve) => {
      const deadline = Date.now() + 8000
      const tick = () => {
        const d = usePlayerStore.getState().duration
        if (d > 0) return resolve(d)
        if (Date.now() > deadline) return resolve(0)
        setTimeout(tick, 100)
      }
      tick()
    })
    say(`player ready, duration=${durationSec.toFixed(1)}s`)

    const samples: { line: number; t: number; expected: string; rendered: string | null; ok: boolean }[] = []
    for (let i = 0; i < lineTexts.length; i++) {
      const start = truth[i]
      if (start == null) continue
      const nextStart = truth.slice(i + 1).find((t) => t != null) ?? null
      if (nextStart == null) continue // no span to sample inside
      const end = nextStart
      if (end - start < 1.0) continue // too tight to sample meaningfully
      const t = start + (end - start) * SAMPLE_FRACTION
      if (durationSec > 0 && t > durationSec) continue

      // Move the playhead the way playback does, then let React settle.
      usePlayerStore.getState().setPosition(t)
      useLyricsStore.getState().syncPosition(t)
      await settle()

      const rendered = renderedActiveText()
      const expected = lineTexts[i]
      // Containment rather than equality: the row may carry ruby/romaji alongside the text.
      const ok = !!rendered && rendered.includes(expected.slice(0, Math.min(12, expected.length)))
      samples.push({ line: i, t, expected, rendered, ok })
      say(`sample line=${i} t=${t.toFixed(2)} ${ok ? 'PASS' : `FAIL expected="${expected.slice(0, 20)}" rendered="${(rendered ?? '').slice(0, 20)}"`}`)
    }

    const passed = samples.filter((s) => s.ok).length
    beacon({
      browser: 'sync-harness',
      final: true,
      song: songName,
      samples: samples.length,
      passed,
      failed: samples.length - passed,
      failures: samples.filter((s) => !s.ok).map((s) => ({ line: s.line, t: +s.t.toFixed(2), expected: s.expected, rendered: s.rendered })),
    })
    await deleteAudio(songId).catch(() => {})
    await db.songs.delete(songId).catch(() => {})
  } catch (err) {
    beacon({ browser: 'sync-harness', final: true, error: String((err as Error)?.message ?? err) })
  }
}
