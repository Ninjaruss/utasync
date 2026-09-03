import type { Token } from '../../core/types'

/**
 * What compromise v14 actually returns from `doc.terms().json({ offset: true })`.
 *
 * Written out rather than cast: the previous shape here was invented — a
 * top-level `tags` object and an `offset` that only exists when asked for — and
 * an `as` cast let it typecheck while throwing on the first term of every line.
 * Tags live on the nested term, not the wrapper.
 */
type CompromiseTerm = {
  text: string
  offset?: { start: number; length: number }
  terms?: { text?: string; tags?: string[] }[]
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
  if (!text.trim()) return []
  const nlp = await getNlp()
  // `{ offset: true }` is required — without it there are no offsets at all, and
  // startIndex/endIndex come out NaN.
  const terms = nlp(text).terms().json({ offset: true }) as CompromiseTerm[]
  const tokens: Token[] = []
  for (const term of terms) {
    const offset = term.offset
    // compromise emits zero-width implicit terms (the copula it infers from
    // "Who's"). They have no surface to render, colour or tap, and keeping them
    // would put empty tokens in the display.
    if (!offset || offset.length <= 0) continue
    const surface = term.text
    if (!surface.trim()) continue
    tokens.push({
      surface,
      pos: term.terms?.[0]?.tags?.[0] ?? 'unknown',
      startIndex: offset.start,
      endIndex: offset.start + offset.length,
    })
  }
  return tokens
}
