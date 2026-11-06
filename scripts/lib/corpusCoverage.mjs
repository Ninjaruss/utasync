// Pure: decides whether a benchmark run measured enough to mean anything.
export function coverageVerdict({ expected, scored, skipped }) {
  const scoredCount = scored.length
  const shortfall = Math.max(0, expected - scoredCount)
  return { expected, scoredCount, shortfall, ok: scoredCount > 0 && shortfall === 0, skipped }
}

// A song counts as scored only if some attempt really produced scored lines.
export function songCoverage(attempts) {
  if (attempts.some(a => a.status === 'SCORED' && a.scoredLines > 0)) return { scored: true }
  if (!attempts.length) return { scored: false, reason: 'no run recorded' }
  return { scored: false, reason: `no SCORED attempt (statuses: ${[...new Set(attempts.map(a => a.status))].join(', ')})` }
}

// Rule 6: sanitises an exception into a reason that is safe to print. Node errno messages keep only
// their code and summary (paths withheld); a SyntaxError is reduced to a fixed string; any other
// message is passed through truncated to 120 chars with quoted spans redacted. That last branch
// is NOT a guarantee: an unquoted lyric fragment in a message would survive, so callers must
// throw messages that never contain lyric text.
export function safeSkipReason(e) {
  const m = String(e?.message ?? '')
  if (e instanceof SyntaxError) return 'SyntaxError: unparseable JSON (message withheld)'
  if (/^[A-Z]{3,}: /.test(m)) return `${m.split(', ')[0].split("'")[0].trim().slice(0, 80)} (path withheld)`
  return `${e?.name ?? 'Error'}: ${m.replace(/["'`][^"'`]*["'`]/g, '<…>').slice(0, 120)}`
}
