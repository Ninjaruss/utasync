/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** CORS-enabled URL for the vocal-separation ONNX model, fetched at runtime
   * instead of shipping it in the build. Falls back to /models/demucs-v1.onnx. */
  readonly VITE_DEMUCS_MODEL_URL?: string
}
