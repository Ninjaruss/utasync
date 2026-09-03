import type Kuroshiro from 'kuroshiro'

let kuroshiroPromise: Promise<Kuroshiro> | null = null

async function getKuroshiro(): Promise<Kuroshiro> {
  // Cache the in-flight init promise so concurrent callers share one instance,
  // but drop it on failure so a transient init error doesn't permanently poison
  // every later call with a half-initialised (analyzer === null) instance.
  //
  // kuroshiro and its kuromoji analyzer are imported HERE rather than at module
  // scope: every reading helper below is already async, so deferring the import
  // costs nothing, while a static import pulled the whole analyzer into the main
  // bundle for modules that only wanted the pure kana helper at the bottom of
  // this file.
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      const [{ default: KuroshiroCtor }, { default: KuromojiAnalyzer }] = await Promise.all([
        import('kuroshiro'),
        import('kuroshiro-analyzer-kuromoji'),
      ])
      const k = new KuroshiroCtor()
      await k.init(new KuromojiAnalyzer({ dictPath: '/dict' }))
      return k
    })().catch((err) => {
      kuroshiroPromise = null
      throw err
    })
  }
  return kuroshiroPromise
}

export async function toRomaji(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
}

export async function toFurigana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'hiragana', mode: 'furigana' })
}

export async function toKatakana(text: string): Promise<string> {
  const k = await getKuroshiro()
  return k.convert(text, { to: 'katakana' })
}

/** Kuromoji readings are katakana; furigana rt tags conventionally use hiragana. */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}
