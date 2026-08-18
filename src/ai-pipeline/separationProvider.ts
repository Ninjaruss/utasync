/** The ONNX execution provider a separation run actually resolved to.
 * Lives in its own module so the worker and the host share one definition
 * rather than hand-syncing two — same reason as demucsModelUrl.ts. */
export type SeparationProvider = 'webgpu' | 'wasm'
