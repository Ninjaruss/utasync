import { useState } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { fetchLRCFromLRCLIB } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { v4 as uuidv4 } from 'uuid'
import type { Song } from '../core/types'
import { AlignmentEditor } from '../lyrics/AlignmentEditor'

interface Props {
  onSongReady: (songId: string) => void
}

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [pendingSong, setPendingSong] = useState<Song | null>(null)
  const [alignmentEditorData, setAlignmentEditorData] = useState<{ orig: string[]; trans: string[] } | null>(null)

  const handleParse = async () => {
    setError('')
    setStatus('Fetching song info…')
    try {
      const meta = await fetchYouTubeMeta(url)
      setStatus('Searching for lyrics…')

      let lines: Song['lyrics']['lines'] = []
      try {
        const lrc = await fetchLRCFromLRCLIB(meta.title, meta.artist)
        if (lrc) lines = parseLRC(lrc)
      } catch {
        // Lyrics not found — continue with empty lines
      }

      const song: Song = {
        id: uuidv4(),
        title: meta.title,
        artist: meta.artist,
        sourceUrl: url,
        lyrics: {
          lines,
          sourceLanguage: 'ja',
          translationLanguage: 'en',
          alignmentMode: 'manual',
        },
        createdAt: new Date(),
        isTrialSong: false,
      }

      // Check if original and translation line counts differ
      const origLines = lines.map((l) => l.original)
      const transLines = lines.map((l) => l.translation ?? '')
      const hasTranslations = transLines.some((t) => t.length > 0)

      if (hasTranslations && origLines.length !== transLines.filter((t) => t.length > 0).length) {
        setPendingSong(song)
        setAlignmentEditorData({ orig: origLines, trans: transLines })
        setStatus('')
        return
      }

      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const handleAlignmentConfirm = async (pairs: Array<{ original: string; translation: string }>) => {
    if (!pendingSong) return
    const updatedLines = pendingSong.lyrics.lines.map((line, i) => ({
      ...line,
      original: pairs[i]?.original ?? line.original,
      translation: pairs[i]?.translation ?? line.translation,
    }))
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
          onClick={handleParse}
          disabled={!url || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          {status || 'Get Lyrics'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
