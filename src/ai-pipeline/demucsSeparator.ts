/** On-device vocal separation via Demucs ONNX (full-tier, opt-in). */
import { DEMUCS_MODEL_URL } from './demucsModelUrl'
import type { SeparationProvider } from './separationProvider'
import {
  etaPromptThresholdMs,
  STALL_TIMEOUT_MS,
  LOAD_STALL_TIMEOUT_MS,
  CANCEL_POLL_MS,
  acceptedCapMs,
  projectSeparationMs,
  separationCapMs,
} from './separationEta'

const NEGATIVE_CACHE_MS = 15_000

let modelAvailable: boolean | null = null
let lastCheckedMs = 0

/** HEAD-check whether the Demucs ONNX model is reachable (local file or the
 * configured remote host; the host must allow a CORS HEAD request). */
export async function isDemucsModelAvailable(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && modelAvailable === true) return true
  if (!force && modelAvailable === false && now - lastCheckedMs < NEGATIVE_CACHE_MS) {
    return false
  }

  try {
    const res = await fetch(DEMUCS_MODEL_URL, { method: 'HEAD' })
    // `res.ok` alone is not enough: a SPA rewrite (vercel.json sends every
    // unmatched path to index.html, HEAD included) answers a MISSING model with
    // 200 text/html, so isolation would be advertised, then fail inside ORT with
    // an unparseable model and surface as "unavailable" instead of "not found".
    // A real ONNX binary is never served as HTML.
    const contentType = res.headers?.get?.('content-type') ?? ''
    modelAvailable = res.ok && !/text\/html/i.test(contentType)
  } catch {
    modelAvailable = false
  }
  lastCheckedMs = now
  return modelAvailable
}

/** Re-probes model availability (e.g. after placing the ONNX file). */
export async function refreshDemucsModelAvailability(): Promise<boolean> {
  return isDemucsModelAvailable(true)
}

/** Clears cached availability (tests). */
export function resetDemucsModelCache(): void {
  modelAvailable = null
  lastCheckedMs = 0
}

export type { SeparationProvider }

/** Why a separation run ended without producing a stem. Each maps to different
 * user-facing copy; all of them route into the same raw-mix fallback. */
export type AbandonReason = 'skipped' | 'timeout' | 'stalled'

/** Distinguishes "separation gave up" from "separation crashed" so the caller
 * can explain which one happened. Both fall back to the raw mix. */
export class SeparationAbandonedError extends Error {
  // Declared explicitly rather than as a constructor parameter property: this
  // project builds with `erasableSyntaxOnly`.
  readonly reason: AbandonReason

  constructor(reason: AbandonReason, message: string) {
    super(message)
    this.name = 'SeparationAbandonedError'
    this.reason = reason
  }
}

export interface SeparateVocalsOptions {
  sampleRate?: number
  /** Audio length in seconds — sizes the hard cap. Omitting it uses the floor. */
  durationSec?: number
  onProgress?: (progress: number) => void
  /** Fires once, with the provider the worker's session actually resolved to. */
  onProvider?: (provider: SeparationProvider) => void
  /**
   * Fires at most once, after the first chunk, and only when the projected total
   * exceeds etaPromptThresholdMs(durationSec). Resolve 'skip' to abandon separation;
   * 'continue' accepts the wait and raises the cap accordingly.
   */
  onLongEstimate?: (projectedMs: number) => Promise<'skip' | 'continue'>
  /**
   * Preferred cancellation path. Unlike `isCancelled`, aborting terminates the
   * worker immediately rather than waiting for it to send a progress message —
   * which a wedged session.run() never does.
   *
   * Assumed to be a fresh per-run AbortController. The abort listener is not
   * removed when a run settles normally, so a single long-lived signal shared
   * across many separations would accumulate listeners.
   */
  signal?: AbortSignal
  /** Legacy polling cancellation, checked on each progress message. Retained for
   * gapRecovery; new callers should use `signal`. */
  isCancelled?: () => boolean
}

/** The Demucs worker resamples its input to the model's 44100 Hz and returns
 * vocals at THAT rate — never the caller's input rate. Callers must treat the
 * returned buffer as 44100 Hz: feeding it onward under the original rate (e.g.
 * a 48000 Hz AudioContext decode) uniformly scales every downstream Whisper
 * timestamp by the rate ratio (~8.8%), which desyncs the whole song. */
export const DEMUCS_OUTPUT_SAMPLE_RATE = 44100

/**
 * Isolates vocals from mono PCM via the Demucs worker. The returned audio is at
 * DEMUCS_OUTPUT_SAMPLE_RATE regardless of the input rate.
 *
 * THROWS on every failure (model missing, worker error, stall, cap, cancel) —
 * it never falls back to returning the input. Both callers rely on that: they
 * keep the decoded mix they already hold and transcribe that instead.
 */
export async function separateVocals(
  audioData: Float32Array,
  options?: SeparateVocalsOptions,
): Promise<Float32Array> {
  if (!(await isDemucsModelAvailable())) {
    throw new Error(
      `Vocal separation model not found at ${DEMUCS_MODEL_URL}. It is downloaded to public/models/ by scripts/download-models.mjs — see docs/DEPLOYMENT.md.`,
    )
  }

  if (options?.signal?.aborted) throw new Error('cancelled')

  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })

  let settled = false
  let askedEstimate = false
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let cancelTimer: ReturnType<typeof setInterval> | undefined
  let capMs = separationCapMs(options?.durationSec ?? 0)

  try {
    return await new Promise<Float32Array>((resolve, reject) => {
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(stallTimer)
        clearTimeout(loadTimer)
        clearTimeout(capTimer)
        clearInterval(cancelTimer)
        fn()
      }
      const fail = (err: Error) =>
        settle(() => {
          worker.terminate()
          reject(err)
        })

      /** Re-armed on every progress message: catches a wedge in 90s rather than
       * making the user wait out the whole cap. Inference only — see armLoad. */
      const armStall = () => {
        clearTimeout(stallTimer)
        stallTimer = setTimeout(
          () =>
            fail(
              new SeparationAbandonedError(
                'stalled',
                `Vocal separation produced no progress for ${Math.round(STALL_TIMEOUT_MS / 1000)}s`,
              ),
            ),
          STALL_TIMEOUT_MS,
        )
      }

      /** The model fetch + session init, which report no progress at all. Kept
       * apart from armStall so a slow (but healthy) download is not reported as
       * a hung worker — and so a load that never completes is still caught,
       * which nothing used to do: neither timer was armed until the worker's
       * first message, so a worker that hung before replying never settled. */
      const armLoad = () => {
        clearTimeout(loadTimer)
        loadTimer = setTimeout(
          () =>
            fail(
              new SeparationAbandonedError(
                'stalled',
                `Vocal separation's model load produced no response for ${Math.round(LOAD_STALL_TIMEOUT_MS / 1000)}s`,
              ),
            ),
          LOAD_STALL_TIMEOUT_MS,
        )
      }

      const armCap = (ms: number) => {
        capMs = ms
        clearTimeout(capTimer)
        capTimer = setTimeout(
          () =>
            fail(new SeparationAbandonedError('timeout', 'Vocal separation exceeded its time budget')),
          ms,
        )
      }

      // Abort does not depend on the worker being responsive — that dependency
      // was the original bug.
      options?.signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true })

      // gapRecovery's callers still pass the legacy polling callback instead of
      // a signal, and it was only read on progress messages — so a Cancel during
      // a wedged session.run() left the worker burning CPU for up to the full
      // stall timeout after the user asked it to stop.
      if (options?.isCancelled) {
        cancelTimer = setInterval(() => {
          if (options.isCancelled?.()) fail(new Error('cancelled'))
        }, CANCEL_POLL_MS)
      }

      // Both bounds run from the moment the worker is asked to load, because
      // that is when the run's real cost starts: the download IS part of what the
      // user is waiting for.
      armLoad()
      armCap(capMs)

      const maybeAskEstimate = (payload: {
        chunk?: number
        nChunks?: number
        elapsedMs?: number
      }) => {
        if (askedEstimate || !options?.onLongEstimate) return
        const projected = projectSeparationMs(
          payload?.chunk ?? 0,
          payload?.nChunks ?? 0,
          payload?.elapsedMs ?? 0,
        )
        if (projected === null || projected <= etaPromptThresholdMs(options?.durationSec ?? 0)) return
        askedEstimate = true
        void options
          .onLongEstimate(projected)
          .then((choice) => {
            if (settled) return
            if (choice === 'skip') {
              fail(new SeparationAbandonedError('skipped', 'Vocal separation skipped by the user'))
            } else {
              // The user accepted this wait; the default cap must not pre-empt it.
              armCap(Math.max(capMs, acceptedCapMs(projected)))
            }
          })
          .catch((err) => {
            // Not fatal — the cap and watchdog still bound the run — but a prompt
            // that throws will never ask again (askedEstimate stays true), so it
            // must not fail invisibly.
            console.error('[demucsSeparator] onLongEstimate rejected', err)
          })
      }

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data
        if (type === 'loaded') {
          // A message can still be delivered after the run settled (terminate()
          // races the queue): without this guard the clamps below would re-arm
          // both timers and clone the whole song for a worker that is gone.
          if (settled) return
          clearTimeout(loadTimer)
          if (payload?.provider) options?.onProvider?.(payload.provider as SeparationProvider)
          armStall()
          // The cap is NOT re-armed here: it bounds the entire run, download
          // included, rather than resetting the clock once the model is up.
          // Clone before transfer — the worker takes ownership of the buffer and
          // cancel/retry must not neuter the caller's decoded audio.
          const pcm = new Float32Array(audioData)
          worker.postMessage(
            {
              type: 'separate',
              payload: { audioData: pcm, sampleRate: options?.sampleRate ?? 44100 },
            },
            [pcm.buffer],
          )
        } else if (type === 'result') {
          settle(() => resolve(payload as Float32Array))
        } else if (type === 'error') {
          fail(new Error(String(payload)))
        } else if (type === 'progress') {
          // terminate() should stop further messages, but that is the worker's
          // invariant, not this closure's — re-arming timers after the run ended
          // would resurrect a settled run.
          if (settled) return
          if (options?.isCancelled?.()) {
            fail(new Error('cancelled'))
            return
          }
          // A load-phase message is a download heartbeat, not inference: it
          // extends the load budget and must not be judged by the 90s inference
          // watchdog (that was the false "stopped responding" on slow links).
          if (payload?.status === 'loading') armLoad()
          else armStall()
          options?.onProgress?.(payload?.progress ?? 0)
          maybeAskEstimate(payload ?? {})
        }
      }
      worker.onerror = () => fail(new Error('Vocal separation worker failed'))
      worker.postMessage({ type: 'load' })
    })
  } finally {
    clearTimeout(stallTimer)
    clearTimeout(loadTimer)
    clearTimeout(capTimer)
    clearInterval(cancelTimer)
    worker.terminate()
  }
}
