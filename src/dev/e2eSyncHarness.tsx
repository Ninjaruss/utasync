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
import { VOCAL_ONSET_LEAD_S } from '../lyrics/lineTiming'

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
 * WHAT THE EARLIER ROUNDS OF THIS HARNESS GOT WRONG
 *
 * Rounds 1-3 poked the stores directly (`setPosition(t)` + `syncPosition(t)`) and scored 0/21,
 * 10/21, 7/21. Two of those numbers were defects in the CHECK, not the app: `textContent`
 * interleaved furigana into the line, and a 2s fixed line end put the playhead outside the line at
 * every wide gap. The last round left a third, unexplained symptom: after poking the playhead
 * BACKWARD (201.2s -> 91.4s) the highlight froze on the 201.2s line and every later sample
 * "failed" against it. Two very different things explain that equally well — a real backward-seek
 * bug in the app, or an artifact of driving the stores out of order in a way no app path does —
 * and the poked method cannot tell them apart, because it never plays through the app's own
 * transport.
 *
 * So this harness drives the app's OWN CONTROLS and nothing else:
 *
 *   Phase A — forward: click "Start playback", then sample the rendered highlight as the real
 *             playhead advances. Expected line comes from the app's own rule (`VOCAL_ONSET_LEAD_S`,
 *             span = [start, next start)) applied to LRC truth, so a miss is a render-layer miss.
 *   Phase B — backward: click "Rewind 5 seconds" repeatedly. This is the frozen-highlight case,
 *             exercised the way a user would, with no store writes from the check.
 *
 * Each sample records THREE things, which is what makes a failure diagnosable: the store's
 * `activeLine`, the index of the row actually carrying the glow (`data-line-index`), and the
 * playhead. Store-wrong and DOM-wrong are different bugs and this distinguishes them.
 *
 * A pass is only meaningful if playback actually happened, so the report carries `advanced` and
 * `inconclusive` rather than reporting a green run that measured nothing.
 */

interface SyncHarnessOptions {
  root: HTMLElement
  songName: string
  say: (msg: string) => void
  beacon: (payload: unknown) => void
  /** Seed every line `{startTime: 0, endTime: 0}` — the exact shape `songBuilder` leaves after a
   * fresh lyrics import and `TapSyncEditor` leaves for every line the user did not tap. In this
   * state nothing is known about timing, so the correct number of highlighted lines is ZERO. */
  untimed?: boolean
}

/** Wall-clock budget for the forward pass. At 1x this covers a third of a 230s song; `?syncSecs=`
 * raises it far enough to walk a whole song. */
const PHASE_A_MS = (() => {
  const raw = Number(new URLSearchParams(window.location.search).get('syncSecs'))
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 90_000
})()
/** How often to sample. The engine's ticker only pushes a new position every 100ms. */
const SAMPLE_MS = 200
/** Let React commit the highlight before reading the DOM. */
const SETTLE_MS = 120
/** Keep samples this far inside a truth span. Within the guard band the correct line is genuinely
 * ambiguous, and scoring there would report the check's own resolution as an app defect. */
const GUARD_S = 0.4
/** Rewind clicks in phase B. Each is one backward jump of 5s in the app's own control. */
const REWIND_STEPS = 12
/** Below this the run did not really exercise the render layer. */
const MIN_ADVANCE_S = 5
const MIN_LINES_VISITED = 3
const MIN_SCORED_SAMPLES = 5

type Sample = {
  phase: 'forward' | 'backward'
  pos: number
  storeActive: number
  glowIndex: number | null
  expected: number | null
  glowText: string | null
  /** glow row === store's activeLine — the render layer faithfully drew the store. */
  renderOk: boolean
  /** store's activeLine === truth-derived expectation — the app points at the sounding line. */
  contractOk: boolean | null
}

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

/** The line the app OUGHT to be highlighting at `pos`, from truth, using the app's own lead time
 * (imported, not copied — this check must not drift from the constant it is testing). Returns null
 * inside the guard bands, where the answer is legitimately ambiguous. */
function expectedLineAt(pos: number, truth: (number | null)[]): number | null {
  const adjusted = pos + VOCAL_ONSET_LEAD_S
  for (let i = 0; i < truth.length; i++) {
    const start = truth[i]
    if (start == null) continue
    const nextStart = truth.slice(i + 1).find((t) => t != null)
    if (nextStart == null) continue // no span to be inside
    if (adjusted < start + GUARD_S) return null
    if (adjusted < nextStart - GUARD_S) return i
    if (adjusted < nextStart) return null // guard band before the next line
  }
  return null
}

/** The highlight as RENDERED: which row glows, and its text. `textContent` interleaves furigana
 * into the line ("春はると秋あき" for "春と秋"), so the reading is taken from a clone with <rt>
 * stripped — otherwise a containment check against the raw text fails on every ruby line, which is
 * a defect in the check rather than in the app. */
function renderedGlow(): { index: number | null; text: string | null } {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[style*="text-shadow"]'))
  for (const n of nodes) {
    const clone = n.cloneNode(true) as HTMLElement
    clone.querySelectorAll('rt, rp').forEach((el) => el.remove())
    const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const row = n.closest<HTMLElement>('[data-line-index]')
    return { index: row ? Number(row.dataset.lineIndex) : null, text }
  }
  return { index: null, text: null }
}

async function settle(ms = SETTLE_MS): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

function button(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

export async function runSyncHarness({ root, songName, say, beacon, untimed = false }: SyncHarnessOptions): Promise<void> {
  try {
    const [audioRes, lyricsRes, truthRes] = await Promise.all([
      fetch(`/e2e/${songName}.mp3`),
      fetch(`/e2e/${songName}-lyrics.txt`),
      fetch(`/e2e/${songName}-truth.json`),
    ])
    if (!audioRes.ok || !lyricsRes.ok || !truthRes.ok) throw new Error(`missing assets for ${songName}`)

    const lineTexts = (await lyricsRes.text()).split('\n').map((l) => l.trim()).filter(Boolean)
    const truth = untimed ? lineTexts.map(() => null) : parseTruth(lineTexts, await truthRes.json())
    const withTruth = truth.filter((t) => t != null).length
    say(`assets loaded: ${lineTexts.length} lines, ${withTruth} with truth${untimed ? ' (UNTIMED MODE: every line {0,0})' : ''}`)

    // Seed the song ALREADY TIMED from truth: this check is about rendering, not alignment, so
    // there is no transcription and no model. `alignmentMode: 'auto'` plus a pinned pipeline
    // version stops the version-gated re-refine on open from rewriting what we just seeded.
    //
    // A line with no truth has no known time, so it is seeded DEGENERATE (start 0, end 0) rather
    // than with the old fabricated span. `lineEffectiveEnd` falls back to the next line's start,
    // and the active-line scan takes the FIRST row whose span contains the playhead, so a
    // fabricated 0..next-truth span on an untimed line would shadow the real line after it and
    // report a phantom miss. Untimed rows therefore sit at the head, out of the way — which is
    // also what they are: lines the LRC never timed.
    const songId = `sync-${songName}`
    await saveAudio(songId, await (await audioRes.blob()).arrayBuffer())
    const seeded: Song = {
      id: songId,
      title: songName,
      artist: 'e2e',
      sources: [],
      audioStoredPath: audioStoragePath(songId),
      lyrics: {
        lines: lineTexts.map((original, i) => ({
          original,
          translation: '',
          startTime: truth[i] ?? 0,
          endTime: truth[i] == null ? 0 : (truth.slice(i + 1).find((t) => t != null) ?? truth[i]! + 2),
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

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (document.querySelector('[data-line-index]')) break
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

    const samples: Sample[] = []

    /** One reading of the world. Position is read either side of the store read so a tick landing
     * mid-sample discards the sample instead of producing an off-by-one-line "failure". */
    const takeSample = async (phase: 'forward' | 'backward'): Promise<Sample | null> => {
      await settle()
      const pos = usePlayerStore.getState().position
      const storeActive = useLyricsStore.getState().activeLine
      const glow = renderedGlow()
      if (Math.abs(usePlayerStore.getState().position - pos) > 0.05) return null
      // `-1` is the store's own "no line" value, so in untimed mode the expectation is exactly it.
      const expected = untimed ? -1 : expectedLineAt(pos, truth)
      // No glow at all corresponds to the store's `-1`, not to a mismatch. Comparing them raw made
      // the untimed run report 86 "store-vs-dom" defects for a render layer that was behaving.
      const renderOk = glow.index === null ? storeActive === -1 : glow.index === storeActive
      return {
        phase,
        pos,
        storeActive,
        glowIndex: glow.index,
        expected,
        glowText: glow.text,
        renderOk,
        contractOk: untimed ? storeActive === -1 : expected == null ? null : storeActive === expected,
      }
    }

    // ---- Phase A: forward, driven by the app's own play control -------------------------------
    const playBtn = button('Start playback')
    if (!playBtn) {
      const labels = Array.from(document.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label')).slice(0, 12)
      throw new Error(`no "Start playback" control; buttons present: ${labels.join(' | ')}`)
    }
    const startPos = usePlayerStore.getState().position
    playBtn.click()
    say(`phase A: clicked Start playback at ${startPos.toFixed(2)}s`)
    const playing = await new Promise<boolean>((resolve) => {
      const deadline = Date.now() + 3000
      const tick = () => {
        if (usePlayerStore.getState().playbackState === 'playing') return resolve(true)
        if (Date.now() > deadline) return resolve(false)
        setTimeout(tick, 50)
      }
      tick()
    })

    const aDeadline = Date.now() + PHASE_A_MS
    let lastSay = 0
    while (Date.now() < aDeadline) {
      await new Promise((r) => setTimeout(r, SAMPLE_MS))
      const s = await takeSample('forward')
      if (!s) continue
      samples.push(s)
      if (Date.now() - lastSay > 10_000) {
        lastSay = Date.now()
        say(`phase A progress: pos=${s.pos.toFixed(1)}s storeActive=${s.storeActive} glow=${s.glowIndex}`)
      }
    }
    const endPos = usePlayerStore.getState().position
    const pauseBtn = button('Pause playback')
    pauseBtn?.click()
    await settle(200)
    say(`phase A done: pos ${startPos.toFixed(2)} -> ${endPos.toFixed(2)}s (${samples.length} samples)`)

    // ---- Phase B: backward, driven by the app's own rewind control ----------------------------
    // Skipped in untimed mode: with nothing timed there is no backward case to distinguish, and
    // the forward pass already answers the only question this mode asks.
    const rewindBtn = untimed ? null : button('Rewind 5 seconds')
    const backSamples: Sample[] = []
    if (rewindBtn) {
      const before = usePlayerStore.getState().position
      for (let i = 0; i < REWIND_STEPS; i++) {
        rewindBtn.click()
        const s = await takeSample('backward')
        if (s) {
          samples.push(s)
          backSamples.push(s)
        }
      }
      say(`phase B: ${REWIND_STEPS} rewind clicks from ${before.toFixed(1)}s -> ${usePlayerStore.getState().position.toFixed(1)}s`)
    } else {
      say('phase B skipped: no "Rewind 5 seconds" control')
    }

    // ---- Report ------------------------------------------------------------------------------
    const scored = (arr: Sample[]) => arr.filter((s) => s.contractOk !== null)
    const forward = samples.filter((s) => s.phase === 'forward')
    const summarize = (arr: Sample[]) => {
      const sc = scored(arr)
      return {
        samples: arr.length,
        scored: sc.length,
        matched: sc.filter((s) => s.contractOk).length,
        mismatched: sc.filter((s) => s.contractOk === false).length,
        renderMismatches: arr.filter((s) => !s.renderOk).length,
        linesVisited: new Set(arr.filter((s) => s.glowIndex != null).map((s) => s.glowIndex)).size,
      }
    }
    /** Positive = the highlight jumped BACKWARD while the playhead moved forward.
     *
     *  Scored samples only. The guitar fixture times 24 of its 47 rows, and an untimed row has no
     *  span of its own (`lineEffectiveEnd` hands it the next row's start), so playback legitimately
     *  walks from the last untimed row of a run to the first TIMED row after it — index 3 -> 0 at
     *  14.8s here. Counting that as a backward jump made this metric read 3 on a run with zero
     *  mismatches, which is exactly the kind of number that numbs a reader. Inside truth spans the
     *  index can only stay or advance, so any decrease there is real. */
    let worstMono = 0
    const scoredForward = forward.filter((s) => s.contractOk !== null)
    for (let i = 1; i < scoredForward.length; i++) {
      const a = scoredForward[i - 1]
      const b = scoredForward[i]
      if (a.glowIndex != null && b.glowIndex != null) {
        worstMono = Math.max(worstMono, a.glowIndex - b.glowIndex)
      }
    }
    const advanced = endPos - startPos
    const fwd = summarize(forward)
    // In untimed mode `linesVisited` is 0 on a PASS — nothing should ever glow — so the timed-mode
    // coverage floor would report a correct run as inconclusive.
    const inconclusive =
      !playing ||
      advanced < MIN_ADVANCE_S ||
      fwd.scored < MIN_SCORED_SAMPLES ||
      (!untimed && fwd.linesVisited < MIN_LINES_VISITED)

    const failures = samples
      .filter((s) => s.contractOk === false || !s.renderOk)
      .slice(0, 12)
      .map((s) => ({
        phase: s.phase,
        pos: +s.pos.toFixed(2),
        expected: s.expected,
        storeActive: s.storeActive,
        glowIndex: s.glowIndex,
        glowText: (s.glowText ?? '').slice(0, 24),
        kind: !s.renderOk ? 'store-vs-dom' : 'app-vs-truth',
      }))

    beacon({
      browser: 'sync-harness',
      final: true,
      song: songName,
      duration: +durationSec.toFixed(1),
      started: playing,
      advanced: +advanced.toFixed(2),
      inconclusive,
      mode: untimed ? 'untimed' : 'timed',
      reason: inconclusive
        ? `started=${playing} advanced=${advanced.toFixed(2)}s visited=${fwd.linesVisited} scored=${fwd.scored}`
        : null,
      /** In untimed mode this is the number that must be ZERO. */
      glowSamples: forward.filter((s) => s.glowIndex != null).length,
      storeActiveSeen: [...new Set(forward.map((s) => s.storeActive))].slice(0, 8),
      forward: fwd,
      backward: summarize(backSamples),
      /** Positive = the highlight jumped BACKWARD while the playhead moved forward. */
      worstBackwardGlowJump: worstMono,
      failures,
    })
    say(
      inconclusive
        ? 'INCONCLUSIVE — see report'
        : untimed
          ? `DONE untimed: ${fwd.scored} samples, AND ${fwd.mismatched} of them highlighted a line (want 0)`
          : `DONE forward ${fwd.matched}/${fwd.scored} matched, backward ${summarize(backSamples).matched}/${summarize(backSamples).scored}`,
    )

    await deleteAudio(songId).catch(() => {})
    await db.songs.delete(songId).catch(() => {})
  } catch (err) {
    beacon({ browser: 'sync-harness', final: true, error: String((err as Error)?.message ?? err) })
  }
}
