import { createHash } from 'node:crypto'
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const lyricLines = text => text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
export function requireAccess(song, heldout = false) {
  if (song.split === 'heldout' && !heldout) throw new Error('Held-out song: explicit --heldout required; do not tune against this result')
}
export function scoreRun(song, texts, run, annotation, target = { fractionWithinHalfSecond: .9, maxErrorSeconds: 2 }) {
  if (!Number.isFinite(target.fractionWithinHalfSecond) || target.fractionWithinHalfSecond < 0 || target.fractionWithinHalfSecond > 1 || !Number.isFinite(target.maxErrorSeconds) || target.maxErrorSeconds < 0) throw new Error('Invalid accuracy target')
  if (run.song !== song.id) throw new Error('Run song mismatch')
  if (run.workflow !== 'AutoAlignFlow') throw new Error('Not a real AutoAlignFlow run')
  const base = { song: song.id, split: song.split, runId: run.runId, totalLines: texts.length, status: run.status, reference: annotation?.kind ?? 'none' }
  const inputVerified = run.audioSha256 === song.audioSha256 && run.lyricsSha256 === song.lyricsSha256
  if (run.status !== 'completed') return { ...base, inputVerified, eligibleForAccuracyClaim: false, scoredLines: 0, pass: null }
  if (!inputVerified) throw new Error('Run input hash mismatch')
  if (!annotation) return { ...base, status: 'UNSCORED', eligibleForAccuracyClaim: false, scoredLines: 0, pass: null }
  if (annotation.audioSha256 !== song.audioSha256 || annotation.lyricsSha256 !== song.lyricsSha256) throw new Error('Annotation input hash mismatch')
  if (!['human-onsets', 'coarse-captions'].includes(annotation.kind)) throw new Error('Unverified reference cannot score accuracy')
  if (annotation.lines.length !== texts.length || annotation.lines.some((l, i) => l.text !== texts[i])) throw new Error('Annotation lyric/order mismatch')
  const details = []
  for (let i = 0; i < texts.length; i++) {
    const a = annotation.lines[i]
    if (a.onset === null || a.onset === undefined || a.excluded) continue
    if (!Number.isFinite(a.onset) || a.onset < 0 || !Number.isFinite(a.uncertainty) || a.uncertainty < 0) throw new Error('Invalid reference interval')
    const p = run.lines?.[i]
    const missing = !p || p.original !== texts[i] || !Number.isFinite(p.startTime) || p.startTime < 0
    const error = missing ? null : Math.abs(p.startTime - a.onset)
    details.push({ line: i + 1, missing, error, outsideInterval: missing ? null : Math.max(0, error - a.uncertainty), withinHalfSecond: !missing && error <= .5, withinReferenceTolerance: !missing && error <= a.uncertainty })
  }
  const errors = details.filter(x => !x.missing).map(x => x.error).sort((a, b) => a - b)
  const n = details.length, missing = details.filter(x => x.missing).length
  const unexpected = Math.max(0, (run.lines?.length ?? 0) - texts.length)
  const precise = annotation.kind === 'human-onsets' && annotation.predictionsShown === false && annotation.priorPredictionExposure === 'none' && annotation.status === 'adjudicated' && !!annotation.reviewer?.trim() && n > 0 && n === texts.length && annotation.lines.every(l => !l.excluded && l.uncertainty <= .25)
  const median = errors.length ? (errors[Math.floor((errors.length - 1) / 2)] + errors[Math.floor(errors.length / 2)]) / 2 : null
  const within = details.filter(x => x.withinHalfSecond).length
  return { ...base, status: n ? 'SCORED' : 'UNSCORED', scoredLines: n, missingPredictions: missing, unexpectedPredictions: unexpected, eligibleForAccuracyClaim: precise, pass: precise ? missing === 0 && unexpected === 0 && within / n >= target.fractionWithinHalfSecond && errors.at(-1) <= target.maxErrorSeconds : null, withinHalfSecond: within, withinReferenceTolerance: details.filter(x => x.withinReferenceTolerance).length, medianAbsoluteError: median, p90AbsoluteError: errors.length ? errors[Math.ceil(.9 * errors.length) - 1] : null, worstAbsoluteError: errors.at(-1) ?? null, details }
}
