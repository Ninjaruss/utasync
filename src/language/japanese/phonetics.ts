import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'

let kuroshiroPromise: Promise<Kuroshiro> | null = null

async function getKuroshiro(): Promise<Kuroshiro> {
  // Cache the in-flight init promise so concurrent callers share one instance,
  // but drop it on failure so a transient init error doesn't permanently poison
  // every later call with a half-initialised (analyzer === null) instance.
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      const k = new Kuroshiro()
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
