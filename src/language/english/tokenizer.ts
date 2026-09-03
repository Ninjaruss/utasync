import type { Token } from '../../core/types'

// NOTE: this does NOT match what compromise v14 actually returns — verified in
// the browser, `json()` yields `{ text, terms: [{ tags: string[], offset }] }`,
// with no top-level `tags` and no `offset` unless `json({ offset: true })` is
// passed. So `tokenizeEnglish` throws on its first term and the caller in
// enrichLines swallows it, leaving English lines unenriched. Kept as-is here so
// this change stays purely about load cost; the shape fix is tracked separately.
type CompromiseTerm = {
  text: string
  offset: { start: number; length: number }
  tags: Record<string, boolean>
}

/**
 * `compromise` is ~330KB unminified — the single largest item in the main
 * bundle, ahead of react-dom — and nothing on the path to first paint touches
 * it: English tokenizing runs only from background lyric enrichment, after the
 * app is already interactive. Loading it on demand keeps it out of the initial
 * download; the module cache makes every call after the first free.
 *
 * The in-flight promise is dropped on failure (mirroring getKuroshiro) so a
 * transient chunk-load error doesn't poison every later call.
 */
let nlpPromise: Promise<typeof import('compromise').default> | null = null

function getNlp(): Promise<typeof import('compromise').default> {
  if (!nlpPromise) {
    nlpPromise = import('compromise')
      .then((m) => m.default)
      .catch((err) => {
        nlpPromise = null
        throw err
      })
  }
  return nlpPromise
}

export async function tokenizeEnglish(text: string): Promise<Token[]> {
  const nlp = await getNlp()
  const doc = nlp(text)
  const terms = doc.terms().json() as CompromiseTerm[]
  return terms.map((t): Token => ({
    surface: t.text,
    pos: Object.keys(t.tags)[0] ?? 'unknown',
    startIndex: t.offset.start,
    endIndex: t.offset.start + t.offset.length,
  }))
}
