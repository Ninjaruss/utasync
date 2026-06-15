let dict: Record<string, string> | null = null

async function getCMUDict(): Promise<Record<string, string>> {
  if (dict) return dict
  const res = await fetch('/cmudict.json')
  dict = await res.json()
  return dict!
}

const ARPABET_TO_IPA: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', EH: 'ɛ', ER: 'ɝ',
  EY: 'eɪ', F: 'f', G: 'g', HH: 'h', IH: 'ɪ', IY: 'i',
  JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  OW: 'oʊ', OY: 'ɔɪ', P: 'p', R: 'r', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ', UH: 'ʊ', UW: 'u', V: 'v', W: 'w',
  Y: 'j', Z: 'z', ZH: 'ʒ',
}

function arpabetToIPA(phones: string): string {
  return phones.split(' ')
    .map((p) => ARPABET_TO_IPA[p.replace(/[0-9]/g, '')] ?? p.toLowerCase())
    .join('')
}

export async function wordToIPA(word: string): Promise<string | null> {
  const d = await getCMUDict()
  const entry = d[word.toUpperCase()]
  if (!entry) return null
  return `/${arpabetToIPA(entry)}/`
}

export async function sentenceToIPA(text: string): Promise<string> {
  const words = text.split(/\s+/)
  const ipas = await Promise.all(words.map((w) => wordToIPA(w.replace(/[^a-zA-Z']/g, ''))))
  return words.map((w, i) => ipas[i] ?? w).join(' ')
}
