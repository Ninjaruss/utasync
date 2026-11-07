// The one vocabulary of reference-truth kinds. Every scorer and guard asks this table; none keeps its own list.
// scores: the kind may be scored against. certifies: a score against it may back an accuracy claim.
const row = (scores, certifies, note) => Object.freeze({ scores, certifies, note })
export const TRUTH_KINDS = Object.freeze({
  'human-onsets': row(true, true, 'Blind human-tapped onsets; the only listened truth.'),
  'corpus-onsets': row(true, true, 'Onsets measured from a corpus with known timing (e.g. PJS medleys), not listened.'),
  'lrc-derived': row(true, false, 'Derived from a catalogue LRC; useful signal, not truth.'),
  'coarse-captions': row(true, false, 'Caption-level timing; too coarse to certify.'),
  'unverified-lrc': row(false, false, 'Planned or unreviewed reference; cannot score.'),
})
export const isKnownKind = kind => typeof kind === 'string' && Object.hasOwn(TRUTH_KINDS, kind)
export const canScore = kind => isKnownKind(kind) && TRUTH_KINDS[kind].scores
export const canCertify = kind => isKnownKind(kind) && TRUTH_KINDS[kind].certifies
