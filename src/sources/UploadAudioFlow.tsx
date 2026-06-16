// src/sources/UploadAudioFlow.tsx
import { useState, type ChangeEvent } from 'react'
import { db } from '../core/db/schema'
import { ingestAudioFile } from './audioIngest'
import { buildSong, linesFromPlainText } from './songBuilder'
import { fetchLRCFromLRCLIB } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { parseSubtitle } from '../lyrics/subtitle-parser'
import { extractAudioMetadata, deriveTitle } from './audioMetadata'
import type { TimedLine } from '../core/types'

type LyricSource = 'lrclib' | 'paste' | 'subtitle'

interface Props {
  onSongReady: (songId: string) => void
}

export function UploadAudioFlow({ onSongReady }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [source, setSource] = useState<LyricSource>('lrclib')
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // True once an LRCLIB lookup returns nothing: forces paste/subtitle input.
  const [lrclibMissed, setLrclibMissed] = useState(false)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (!f) return
    const meta = await extractAudioMetadata(f)
    // Only fill fields the user hasn't typed into; tags win over filename.
    setTitle((cur) => cur || meta.title || deriveTitle(f.name))
    setArtist((cur) => cur || meta.artist || '')
  }

  async function resolveLines(): Promise<TimedLine[] | null> {
    if (source === 'paste') return linesFromPlainText(pasted)
    if (source === 'subtitle') {
      if (!subtitleFile) { setError('Choose a subtitle file or switch lyric source.'); return null }
      const text = await subtitleFile.text()
      return parseSubtitle(text, subtitleFile.name)
    }
    // lrclib
    const lrc = await fetchLRCFromLRCLIB(title, artist)
    if (lrc) return parseLRC(lrc)
    return null // signals miss
  }

  const handleSubmit = async () => {
    if (!file || !title.trim()) return
    setError('')
    setStatus('Saving audio…')
    try {
      const lines = await resolveLines()
      if (lines === null) {
        // LRCLIB miss (or unresolved) — require paste/subtitle before continuing.
        setStatus('')
        if (source === 'lrclib') {
          setLrclibMissed(true)
          setSource('paste')
          setError('No lyrics found. Paste the lyrics or attach a subtitle file so auto-align can match the audio.')
        }
        return
      }
      if (lines.length === 0) {
        // Empty paste/subtitle — there is nothing to align. Require real lyric text.
        setStatus('')
        setError('No lyric lines found. Add lyrics so they can be aligned to the audio.')
        return
      }
      setStatus('Storing…')
      const { songId, audioStoredPath } = await ingestAudioFile(file)
      const song = buildSong({ id: songId, title: title.trim(), artist: artist.trim(), audioStoredPath, lines })
      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  const tabClass = (s: LyricSource) =>
    `px-3 py-1.5 rounded-lg text-xs ${source === s ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-5">
      <h1 className="text-2xl font-bold text-cinnabar-accent tracking-widest">Upload audio</h1>

      <div className="w-full max-w-md space-y-3">
        <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
          {file ? file.name : 'Choose an audio file…'}
          <input type="file" accept="audio/*" className="hidden"
            onChange={handleFileChange} />
        </label>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />

        <div className="flex gap-2">
          <button className={tabClass('lrclib')} onClick={() => setSource('lrclib')} disabled={lrclibMissed}>Find lyrics (LRCLIB)</button>
          <button className={tabClass('paste')} onClick={() => setSource('paste')}>Paste lyrics</button>
          <button className={tabClass('subtitle')} onClick={() => setSource('subtitle')}>Subtitle file</button>
        </div>

        {source === 'paste' && (
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste lyrics, one line per row…"
            rows={6} className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />
        )}
        {source === 'subtitle' && (
          <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
            {subtitleFile ? subtitleFile.name : 'Choose a .lrc / .srt / .vtt file…'}
            <input type="file" accept=".lrc,.srt,.vtt,text/plain" className="hidden"
              onChange={(e) => setSubtitleFile(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <button onClick={handleSubmit} disabled={!file || !title.trim() || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40">
          {status || 'Create song'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>
    </div>
  )
}
