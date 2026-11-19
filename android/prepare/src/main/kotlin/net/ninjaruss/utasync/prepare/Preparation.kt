package net.ninjaruss.utasync.prepare

import kotlin.math.roundToInt
import kotlin.math.roundToLong
import net.ninjaruss.utasync.align.Sheet
import net.ninjaruss.utasync.align.sheetFrom
import net.ninjaruss.utasync.data.LineEntity
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.SongEntity

/** Where one attempt at preparing a song's lyrics got to. */
sealed interface PrepareOutcome {
    /** Lyrics with timings are stored; the song is ready to sing. */
    data class Synced(val lineCount: Int) : PrepareOutcome

    /** The words are stored with no timings; the timing comes later. */
    data class WordsOnly(val lineCount: Int) : PrepareOutcome

    /** Several records could be the song. Nothing is stored: the user picks (rule 2). */
    data class NeedsChoice(val candidates: List<LrclibTrack>) : PrepareOutcome

    /** No usable lyrics. [outcome] says whether that is the catalogue's answer or ours. */
    data class NotFound(val outcome: LookupOutcome) : PrepareOutcome

    /**
     * The song has a timing the user fixed by hand, so its lyric sheet was left exactly as it
     * is (ADR-0002). Replacing the sheet would re-split the lines, and anchors are keyed by
     * line index, so every pin would end up on different words without a single anchor row
     * being written. Only the user may allow it, through `allowReplaceSheet`.
     */
    data object RefusedHasPins : PrepareOutcome

    /** Automatic lookup is switched off. The manual rungs still work. */
    data object Disabled : PrepareOutcome
}

/**
 * Rungs 1 and 2 of the ladder, for one song: ask `/api/get` for the exact record, and fall
 * through to `/api/search` when there is none, so the user can choose. Stores nothing on a
 * guess, and **never** writes, moves or deletes an anchor.
 */
suspend fun prepareSong(
    dao: SongDao,
    lrclib: Lrclib,
    song: SongEntity,
    allowReplaceSheet: Boolean = false,
    fetchEnabled: Boolean = true,
): PrepareOutcome {
    if (!fetchEnabled) {
        dao.setPrepareState(song.id, "off")
        return PrepareOutcome.Disabled
    }
    // Checked before anything is written or asked: a refusal must leave the song untouched.
    if (!allowReplaceSheet && dao.anchors(song.id).any { it.source == "user" }) {
        return PrepareOutcome.RefusedHasPins
    }

    val title = song.title.trim()
    val artist = song.artist.trim()
    // `/api/get` rejects an empty track_name outright, and a song with no name cannot be
    // searched for either. "" is what importAudio stores for a missing tag: absent, not a name.
    if (title.isEmpty()) {
        dao.setPrepareState(song.id, "failed")
        return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
    }

    dao.setPrepareState(song.id, "fetching")
    val query = TrackQuery(
        title = title,
        artist = artist,
        // Sending the duration is the whole of rung 1's matching: the server checks it within
        // +-2 s. Nothing here scores or thresholds a match.
        durationSec = song.durationMs?.let { (it / 1000.0).roundToInt() },
    )

    // `/api/get` requires both names, so a blank artist cannot match there. Skipping straight
    // to search is the ladder working as designed, not a dead end.
    if (artist.isNotEmpty()) {
        val exact = lrclib.get(query)
        exact.track?.takeIf { exact.outcome == LookupOutcome.FOUND }?.let {
            return adoptTrack(dao, song.id, it)
        }
        // Only "the catalogue has no such record" is worth a second request. Offline or rate
        // limited means asking again now would fail the same way or earn a longer ban.
        if (exact.outcome != LookupOutcome.NO_ENTRY) {
            dao.setPrepareState(song.id, "failed")
            return PrepareOutcome.NotFound(exact.outcome)
        }
    }

    val found = lrclib.search(query)
    dao.setPrepareState(song.id, "failed")
    return if (found.candidates.isNotEmpty()) {
        PrepareOutcome.NeedsChoice(found.candidates)
    } else {
        PrepareOutcome.NotFound(found.outcome)
    }
}

/**
 * Stores one LRCLIB record's lyrics as the song's lines. Called for rung 1's exact match and
 * for a candidate the user picked.
 *
 * **It never touches an anchor.** `replaceLines` rewrites the computed timings only; a user's
 * pins stay where they are and win at read time through `resolveStarts`.
 */
suspend fun adoptTrack(dao: SongDao, songId: Long, track: LrclibTrack): PrepareOutcome {
    val sheet = sheetFrom(track.syncedLyrics, track.plainLyrics, track.instrumental)
    val lines = when (sheet) {
        is Sheet.Timed -> sheet.lines.mapIndexed { i, row ->
            LineEntity(
                songId = songId,
                lineIndex = i,
                text = row.text,
                startMs = (row.timeSec * 1000).roundToLong(),
                // A line ends where the next begins; the last line's end is unknown.
                endMs = sheet.lines.getOrNull(i + 1)?.let { (it.timeSec * 1000).roundToLong() },
            )
        }
        is Sheet.Untimed -> sheet.lines.mapIndexed { i, text ->
            LineEntity(songId = songId, lineIndex = i, text = text, startMs = null, endMs = null)
        }
        Sheet.None -> {
            // An instrumental, or a record with no lyric text in either field. Nothing is
            // stored, so an earlier sheet is not thrown away for an empty one.
            dao.setPrepareState(songId, "failed")
            return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
        }
    }

    dao.replaceLines(songId, lines)
    dao.setLyricsSource(songId, "lrclib")
    fillBlankNames(dao, songId, track)
    dao.setPrepareState(songId, "done")

    return when (sheet) {
        is Sheet.Timed -> PrepareOutcome.Synced(lines.size)
        is Sheet.Untimed -> PrepareOutcome.WordsOnly(lines.size)
        Sheet.None -> error("unreachable: Sheet.None returned above")
    }
}

/**
 * Fills in a name the file did not give, which is how a song parsed as a title with no artist
 * becomes able to take rung 1 next time. A name the file *did* give is never overwritten: the
 * user's own file outranks the catalogue.
 */
private suspend fun fillBlankNames(dao: SongDao, songId: Long, track: LrclibTrack) {
    val row = dao.song(songId) ?: return
    if (row.title.isNotBlank() && row.artist.isNotBlank()) return
    dao.setTitleArtist(
        id = songId,
        title = row.title.ifBlank { track.trackName },
        artist = row.artist.ifBlank { track.artistName },
    )
}
