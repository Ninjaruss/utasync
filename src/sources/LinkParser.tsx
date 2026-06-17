import { useState } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { findLyrics, findSecondLanguageLyrics } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
import { detectLanguage, attachSecondLanguage, extractSecondLanguageLines, pairsToTimedLines } from '../lyrics/bilingual'
import type { Song, TimedLine, Language } from '../core/types'
import { AlignmentEditor } from '../lyrics/AlignmentEditor'

interface Props {
  onSongReady: (songId: string) => void
}

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [secondLang, setSecondLang] = useState('')
  const [showSecondLang, setShowSecondLang] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [pendingSong, setPendingSong] = useState<Song | null>(null)
  const [alignmentEditorData, setAlignmentEditorData] = useState<{ orig: string[]; trans: string[] } | null>(null)
  // Set when lyrics loaded but no translation was found: we pause so the user
  // can paste a second language (or continue without one) instead of silently
  // opening a monolingual song.
  const [pending, setPending] = useState<{ input: BuildSongInput; lines: TimedLine[] } | null>(null)

  const saveAndOpen = async (input: BuildSongInput, lines: TimedLine[]) => {
    const song = buildSong({ ...input, lines })
    await db.songs.put(song)
    onSongReady(song.id)
  }

  // Attach a pasted/looked-up second language, routing to the editor on mismatch.
  const attachOrEdit = async (input: BuildSongInput, lines: TimedLine[], secondText: string): Promise<boolean> => {
    const { lines: paired, needsAlignment } = attachSecondLanguage(lines, secondText)
    if (needsAlignment) {
      setPendingSong(buildSong({ ...input, lines }))
      setAlignmentEditorData({ orig: lines.map((l) => l.original), trans: extractSecondLanguageLines(secondText) })
      return true
    }
    await saveAndOpen(input, paired)
    return true
  }

  const handleParse = async () => {
    setError('')
    setNote('')
    setPending(null)
    setStatus('Fetching song info…')
    try {
      const meta = await fetchYouTubeMeta(url)
      setStatus('Searching for lyrics…')

      let lines: TimedLine[] = []
      try {
        const found = await findLyrics(meta.title, meta.artist)
        if (found) {
          lines = found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)
        }
      } catch {
        // Lyrics not found — continue with empty lines
      }

      const primaryText = lines.map((l) => l.original).join('\n')
      const primaryLang = lines.length ? detectLanguage(primaryText) : 'other'
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : 'en'
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      const input: BuildSongInput = {
        title: meta.title,
        artist: meta.artist,
        sourceUrl: url,
        lines,
        sourceLanguage,
        translationLanguage,
      }

      // No lyrics at all — nothing to pair; just open the song.
      if (!lines.length) {
        await saveAndOpen(input, lines)
        setStatus('')
        return
      }

      // Second language: a manual paste wins; otherwise try LRCLIB for a
      // same-artist alternate-language entry.
      let secondText = secondLang.trim()
      if (!secondText) {
        setStatus('Looking for a translation…')
        const second = await findSecondLanguageLyrics(meta.title, meta.artist, primaryLang)
        if (second) secondText = second.lrc
      }

      if (secondText) {
        await attachOrEdit(input, lines, secondText)
        setStatus('')
        return
      }

      // Found lyrics but no translation: pause and invite a manual paste.
      setStatus('')
      setShowSecondLang(true)
      setPending({ input, lines })
      setNote('Lyrics found, but no matching translation. Paste a second language below, or continue with just the original.')
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  // After a pause for missing translation: apply a pasted second language if
  // given, otherwise open the song with the original lyrics only.
  const handleContinue = async () => {
    if (!pending) return
    setError('')
    setStatus('Saving…')
    try {
      const secondText = secondLang.trim()
      if (secondText) {
        await attachOrEdit(pending.input, pending.lines, secondText)
      } else {
        await saveAndOpen(pending.input, pending.lines)
      }
      setStatus('')
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const handleAlignmentConfirm = async (pairs: Array<{ original: string; translation: string }>) => {
    if (!pendingSong) return
    const updatedLines = pairsToTimedLines(pendingSong.lyrics.lines, pairs)
    const updatedSong: Song = {
      ...pendingSong,
      lyrics: { ...pendingSong.lyrics, lines: updatedLines },
    }
    await db.songs.put(updatedSong)
    setAlignmentEditorData(null)
    setPendingSong(null)
    onSongReady(updatedSong.id)
  }

  if (alignmentEditorData) {
    return (
      <AlignmentEditor
        originalLines={alignmentEditorData.orig}
        translationLines={alignmentEditorData.trans}
        onConfirm={handleAlignmentConfirm}
      />
    )
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
      <p className="text-white/50 text-sm text-center">Learn languages through music</p>

      <div className="w-full max-w-md space-y-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link…"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
        />

        <button
          onClick={() => setShowSecondLang((v) => !v)}
          className="text-white/40 hover:text-white/70 text-xs"
        >
          {showSecondLang ? '− Hide second-language lyrics' : '+ Add second-language lyrics (optional)'}
        </button>
        {showSecondLang && (
          <textarea
            value={secondLang}
            onChange={(e) => setSecondLang(e.target.value)}
            placeholder="Paste the other language's lyrics (one line per row, or an .lrc)…"
            rows={5}
            className="w-full px-3 py-2 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30 font-jp"
          />
        )}

        {note && <p className="text-cinnabar-accent/80 text-xs text-center">{note}</p>}

        {pending ? (
          <button
            onClick={handleContinue}
            disabled={!!status}
            className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
          >
            {status || (secondLang.trim() ? 'Add translation & open →' : 'Continue without translation →')}
          </button>
        ) : (
          <button
            onClick={handleParse}
            disabled={!url || !!status}
            className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
          >
            {status || 'Get Lyrics'}
          </button>
        )}
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
