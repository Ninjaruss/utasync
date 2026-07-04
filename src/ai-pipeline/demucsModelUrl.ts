/**
 * URL of the vocal-separation (MDX-Net / "Demucs") ONNX model.
 *
 * This is a bespoke model with no canonical public host, so — like the Whisper
 * model — it can be fetched from a remote host at runtime instead of being
 * shipped in the build. Set `VITE_DEMUCS_MODEL_URL` at build time to a
 * CORS-enabled URL (the host must allow GET and HEAD from this origin); the
 * browser/service worker caches it after the first download. When unset it falls
 * back to the app-local `/models/demucs-v1.onnx`.
 *
 * Imported by both the main thread (availability probe) and the worker (session
 * load) so the two never disagree on where the model lives.
 */
export const DEMUCS_MODEL_URL: string =
  import.meta.env.VITE_DEMUCS_MODEL_URL || '/models/demucs-v1.onnx'
