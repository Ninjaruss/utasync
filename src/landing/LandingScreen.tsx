interface Props {
  onOpenApp: () => void
}

const FEATURES = [
  {
    badge: '01',
    title: 'Auto alignment',
    body: 'On-device speech recognition times every lyric line to the audio — no tapping along. Repeated choruses and dropped syllables are handled automatically.',
    glyph: '◷',
  },
  {
    badge: '02',
    title: 'Furigana readings',
    body: 'Dictionary furigana on every kanji, then verified against how the words are actually sung — alternate readings get adopted, uncertain ones flagged.',
    glyph: 'ふ',
  },
  {
    badge: '03',
    title: 'Word pairing',
    body: 'Each Japanese word is colour-matched to its English counterpart, so you can see exactly which part means what — across flipped SOV/SVO word order.',
    glyph: '⇄',
  },
]

export function LandingScreen({ onOpenApp }: Props) {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-cinnabar-950 text-white">
      <div className="w-full max-w-2xl mx-auto px-5 pb-16">
        <header className="flex items-center justify-between py-5">
          <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
          <button
            type="button"
            onClick={onOpenApp}
            className="min-h-11 px-3 text-white/45 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out"
          >
            Open the app →
          </button>
        </header>

        {/* Hero */}
        <section className="pt-10 pb-12 animate-[progress-enter_260ms_ease-out_both]">
          <p className="text-[11px] uppercase tracking-[0.2em] text-cinnabar-accent/80 mb-4">
            Study Japanese songs
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight text-balance">
            Turn any song into a lyric study session.
          </h1>
          <p className="mt-4 text-white/60 text-base text-pretty leading-relaxed max-w-lg">
            Utasync syncs lyrics to the audio, adds furigana the way the singer actually sings them,
            and pairs every word with its translation — all on your device.
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={onOpenApp}
              className="min-h-12 px-6 rounded-xl bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white font-semibold text-sm flex items-center gap-2 touch-manipulation shadow-lg shadow-cinnabar-accent/20 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
            >
              Get started →
            </button>
          </div>
        </section>

        {/* Feature blocks */}
        <section className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.badge}
              className="rounded-2xl border border-cinnabar-900 bg-cinnabar-900/40 p-5 transition-colors duration-150 ease-out hover:border-cinnabar-800"
            >
              <div className="w-10 h-10 rounded-xl bg-cinnabar-950 border border-cinnabar-800 flex items-center justify-center text-cinnabar-accent text-lg mb-4">
                {f.glyph}
              </div>
              <p className="text-[10px] uppercase tracking-wide text-white/30 tabular-nums">{f.badge}</p>
              <h2 className="mt-1 text-base font-semibold text-balance">{f.title}</h2>
              <p className="mt-2 text-white/55 text-[13px] text-pretty leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>

        {/* Closing CTA */}
        <section className="mt-12 rounded-2xl border border-cinnabar-900 bg-gradient-to-b from-cinnabar-900/50 to-cinnabar-950 p-6 text-center">
          <h2 className="text-lg font-semibold text-balance">Ready to study your favourite song?</h2>
          <p className="mt-2 text-white/55 text-sm text-pretty max-w-md mx-auto">
            Add any song with a YouTube link or a local audio file and let Utasync do the rest.
          </p>
          <button
            type="button"
            onClick={onOpenApp}
            className="mt-5 min-h-12 px-6 rounded-xl bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white font-semibold text-sm touch-manipulation shadow-lg shadow-cinnabar-accent/20 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Open the app
          </button>
        </section>

        <footer className="mt-10 text-center text-[11px] text-white/25 text-pretty">
          Runs entirely in your browser. Audio streams from YouTube — nothing is uploaded.
        </footer>
      </div>
    </div>
  )
}
