package net.ninjaruss.utasync.prepare

import kotlin.math.roundToInt
import kotlin.math.roundToLong
import net.ninjaruss.utasync.align.Sheet
import net.ninjaruss.utasync.align.sheetFrom
import net.ninjaruss.utasync.align.splitPastedLyrics
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
        dao.setPrepareState(song.id, OFF)
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
        // No query could be formed, so this is not a service failure and a retry is pointless.
        dao.setPrepareState(song.id, NO_MATCH)
        return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
    }

    dao.setPrepareState(song.id, FETCHING)
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
            return adoptTrack(dao, song.id, it, consented = allowReplaceSheet)
        }
        // Only "the catalogue has no such record" is worth a second request. Offline or rate
        // limited means asking again now would fail the same way or earn a longer ban.
        if (exact.outcome != LookupOutcome.NO_ENTRY) {
            dao.setPrepareState(song.id, stateFor(exact.outcome))
            return PrepareOutcome.NotFound(exact.outcome)
        }
    }

    val found = lrclib.search(query)
    return if (found.candidates.isNotEmpty()) {
        // The service answered and there is something to pick from, so nothing is wrong and a
        // retry would change nothing: the user must choose. The candidates are NOT persisted —
        // they live in this outcome — so a stored "needs-choice" would promise a payload that
        // does not survive process death, and the user's next step (open the lyrics screen,
        // which searches afresh) is the same either way.
        dao.setPrepareState(song.id, NO_MATCH)
        PrepareOutcome.NeedsChoice(found.candidates)
    } else {
        dao.setPrepareState(song.id, stateFor(found.outcome))
        PrepareOutcome.NotFound(found.outcome)
    }
}

/** A lookup is in flight. */
private const val FETCHING = "fetching"

/** The song has lyrics stored. */
private const val DONE = "done"

/**
 * The service answered and has nothing this song can use automatically — no record, an
 * instrumental, or candidates only the user can choose among — or no query could be formed at
 * all. The user must act; an automatic retry would change nothing.
 */
private const val NO_MATCH = "no-match"

/** The service could not be reached: offline, rate limited or an error. A retry is sensible. */
private const val FAILED = "failed"

/** Automatic lookup is switched off, so nothing has been attempted. */
private const val OFF = "off"

/**
 * Splits "nothing to take" from "could not ask", so a state is never shown as a service
 * failure when the service answered perfectly well.
 */
private fun stateFor(outcome: LookupOutcome): String =
    if (outcome == LookupOutcome.NO_ENTRY) NO_MATCH else FAILED

/**
 * Stores one LRCLIB record's lyrics as the song's lines. Called for rung 1's exact match and
 * for a candidate the user picked.
 *
 * It never writes or moves an anchor. Pins are cleared only when [consented] is true, i.e. the
 * user confirmed replacing their hand-timed lines (see [replaceSheetLines]). Without consent, a
 * song with a hand-placed pin is refused ([PrepareOutcome.RefusedHasPins]) and nothing changes:
 * the invariant is enforced here, where the data changes, not left to the caller.
 */
suspend fun adoptTrack(dao: SongDao, songId: Long, track: LrclibTrack, consented: Boolean = false): PrepareOutcome {
    if (!consented && hasUserPins(dao, songId)) return PrepareOutcome.RefusedHasPins
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
            // stored, so an earlier sheet is not thrown away for an empty one. The service
            // answered, so this is NO_MATCH, not a failure to reach it.
            dao.setPrepareState(songId, NO_MATCH)
            return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
        }
    }

    when (replaceSheetLines(dao, songId, lines, consented)) {
        SheetReplacement.REPLACED -> Unit
        SheetReplacement.REFUSED_HAS_PINS -> return PrepareOutcome.RefusedHasPins
        SheetReplacement.EMPTY -> return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
    }
    dao.setLyricsSource(songId, "lrclib")
    fillBlankNames(dao, songId, track)
    dao.setPrepareState(songId, DONE)

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

/** What [replaceSheetLines] did. */
enum class SheetReplacement {
    REPLACED,

    /** The song has a hand-placed pin and the user had not consented: nothing changed. */
    REFUSED_HAS_PINS,

    /** There were no lines to store: nothing changed (an empty sheet never replaces a real one). */
    EMPTY,
}

/**
 * The single place a song's lyric sheet is replaced, so the invariants live here and not in
 * each caller (ADR-0002). Anchors are keyed by line index, so a replaced sheet would silently
 * re-point every pin to different words:
 * - without [consented], a song with a `source = "user"` pin is **refused** and nothing changes;
 * - with [consented] (the user confirmed the hand-timed-lines warning), the pins are cleared in
 *   the same transaction as the replace, which makes "the hand-placed times will be gone" true;
 * - an **empty** [lines] never replaces or clears anything, even with consent.
 * Never pass `consented = true` from an automatic path.
 */
suspend fun replaceSheetLines(
    dao: SongDao,
    songId: Long,
    lines: List<LineEntity>,
    consented: Boolean,
): SheetReplacement {
    if (lines.isEmpty()) return SheetReplacement.EMPTY
    if (!consented && hasUserPins(dao, songId)) return SheetReplacement.REFUSED_HAS_PINS
    if (consented) dao.replaceSheetClearingAnchors(songId, lines) else dao.replaceLines(songId, lines)
    return SheetReplacement.REPLACED
}

/**
 * Stores pasted words as untimed lines. [consented] as for [replaceSheetLines]; without it a
 * song with a hand-placed pin is refused and nothing changes. Nothing usable to store is
 * [PrepareOutcome.NotFound].
 */
suspend fun adoptPastedLyrics(dao: SongDao, songId: Long, text: String, consented: Boolean): PrepareOutcome {
    if (!consented && hasUserPins(dao, songId)) return PrepareOutcome.RefusedHasPins
    val lines = splitPastedLyrics(text).mapIndexed { i, line ->
        LineEntity(songId = songId, lineIndex = i, text = line, startMs = null, endMs = null)
    }
    when (replaceSheetLines(dao, songId, lines, consented)) {
        SheetReplacement.REPLACED -> Unit
        SheetReplacement.REFUSED_HAS_PINS -> return PrepareOutcome.RefusedHasPins
        SheetReplacement.EMPTY -> return PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY)
    }
    dao.setLyricsSource(songId, "paste")
    dao.setPrepareState(songId, DONE)
    return PrepareOutcome.WordsOnly(lines.size)
}

private suspend fun hasUserPins(dao: SongDao, songId: Long) = dao.anchors(songId).any { it.source == "user" }
