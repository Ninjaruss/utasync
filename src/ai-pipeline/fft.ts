// ---------------------------------------------------------------------------
// FFT, STFT, ISTFT for the Demucs MDX-Net vocal separation worker.
//
// Uses Bluestein's chirp-z transform so n_fft=7680 (not a power of 2) works
// correctly. The power-of-2 fast path keeps 512/1024/... sizes fast in tests.
// ---------------------------------------------------------------------------

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** Radix-2 Cooley-Tukey FFT, in-place. n must be a power of 2. */
function fftPow2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < (len >> 1); j++) {
        const ur = re[i + j], ui = im[i + j]
        const vr = re[i + j + (len >> 1)] * cr - im[i + j + (len >> 1)] * ci
        const vi = re[i + j + (len >> 1)] * ci + im[i + j + (len >> 1)] * cr
        re[i + j] = ur + vr; im[i + j] = ui + vi
        re[i + j + (len >> 1)] = ur - vr; im[i + j + (len >> 1)] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

/**
 * Forward DFT of arbitrary length via Bluestein's chirp-z algorithm.
 * Falls through to radix-2 when n is a power of 2.
 */
function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length
  if (N <= 1) return
  if ((N & (N - 1)) === 0) { fftPow2(re, im); return }

  const M = nextPow2(2 * N)

  // chirp[n] = e^{iπn²/N}
  const cRe = new Float64Array(M)
  const cIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    const ang = Math.PI * n * n / N
    cRe[n] = Math.cos(ang); cIm[n] = Math.sin(ang)
    if (n > 0) { cRe[M - n] = cRe[n]; cIm[M - n] = cIm[n] }
  }

  // y[n] = x[n] * conj(chirp[n])
  const yRe = new Float64Array(M)
  const yIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    yRe[n] = re[n] * cRe[n] + im[n] * cIm[n]
    yIm[n] = im[n] * cRe[n] - re[n] * cIm[n]
  }

  const hRe = cRe.slice(); const hIm = cIm.slice()
  fftPow2(yRe, yIm); fftPow2(hRe, hIm)

  for (let k = 0; k < M; k++) {
    const r = yRe[k] * hRe[k] - yIm[k] * hIm[k]
    yIm[k] = yRe[k] * hIm[k] + yIm[k] * hRe[k]; yRe[k] = r
  }

  // IFFT via conjugate trick
  for (let k = 0; k < M; k++) yIm[k] = -yIm[k]
  fftPow2(yRe, yIm)
  for (let k = 0; k < M; k++) { yRe[k] /= M; yIm[k] = -yIm[k] / M }

  // X[k] = conj(chirp[k]) * g[k]
  for (let k = 0; k < N; k++) {
    re[k] = yRe[k] * cRe[k] + yIm[k] * cIm[k]
    im[k] = yIm[k] * cRe[k] - yRe[k] * cIm[k]
  }
}

/** Inverse DFT of arbitrary length. In-place. */
function ifft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]
  fft(re, im)
  const N = re.length
  for (let i = 0; i < N; i++) { re[i] /= N; im[i] = -im[i] / N }
}

/** Symmetric Hann window of length `size`. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return w
}

export interface StftResult {
  real: Float32Array[]  // [n_bins][n_frames]
  imag: Float32Array[]
  frames: number
}

/**
 * Short-time Fourier transform.
 * Returns one-sided complex spectrogram: n_bins = nFft/2+1, indexed [bin][frame].
 */
export function stft(
  audio: Float32Array,
  nFft: number,
  hop: number,
  win: Float32Array,
): StftResult {
  const nBins = Math.floor(nFft / 2) + 1
  // Center-pad so the first and last frames are centered on the signal edges.
  const pad = Math.floor(nFft / 2)
  const padded = new Float32Array(audio.length + nFft)
  padded.set(audio, pad)

  const frames = Math.floor((padded.length - nFft) / hop) + 1
  const real: Float32Array[] = Array.from({ length: nBins }, () => new Float32Array(frames))
  const imag: Float32Array[] = Array.from({ length: nBins }, () => new Float32Array(frames))

  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)

  for (let f = 0; f < frames; f++) {
    const offset = f * hop
    re.fill(0); im.fill(0)
    for (let i = 0; i < nFft && offset + i < padded.length; i++) {
      re[i] = padded[offset + i] * win[i]
    }
    fft(re, im)
    for (let b = 0; b < nBins; b++) {
      real[b][f] = re[b]
      imag[b][f] = im[b]
    }
  }
  return { real, imag, frames }
}

/**
 * Inverse STFT via overlap-add.
 * real/imag must be indexed [bin][frame] with n_bins = nFft/2+1.
 * Returns audio of exactly `length` samples.
 */
export function istft(
  real: Float32Array[],
  imag: Float32Array[],
  nFft: number,
  hop: number,
  win: Float32Array,
  length: number,
): Float32Array {
  const nBins = real.length
  const frames = real[0].length
  const outLen = (frames - 1) * hop + nFft
  const output = new Float64Array(outLen)
  const wSum = new Float64Array(outLen)

  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)

  for (let f = 0; f < frames; f++) {
    re.fill(0); im.fill(0)
    for (let b = 0; b < nBins; b++) {
      re[b] = real[b][f]; im[b] = imag[b][f]
    }
    // Mirror one-sided → two-sided (real-valued signal)
    for (let b = 1; b < nBins - 1; b++) {
      re[nFft - b] = real[b][f]; im[nFft - b] = -imag[b][f]
    }
    ifft(re, im)
    const offset = f * hop
    for (let i = 0; i < nFft; i++) {
      output[offset + i] += re[i] * win[i]
      wSum[offset + i] += win[i] * win[i]
    }
  }

  // Normalize by window overlap sum, trim center-padding
  const result = new Float32Array(length)
  const pad = Math.floor(nFft / 2)
  for (let i = 0; i < length; i++) {
    const w = wSum[pad + i]
    result[i] = w > 1e-8 ? output[pad + i] / w : 0
  }
  return result
}
