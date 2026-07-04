# Vocal Separation Model — Design Spec

**Date:** 2026-07-04  
**Status:** Approved

## Goal

Enable the vocal separation toggle in the auto-align flow by implementing a real MDX-Net ONNX inference pipeline in the browser. The toggle is already gated on full-tier devices (WebGPU + 6 GB RAM) and model availability — this spec fills in the missing model and worker logic.

## Model

**Kim_Vocal_2.onnx** from the UVR (Ultimate Vocal Remover) project GitHub releases.

- Size: ~62 MB
- Sample rate: 44100 Hz
- Architecture: MDX-Net (Music Demixing Network)
- Input shape: `[1, 4, 3072, 256]` — batch × stereo-complex channels × frequency bins × time frames
- Output shape: `[1, 4, 3072, 256]` — separated vocal spectrogram (same shape as input)
- Parameters: `n_fft=7680`, `hop=1024`, `dim_f=3072`, `dim_t=256`

## Hosting

- Download from UVR project GitHub releases (public asset)
- Upload as release asset to `Ninjaruss/utasync`, tag `models-v1`
- Permanent URL: `https://github.com/Ninjaruss/utasync/releases/download/models-v1/Kim_Vocal_2.onnx`
- Set `VITE_DEMUCS_MODEL_URL` to this URL in Vercel environment variables and `.env.local`
- Service worker caches the file after first download (30-day retention, Cache Storage)

## Architecture

### New file: `src/ai-pipeline/fft.ts`

Pure TypeScript Cooley-Tukey radix-2 FFT. Exports only two functions:

```ts
stft(audio: Float32Array, nFft: number, hop: number, window: Float32Array): { real: Float32Array[], imag: Float32Array[] }
istft(real: Float32Array[], imag: Float32Array[], nFft: number, hop: number, window: Float32Array, length: number): Float32Array
```

No dependencies. Works in Web Workers (no Web Audio API needed). Used only by `demucs.worker.ts`.

### Rewritten: `src/ai-pipeline/demucs.worker.ts`

Full pipeline for one song:

```
Input: mono Float32Array at any sample rate

1. Resample to 44100 Hz (linear interpolation)
2. Duplicate mono → fake stereo [2, N]
3. STFT (Hann window, n_fft=7680, hop=1024)
   → complex spectrogram: 4 Float32Arrays (L_real, L_imag, R_real, R_imag)
   → shape: [4, n_bins, time_frames], n_bins = n_fft/2+1 = 3841
4. Pad time axis so it divides evenly into dim_t=256 chunks with 75% overlap
5. For each overlapping chunk:
   a. Slice [4, dim_f=3072, dim_t=256] from spectrogram (trim to dim_f bins)
   b. Pack into Float32 tensor [1, 4, 3072, 256]
   c. Run ONNX session
   d. Unpack output vocal chunk
   e. Overlap-add into output spectrogram buffer
   f. Post progress message (chunk_idx / total_chunks → 10–95%)
6. ISTFT output spectrogram → stereo waveform
7. Average L+R → mono Float32Array at 44100 Hz

Output: mono vocals Float32Array
```

Model parameters are defined as named constants at the top of the file so swapping models requires only changing those values.

### Updated: `src/ai-pipeline/demucsModelUrl.ts`

Change the fallback filename from `demucs-v1.onnx` to `Kim_Vocal_2.onnx` to match the actual file:

```ts
export const DEMUCS_MODEL_URL: string =
  import.meta.env.VITE_DEMUCS_MODEL_URL || '/models/Kim_Vocal_2.onnx'
```

## Files Changed

| File | Change |
|---|---|
| `src/ai-pipeline/fft.ts` | New — Cooley-Tukey FFT, STFT, ISTFT |
| `src/ai-pipeline/demucs.worker.ts` | Rewrite — real MDX-Net chunked inference |
| `src/ai-pipeline/demucsModelUrl.ts` | 1-line update — fallback filename |

No changes to `demucsSeparator.ts`, `AutoAlignFlow.tsx`, `vite.config.ts`, or any test files — the existing availability probe, UI gating, and service worker cache rule all work as-is.

## Error Handling

- ONNX session creation failure → worker posts `{ type: 'error' }` → UI shows "Failed to load vocal separation model" (already handled)
- Chunk inference failure → same error path
- Model not reachable → `isDemucsModelAvailable()` returns false → toggle stays disabled (already handled)
- Resampling edge cases (very short audio, sample rate already 44100) → handled inline, no throws

## Testing

- `tsc` and existing 928 tests must continue to pass (no test changes needed)
- Manual: import a song, enable "Isolate vocals first", run auto-align — verify progress bar advances and final alignment confidence improves vs. without separation
- Regression: AKFG ground-truth tests must still pass (alignment pipeline is unchanged)

## Deployment Steps

1. Download `Kim_Vocal_2.onnx` from UVR GitHub releases
2. `gh release create models-v1 Kim_Vocal_2.onnx --repo Ninjaruss/utasync --title "AI Models v1"`
3. Set `VITE_DEMUCS_MODEL_URL` in Vercel project environment variables
4. Redeploy
