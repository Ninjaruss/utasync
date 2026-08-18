/** On-device vocal separation via Demucs ONNX (full-tier, opt-in). */
import { DEMUCS_MODEL_URL } from './demucsModelUrl'
import {
  ETA_PROMPT_THRESHOLD_MS,
  STALL_TIMEOUT_MS,
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
    modelAvailable = res.ok
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

export type SeparationProvider = 'webgpu' | 'wasm'

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
   * exceeds ETA_PROMPT_THRESHOLD_MS. Resolve 'skip' to abandon separation;
   * 'continue' accepts the wait and raises the cap accordingly.
   */
  onLongEstimate?: (projectedMs: number) => Promise<'skip' | 'continue'>
  /**
   * Preferred cancellation path. Unlike `isCancelled`, aborting terminates the
   * worker immediately rather than waiting for it to send a progress message —
   * which a wedged session.run() never does.
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
 * Isolates vocals from mono PCM via the Demucs worker. Returns the original
 * buffer unchanged when separation fails or is cancelled mid-run. The returned
 * audio is at DEMUCS_OUTPUT_SAMPLE_RATE regardless of the input rate.
 */
export async function separateVocals(
  audioData: Float32Array,
  options?: SeparateVocalsOptions,
): Promise<Float32Array> {
  if (!(await isDemucsModelAvailable())) {
    throw new Error(
      'Vocal separation model not found. Place demucs-v1.onnx at public/models/ — see docs/DEPLOYMENT.md.',
    )
  }

  if (options?.signal?.aborted) throw new Error('cancelled')

  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })

  let settled = false
  let askedEstimate = false
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let capMs = separationCapMs(options?.durationSec ?? 0)

  try {
    return await new Promise<Float32Array>((resolve, reject) => {
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(stallTimer)
        clearTimeout(capTimer)
        fn()
      }
      const fail = (err: Error) =>
        settle(() => {
          worker.terminate()
          reject(err)
        })

      /** Re-armed on every progress message: catches a wedge in 90s rather than
       * making the user wait out the whole cap. */
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
        if (projected === null || projected <= ETA_PROMPT_THRESHOLD_MS) return
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
          .catch(() => {
            // A prompt that itself fails must not leave the run unbounded, but it
            // is also not a reason to kill a healthy separation — the cap and the
            // watchdog still apply.
          })
      }

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data
        if (type === 'loaded') {
          if (payload?.provider) options?.onProvider?.(payload.provider as SeparationProvider)
          armStall()
          armCap(capMs)
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
          if (options?.isCancelled?.()) {
            fail(new Error('cancelled'))
            return
          }
          armStall()
          options?.onProgress?.(payload?.progress ?? 0)
          maybeAskEstimate(payload ?? {})
        }
      }
      worker.onerror = () => fail(new Error('Vocal separation worker failed'))
      worker.postMessage({ type: 'load' })
    })
  } finally {
    clearTimeout(stallTimer)
    clearTimeout(capTimer)
    worker.terminate()
  }
}
