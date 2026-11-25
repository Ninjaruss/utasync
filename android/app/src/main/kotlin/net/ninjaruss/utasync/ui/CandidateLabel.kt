package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.align.Sheet
import net.ninjaruss.utasync.align.sheetFrom
import net.ninjaruss.utasync.prepare.LrclibTrack

/**
 * One line that tells a choosable record apart from its siblings: name, artist, album, length and
 * whether it is timed. Length and timed/words-only are the signals that separate a studio cut from
 * a live take or a remaster, and they are what the user decides on. This ranks nothing and scores
 * nothing: the user picks (CLAUDE.md rule 2).
 *
 * "timed" is judged by what adopting the record would store ([sheetFrom]), so the label cannot
 * promise timings a tap would not deliver.
 */
fun candidateLabel(track: LrclibTrack): String {
    val lyrics = when (sheetFrom(track.syncedLyrics, track.plainLyrics, track.instrumental)) {
        is Sheet.Timed -> "timed"
        is Sheet.Untimed -> "words only"
        Sheet.None -> if (track.instrumental) "instrumental" else "no lyrics"
    }
    return listOfNotNull(
        track.trackName,
        track.artistName.takeIf { it.isNotBlank() },
        track.albumName?.takeIf { it.isNotBlank() },
        track.durationSec?.let { "${it / 60}:${(it % 60).toString().padStart(2, '0')}" } ?: "length unknown",
        lyrics,
    ).joinToString(" · ")
}
