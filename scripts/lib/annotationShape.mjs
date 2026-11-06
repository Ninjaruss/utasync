import { LYRIC_HASH_VERSION } from './lyricHash.mjs'
import { isKnownKind } from './truthKinds.mjs'

// Pure shape-and-kind check of one parsed annotation. Returns violation strings; never prints, never names lyric text (ADR-0004).
export function annotationViolations(a) {
  const out = []
  const bad = what => { out.push(what) }
  if (!isKnownKind(a.kind)) bad(`unknown kind ${JSON.stringify(a.kind)}`)
  if (a.lineHashVersion !== LYRIC_HASH_VERSION) bad(`lineHashVersion ${JSON.stringify(a.lineHashVersion)} is not the current ${LYRIC_HASH_VERSION}`)
  for (const k of ['audioSha256', 'lyricsSha256']) if (typeof a[k] !== 'string' || !/^[0-9a-f]{64}$/.test(a[k])) bad(`missing or malformed ${k}`)
  if (!Array.isArray(a.lines)) { bad('lines is not an array'); return out }
  if (a.lines.length === 0) { bad('lines is empty; an annotation with no lines verifies nothing'); return out }
  const notObj = a.lines.flatMap((l, i) => l !== null && typeof l === 'object' && !Array.isArray(l) ? [] : [i + 1])
  if (notObj.length) { bad(`${notObj.length} line entr(ies) are not objects (first: line ${notObj[0]})`); return out }
  const withText = a.lines.flatMap((l, i) => 'text' in l ? [i + 1] : [])
  if (withText.length) bad(`carries a text field on ${withText.length} line(s) (first: line ${withText[0]}); song text must not be committed`)
  const noHash = a.lines.flatMap((l, i) => typeof l.textHash === 'string' && /^[0-9a-f]{64}$/.test(l.textHash) ? [] : [i + 1])
  if (noHash.length) bad(`missing or malformed textHash on ${noHash.length} line(s) (first: line ${noHash[0]})`)
  return out
}

// A manifest entry must not understate (or overstate) the truth its annotation file declares: gates count songs by kind.
export function kindAgreementViolation(manifestKind, annotation) {
  if (manifestKind === annotation?.kind) return null
  return `manifest reference.kind ${JSON.stringify(manifestKind)} disagrees with the annotation's own kind ${JSON.stringify(annotation?.kind)}`
}
