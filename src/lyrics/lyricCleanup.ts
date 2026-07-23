// Strip non-lyric noise that comes with pasted lyrics (Genius especially):
// section headers, contributor/metadata lines, concert-ticket and "you might
// also like" recommendation widgets, romanization/translation labels, and embed
// footers. Conservative on purpose — only removes lines that match well-known
// non-lyric shapes so real lyric lines (including "(Hey)" ad-libs) are kept.

/** A line that is entirely a bracketed section header, e.g. "[Verse 1: Ado]". */
const SECTION_HEADER_RE = /^\[[^\]]*\]$/

/** Genius "You might also like" recommendation widget marker. */
const RECOMMENDATION_MARKER_RE = /^you might also like\b/i

/** Whole-line shapes that are never sung lyrics. */
const JUNK_LINE_RES: RegExp[] = [
  /^\d+\s+contributors?\b/i, // "37 Contributors"
  /^see\s+.+\slive$/i, // "See Snoop Dogg Live"
  /^get tickets\b/i, // "Get tickets as low as $102"
  /\bromani[sz]ations?$/i, // "Genius Romanizations", "PopBase Romanizations"
  /^genius\b.*\b(translations?|romani[sz]ations?)\b/i, // "Genius English Translations"
  /\(romani[sz]ed\)$/i, // "Ado - 春に舞う (Haru Ni Mau) (Romanized)"
  /^\d*embed$/i, // "Embed", "217Embed"
  /^translations?$/i, // bare "Translations" section label
]

function isJunkLine(trimmed: string): boolean {
  return JUNK_LINE_RES.some((re) => re.test(trimmed))
}

/**
 * Inline furigana annotation: a run of kanji immediately followed by a
 * parenthesized run of *only* kana. Both ascii "()" and fullwidth "（）" parens
 * are accepted, and may be mixed within one annotation.
 *
 *   君(きみ)の名前（なまえ）を呼(よ)ぶ  →  君の名前を呼ぶ
 *
 * Ranges: kanji = CJK Unified Ideographs U+4E00–U+9FFF plus the iteration mark
 * 々 (U+3005); kana = hiragana (U+3041–U+3096), katakana (U+30A1–U+30F6) and the
 * long-vowel mark ー (U+30FC). Requiring kanji immediately before the open paren
 * AND an entirely-kana body keeps this from eating Latin ad-libs ("(Hey)"),
 * romanizations ("(Haru Ni Mau)", "(Romanized)"), or a kana ad-lib that is not
 * preceded by kanji ("(なにか)" at line start / after kana).
 */
const INLINE_FURIGANA_RE =
  /([一-鿿々]+)[(（]([ぁ-ゖァ-ヶー]+)[)）]/g

/**
 * Strip inline furigana readings 漢字(かな) → 漢字, keeping the kanji, applied
 * globally so multiple/adjacent annotations on one line are all removed. Lines
 * with no such annotation (blank, English, kana-only, plain Japanese) are
 * returned unchanged because the pattern simply does not match.
 *
 * Deferred: the paren-LESS inline form (君きみ…) is genuinely ambiguous without
 * parens and needs a tokenizer-aware pass; not handled here.
 *
 * Accepted residual: a genuine all-kana ad-lib written immediately after a kanji
 * with no space (愛(あい)) is indistinguishable from furigana and gets stripped.
 * Furigana is the overwhelmingly intended reading of that exact shape, and the
 * guarded cases (a space, non-kana content, or no preceding kanji) cover the
 * real ad-lib/English/(Romanized) forms.
 */
export function stripInlineFurigana(line: string): string {
  return line.replace(INLINE_FURIGANA_RE, '$1')
}

/**
 * Remove non-lyric lines from pasted/imported lyric text, returning the cleaned
 * text (same line order, junk removed). The "You might also like" recommendation
 * block runs from its marker to the next section header (bounded to a short
 * lookahead so a stray marker can never eat the rest of the song).
 */
/**
 * A run of leading LRC time tags: [mm:ss], [mm:ss.xx], [mm:ss.xxx] (also a
 * lone-digit variant like [m:s]), optionally several in a row and with
 * surrounding spaces — the standard karaoke/LRC line prefix. Only the
 * digit:digit shape matches, so word-metadata tags ([ar:...], [ti:...]) are left
 * for the whole-line header filter, and a mid-line bracket like "[midnight]" is
 * untouched because the match is anchored to the start of the line.
 */
const LEADING_LRC_TAGS_RE = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/

/**
 * Strip the LRC time tag(s) that prefix a lyric line, keeping the lyric text so
 * a pasted `.lrc` file aligns from scratch like any plain-text paste. A line that
 * is ONLY a time tag (an LRC anchor/blank line) collapses to empty and is dropped
 * downstream. Lines without a leading time tag are returned unchanged.
 */
export function stripLrcTimestamps(line: string): string {
  const m = line.match(LEADING_LRC_TAGS_RE)
  return m ? line.slice(m[0].length) : line
}

export function cleanPastedLyrics(text: string): string {
  const lines = text.split('\n').map(stripLrcTimestamps)
  const kept: string[] = []
  const RECOMMENDATION_LOOKAHEAD = 12

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (RECOMMENDATION_MARKER_RE.test(trimmed)) {
      // Drop the widget up to the next section header, if one appears soon.
      let end = -1
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + RECOMMENDATION_LOOKAHEAD); j++) {
        if (SECTION_HEADER_RE.test(lines[j].trim())) {
          end = j
          break
        }
      }
      if (end >= 0) {
        i = end // skip marker..header (the header is dropped as a header anyway)
        continue
      }
      // No bounding header nearby — only drop the marker itself.
      continue
    }

    if (!trimmed) {
      kept.push(lines[i])
      continue
    }
    if (SECTION_HEADER_RE.test(trimmed)) continue
    if (isJunkLine(trimmed)) continue
    kept.push(stripInlineFurigana(lines[i]))
  }

  return kept.join('\n')
}
