// src/ai-pipeline/forcedAlign/viterbi.ts
export interface TokenSpan {
  tokenIndex: number // index into the target token array
  tokenId: number
  startFrame: number
  endFrame: number // inclusive
}

/**
 * CTC forced alignment (torchaudio-style). `emissions[t][v]` are LOG-probabilities
 * for frame t, vocab id v. `tokens` is the target token-id sequence (no blanks).
 * Returns the frame span each target token occupies along the single most likely
 * monotonic path. `blankId` is the CTC blank vocab id.
 */
export function forcedAlignCTC(
  emissions: readonly (readonly number[])[],
  tokens: readonly number[],
  blankId: number,
): TokenSpan[] {
  const T = emissions.length
  const N = tokens.length
  if (N === 0 || T === 0) return []
  const NEG = -Infinity
  const trellis: number[][] = Array.from({ length: T + 1 }, () => new Array(N + 1).fill(NEG))
  const back: number[][] = Array.from({ length: T + 1 }, () => new Array(N + 1).fill(0)) // 0=stay, 1=advance
  trellis[0][0] = 0
  for (let t = 1; t <= T; t++) {
    const em = emissions[t - 1]
    for (let j = 0; j <= N; j++) {
      const stayEmit = j > 0 ? Math.max(em[blankId], em[tokens[j - 1]]) : em[blankId]
      const stay = trellis[t - 1][j] + stayEmit
      const advance = j > 0 ? trellis[t - 1][j - 1] + em[tokens[j - 1]] : NEG
      if (advance > stay) { trellis[t][j] = advance; back[t][j] = 1 }
      else { trellis[t][j] = stay; back[t][j] = 0 }
    }
  }
  const endFrameOf = new Array<number>(N).fill(-1)
  const startFrameOf = new Array<number>(N).fill(-1)
  let j = N
  for (let t = T; t >= 1 && j > 0; t--) {
    const em = emissions[t - 1]
    // A frame at position j counts toward the token only if the token LABEL was
    // the emitted symbol here. On an advance this is guaranteed; on a stay the
    // path may instead have emitted a blank (stayEmit = max(blank, token)), and
    // such trailing/interior blank frames must not extend the token's span.
    const emittedTokenLabel = back[t][j] === 1 || em[tokens[j - 1]] >= em[blankId]
    // Walking backward, the first token-label frame seen is the token's last one.
    if (emittedTokenLabel && endFrameOf[j - 1] < 0) endFrameOf[j - 1] = t - 1
    if (back[t][j] === 1) {
      startFrameOf[j - 1] = t - 1
      j--
    }
  }
  const spans: TokenSpan[] = []
  for (let k = 0; k < N; k++) {
    const start = startFrameOf[k] < 0 ? 0 : startFrameOf[k]
    const end = endFrameOf[k] < 0 ? start : endFrameOf[k]
    spans.push({ tokenIndex: k, tokenId: tokens[k], startFrame: start, endFrame: Math.max(start, end) })
  }
  return spans
}
