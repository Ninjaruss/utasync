import type { SungPhrase, Token, TimedLine, TimedTranscriptWord } from '../core/types'
import { projectPhraseTokensToLines } from './phraseProjection'

/** Injected so the orchestrator stays testable without the kuromoji / reconciler
 * stack: PlayerView wires the real model-backed implementations. */
export interface PhraseEnrichDeps {
  /** Tokenize a phrase's sung text into Token[] (offsets relative to the phrase). */
  tokenizePhrase: (original: string) => Promise<Token[]>
  /** Gated sung-reading reconciliation against the audio transcript (Phase 0 policy). */
  reconcilePhraseReadings?: (
    phrase: SungPhrase,
    transcriptWords: TimedTranscriptWord[],
  ) => Promise<Token[]>
  /** Word-pair alignment over the phrase (original ↔ translation), stamping
   * `alignmentIndices` into the phrase translation word space (2.3). */
  alignPhraseTokens?: (phrase: SungPhrase) => Promise<Token[]>
}

/** Tokenize and (when a transcript is available) reading-reconcile each canonical
 * phrase. Phrases are the unit of enrichment so readings and word-pairing see the
 * sung text, not the arbitrary paste boundaries. Failures degrade to a tokenless
 * phrase rather than aborting the rest. */
export async function enrichPhraseTokens(
  phrases: SungPhrase[],
  transcriptWords: TimedTranscriptWord[] | undefined,
  deps: PhraseEnrichDeps,
): Promise<SungPhrase[]> {
  return Promise.all(
    phrases.map(async (phrase): Promise<SungPhrase> => {
      try {
        let tokens = await deps.tokenizePhrase(phrase.original)
        if (transcriptWords?.length && deps.reconcilePhraseReadings) {
          tokens = await deps.reconcilePhraseReadings({ ...phrase, tokens }, transcriptWords)
        }
        if (deps.alignPhraseTokens) {
          // Word pairing can fail independently (e.g. embedder unavailable) without
          // discarding the tokens + readings already computed for this phrase.
          try {
            tokens = await deps.alignPhraseTokens({ ...phrase, tokens })
          } catch {
            /* keep readings; word coloring degrades to none */
          }
        }
        return { ...phrase, tokens }
      } catch {
        return phrase
      }
    }),
  )
}

/** Enrich phrases then project their tokens back onto the display rows in one pass. */
export async function enrichAndProjectPhrases(
  lines: TimedLine[],
  phrases: SungPhrase[],
  transcriptWords: TimedTranscriptWord[] | undefined,
  deps: PhraseEnrichDeps,
): Promise<{ lines: TimedLine[]; phrases: SungPhrase[] }> {
  const enriched = await enrichPhraseTokens(phrases, transcriptWords, deps)
  return { lines: projectPhraseTokensToLines(lines, enriched), phrases: enriched }
}
