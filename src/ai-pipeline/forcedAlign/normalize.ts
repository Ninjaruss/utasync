// src/ai-pipeline/forcedAlign/normalize.ts
export interface NormalizeOpts {
  wordSep: string // the model's word-boundary token, e.g. '|'
}

/** Map text to vocab ids for an UPPERCASE-char CTC vocab: uppercase, spaces ->
 * wordSep, drop characters not in the vocab. */
export function lineToTokenIds(
  text: string,
  _lang: 'en' | 'ja',
  label2id: Record<string, number>,
  opts: NormalizeOpts,
): number[] {
  const ids: number[] = []
  for (const ch of text.toUpperCase()) {
    if (/\s/.test(ch)) { if (label2id[opts.wordSep] != null) ids.push(label2id[opts.wordSep]); continue }
    const id = label2id[ch]
    if (id != null) ids.push(id)
  }
  return ids
}

/** JA path: romanize (injected async — the app's toRomaji) then map like latin. */
export async function lineToTokenIdsJa(
  text: string,
  label2id: Record<string, number>,
  opts: NormalizeOpts & { romanize: (t: string) => Promise<string> },
): Promise<number[]> {
  const romaji = await opts.romanize(text)
  return lineToTokenIds(romaji, 'en', label2id, opts)
}
