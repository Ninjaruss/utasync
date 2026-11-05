// Pure: decides whether a benchmark run measured enough to mean anything.
export function coverageVerdict({ expected, scored, skipped }) {
  const scoredCount = scored.length
  const shortfall = Math.max(0, expected - scoredCount)
  return { expected, scoredCount, shortfall, ok: scoredCount > 0 && shortfall === 0, skipped }
}
