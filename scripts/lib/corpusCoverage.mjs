// Pure: decides whether a benchmark run measured enough to mean anything.
export function coverageVerdict({ expected, scored, skipped }) {
  const scoredCount = scored.length
  const shortfall = Math.max(0, expected - scoredCount)
  return { expected, scoredCount, shortfall, ok: scoredCount > 0 && shortfall === 0, skipped }
}

// A song counts as scored only if some attempt really produced scored lines.
//
// HAZARD, named rather than guarded: "scored" here does NOT mean "certifiable". Since scoreRun was
// widened to score every kind the truth table allows, a `corpus-onsets` annotation satisfies this
// predicate while its `eligibleForAccuracyClaim` is permanently false (`precise` requires
// kind === 'human-onsets' literally; ADR-0006, Consequences). So a benchmarks/sync coverage floor
// could read "met" with nothing certifiable scored. No such annotation lives in benchmarks/sync
// today — PJS truth sits under experiments/phase0/pjs/annotations and is not in that manifest.
// It is deliberately not guarded here: this predicate answers "did the run measure anything at
// all", and the corpus's own `lrc-derived` and `coarse-captions` songs do not certify either, so
// requiring certification would make the floor unreachable for the corpus as it stands. The place
// to require certification is the caller that makes an accuracy claim — `eligibleForAccuracyClaim`
// in scoreRun, and the ADR-0003 gate in experiments/phase0/score.mjs, both of which do.
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
