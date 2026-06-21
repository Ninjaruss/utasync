/**
 * Curated romaji → English glosses for high-confidence lyric word pairing.
 * Kept as static data — no external dictionary API required.
 */

/** Romaji (lowercase) → primary English translation word used in lyrics. */
export const ROMAJI_GLOSS: Record<string, string> = {
  ai: 'love',
  anata: 'you',
  aozora: 'sky',
  arigatou: 'thank',
  ashita: 'tomorrow',
  atsui: 'hot',
  boku: 'i',
  chikai: 'near',
  chikau: 'promise',
  chizu: 'map',
  dare: 'who',
  dake: 'only',
  eien: 'forever',
  fuyu: 'winter',
  haato: 'heart',
  hana: 'flower',
  hanabi: 'fireworks',
  hikari: 'light',
  hitori: 'alone',
  hoshi: 'star',
  ichiban: 'best',
  itsuka: 'someday',
  itsumo: 'always',
  atashi: 'i',
  ichi: 'one',
  ho: 'step',
  ippo: 'step',
  okure: 'behind',
  toori: 'same',
  sunzen: 'verge',
  bakuhatsu: 'exploding',
  nozoki: 'peek',
  nozokikomare: 'peek',
  suberikomu: 'slide',
  tonariawase: 'adjacent',
  mayoigo: 'stray',
  koyuki: 'snowflake',
  shisen: 'looking',
  komaru: 'trouble',
  furikaeru: 'turning',
  tentou: 'fall',
  koigokoro: 'love',
  senaka: 'back',
  suberidasu: 'slipping',
  awate: 'rush',
  oikakeru: 'after',
  susumu: 'time',
  dou: 'what',
  doushita: 'what',
  koto: 'about',
  kaze: 'wind',
  kibou: 'hope',
  asa: 'morning',
  iwa: 'rock',
  korogaru: 'roll',
  nurikae: 'repaint',
  kimi: 'you',
  kitto: 'surely',
  kokoro: 'heart',
  koi: 'love',
  koe: 'voice',
  koyou: 'come',
  kumo: 'cloud',
  kyou: 'today',
  kuru: 'come',
  machi: 'town',
  mada: 'still',
  mae: 'before',
  mata: 'back',
  michi: 'road',
  mirai: 'future',
  mizu: 'water',
  mou: 'already',
  mune: 'heart',
  itan: 'ached',
  itai: 'ached',
  namida: 'tear',
  natsu: 'summer',
  nee: 'hey',
  nemuru: 'sleep',
  niji: 'rainbow',
  oboeru: 'remember',
  omoide: 'memory',
  omoi: 'thought',
  omou: 'think',
  owaru: 'end',
  renai: 'love',
  rooringu: 'rolling',
  rolling: 'rolling',
  saku: 'bloom',
  samui: 'cold',
  sayonara: 'goodbye',
  sekai: 'world',
  sora: 'sky',
  subete: 'everything',
  suki: 'like',
  tabun: 'maybe',
  taiyou: 'sun',
  toke: 'melt',
  toki: 'time',
  tonari: 'next',
  tomodachi: 'friend',
  tsuki: 'moon',
  tsuyoi: 'strong',
  uta: 'song',
  utau: 'sing',
  watashi: 'i',
  yasashii: 'gentle',
  yoru: 'night',
  yowai: 'weak',
  yoko: 'beside',
  yume: 'dream',
  zutto: 'forever',
}

/** Kanji surface → romaji when kuromoji omits reading (common lyric characters). */
export const KANJI_ROMAJI: Record<string, string> = {
  愛: 'ai',
  君: 'kimi',
  心: 'kokoro',
  星: 'hoshi',
  空: 'sora',
  青空: 'aozora',
  夢: 'yume',
  光: 'hikari',
  風: 'kaze',
  花: 'hana',
  月: 'tsuki',
  夜: 'yoru',
  声: 'koe',
  恋: 'koi',
  長: 'nagai',
  時: 'toki',
  道: 'michi',
  未来: 'mirai',
  記憶: 'memory',
  涙: 'namida',
  笑: 'warai',
  恋愛: 'renai',
  隣: 'tonari',
  一歩: 'ippo',
  世界: 'sekai',
  岩: 'iwa',
  塗: 'nurikae',
  塗り: 'nurikae',
  胸: 'mune',
  朝: 'asa',
  転がる: 'korogaru',
  ローリング: 'rooringu',
  寸前: 'sunzen',
  爆発: 'bakuhatsu',
  覗き: 'nozoki',
  覗き込まれ: 'nozokikomare',
  滑り込む: 'suberikomu',
  隣り合わせ: 'tonariawase',
  ハート: 'haato',
  視線: 'shisen',
  困る: 'komaru',
  迷い子: 'mayoigo',
  粉雪: 'koyuki',
  滑り出す: 'suberidasu',
  慌て: 'awate',
  追いかける: 'oikakeru',
  振り返る: 'furikaeru',
  転倒: 'tentou',
  恋心: 'koigokoro',
  背中: 'senaka',
  進む: 'susumu',
  溶け: 'toke',
  進ん: 'susumu',
  来よ: 'koyou',
  どう: 'dou',
  どうした: 'doushita',
  事: 'koto',
}

/**
 * English words that often translate a gloss entry poetically (e.g. 長い → "endless").
 * Maps lowercase EN → romaji gloss key for exact-match scoring.
 */
export const EN_POETIC_ALIASES: Record<string, string> = {
  endless: 'nagai',
  eternal: 'eien',
  eternity: 'eien',
  forever: 'eien',
  always: 'itsumo',
  back: 'mata',
  beside: 'yoko',
  come: 'koyou',
  definitely: 'kitto',
  maybe: 'tabun',
  only: 'dake',
  repainted: 'nurikae',
  repaint: 'nurikae',
  rock: 'iwa',
  rocks: 'iwa',
  rolling: 'korogaru',
  roll: 'korogaru',
  world: 'sekai',
  morning: 'asa',
  behind: 'okure',
  same: 'toori',
  step: 'ippo',
  me: 'atashi',
  perhaps: 'tabun',
  gently: 'yasashii',
  kindness: 'yasashii',
  tender: 'yasashii',
  alone: 'hitori',
  lonely: 'hitori',
  solitude: 'hitori',
  shine: 'kagayaku',
  shining: 'kagayaku',
  bright: 'hikari',
  glow: 'hikari',
  bloom: 'saku',
  blossom: 'saku',
  remember: 'oboeru',
  memories: 'omoide',
  memory: 'omoide',
  melt: 'toke',
  next: 'tonari',
  thought: 'omoi',
  thinking: 'omou',
  ending: 'owaru',
  goodbye: 'sayonara',
  farewell: 'sayonara',
  ache: 'itan',
  ached: 'itan',
  hearts: 'haato',
  thanks: 'thank',
  grateful: 'thank',
  sweetheart: 'koi',
  darling: 'koi',
  beloved: 'ai',
  tears: 'namida',
  tear: 'namida',
  verge: 'sunzen',
  exploding: 'bakuhatsu',
  explode: 'bakuhatsu',
  peeks: 'nozokikomare',
  peek: 'nozoki',
  peeking: 'nozokikomare',
  slide: 'suberikomu',
  sliding: 'suberidasu',
  adjacent: 'tonariawase',
  stray: 'mayoigo',
  snowflake: 'koyuki',
  powder: 'koyuki',
  looking: 'shisen',
  trouble: 'komaru',
  turning: 'furikaeru',
  fall: 'tentou',
  falling: 'tentou',
  slipping: 'suberidasu',
  rush: 'awate',
  rushing: 'awate',
  after: 'oikakeru',
  okay: 'daijoubu',
  dissolving: 'toke',
  melting: 'toke',
  time: 'susumu',
  what: 'dou',
  up: 'dou',
  your: 'kimi',
  about: 'koto',
  god: 'dou',
}

/** Additional EN→romaji aliases (multiple romaji may map to the same English word). */
const EN_POETIC_ALIASES_EXTRA: Array<[string, string]> = [
  ['about', 'sunzen'],
]

/** Reverse lookup: English target word → set of romaji keys that gloss to it. */
const EN_TO_ROMAJI = new Map<string, Set<string>>()

function buildEnToRomaji(): void {
  if (EN_TO_ROMAJI.size > 0) return
  for (const [romaji, english] of Object.entries(ROMAJI_GLOSS)) {
    const key = english.toLowerCase()
    if (!EN_TO_ROMAJI.has(key)) EN_TO_ROMAJI.set(key, new Set())
    EN_TO_ROMAJI.get(key)!.add(romaji)
  }
  for (const [english, romaji] of Object.entries(EN_POETIC_ALIASES)) {
    const key = english.toLowerCase()
    if (!EN_TO_ROMAJI.has(key)) EN_TO_ROMAJI.set(key, new Set())
    EN_TO_ROMAJI.get(key)!.add(romaji)
  }
  for (const [english, romaji] of EN_POETIC_ALIASES_EXTRA) {
    const key = english.toLowerCase()
    if (!EN_TO_ROMAJI.has(key)) EN_TO_ROMAJI.set(key, new Set())
    EN_TO_ROMAJI.get(key)!.add(romaji)
  }
}

/** True when romaji glosses to the English target (direct or poetic alias). */
export function glossMatchesTarget(romaji: string, targetWord: string): boolean {
  buildEnToRomaji()
  const r = romaji.trim().toLowerCase()
  const t = targetWord.trim().toLowerCase()
  if (ROMAJI_GLOSS[r] === t) return true
  const aliasRomaji = EN_POETIC_ALIASES[t]
  if (aliasRomaji && aliasRomaji === r) return true
  const romajiSet = EN_TO_ROMAJI.get(t)
  return romajiSet?.has(r) ?? false
}

/** Romaji keys that share the same English gloss as `romaji`. */
export function glossClusterRomaji(romaji: string): string[] {
  buildEnToRomaji()
  const r = romaji.trim().toLowerCase()
  const english = ROMAJI_GLOSS[r]
  if (!english) return [r]
  const cluster = EN_TO_ROMAJI.get(english.toLowerCase())
  return cluster ? [...cluster] : [r]
}

/** True when two romaji strings share the same English gloss cluster. */
export function romajiShareGloss(a: string, b: string): boolean {
  const cluster = new Set(glossClusterRomaji(a))
  return cluster.has(b.trim().toLowerCase())
}
