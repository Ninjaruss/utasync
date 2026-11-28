package net.ninjaruss.utasync.prepare

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri

/** What we know about a song from its file. Null means "the file did not say", never a guess. */
data class AudioTags(
    val title: String? = null,
    val artist: String? = null,
    // No album: nothing reads one. It was read from the file and merged, but never stored and
    // never sent (see TrackQuery), so it only made the documentation claim more than was true.
    val durationMs: Long? = null,
)

/**
 * Reads embedded tags. Never throws: a corrupt file, an unsupported format or a lapsed URI
 * permission yields empty tags so the song still imports.
 */
fun readTags(context: Context, uri: Uri): AudioTags {
    // MediaMetadataRetriever is AutoCloseable only from API 29; minSdk is 26, so no use {}.
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(context, uri)
        AudioTags(
            title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE).blankToNull(),
            artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST).blankToNull(),
            durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.trim()?.toLongOrNull()?.takeIf { it > 0 },
        )
    } catch (_: Exception) {
        AudioTags()
    } finally {
        try {
            retriever.release()
        } catch (_: Exception) {
            // Nothing useful to do; the tags are already decided.
        }
    }
}

private val EXTENSION = Regex("""\.[A-Za-z0-9]{1,5}$""")
private val TRACK_NUMBER = Regex("""\d{1,3}\.?""")
private const val SEPARATOR = " - "

/** The last `-`, `_` or space separated token, with whatever comes before it. */
private val LAST_TOKEN = Regex("""^(.*[^-_ ])[-_ ]+([^-_ ]+)$""")

/**
 * A lowercase hostname: labels joined by dots, ending in an all-letter top level. Uppercase is
 * excluded because a download site's host never has any and a song's own words often do.
 */
private val HOST = Regex("""^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$""")

/** A bitrate as a downloader writes it: `128`, `320k`, `192kbps`. */
private val BITRATE = Regex("""^\d{2,4}k?(?:bps)?$""", RegexOption.IGNORE_CASE)

/**
 * Removes a download site's tail — a bitrate and a hostname, as in `…-128-ytshorts.savetube.me`
 * — and nothing else. Every audio file the owner has is shaped this way, and the tail both
 * breaks the lookup and fills the title bar with a hostname (ledger L67).
 *
 * It is deliberately hard to trigger, because there is still no way to rename a song in the app,
 * so a word taken off a real title could not be put back. Two shapes count as a tail, and both
 * are unmistakably a machine's: a host with **two or more** dots, or a host of any depth with a
 * bitrate immediately before it. A bare number is never dropped on its own — "Song - 1999" and
 * "Blink-182 - 2001" are ordinary names — and neither is a single dotted word such as
 * "Song.live". Measured on the owner's ten files: 1 searchable before, 2 after, 7 titles made
 * readable, 0 of 6 adversarial names touched.
 */
private fun dropDownloaderTail(name: String): String {
    val host = LAST_TOKEN.matchEntire(name) ?: return name
    val (beforeHost, hostToken) = host.destructured
    if (!HOST.matches(hostToken)) return name
    val twoDots = hostToken.count { it == '.' } >= 2
    val rate = LAST_TOKEN.matchEntire(beforeHost)
    val hasRate = rate != null && BITRATE.matches(rate.groupValues[2])
    val stripped = when {
        hasRate -> rate!!.groupValues[1]
        twoDots -> beforeHost
        else -> return name
    }
    // A song must keep a name. If the file was named after nothing but its tail, the junk is all
    // there is, and a blank title — or one that is only a bitrate — would be worse than the junk:
    // it cannot be looked up, and it cannot be told from another such song in the library.
    return if (stripped.isBlank() || BITRATE.matches(stripped)) name else stripped
}

/**
 * Best-effort tags from a display name: "Artist - Title.ext", optionally preceded by a track
 * number, with any download site's tail removed first (see [dropDownloaderTail]). Only a spaced
 * dash separates, so "Jay-Z" and underscored names stay whole.
 */
fun tagsFromFilename(displayName: String): AudioTags {
    val name = dropDownloaderTail(displayName.replace(EXTENSION, ""))
    var parts = name.split(SEPARATOR).map { it.trim() }
    if (parts.size > 1 && TRACK_NUMBER.matches(parts[0])) parts = parts.drop(1)
    return when {
        parts.size >= 2 -> AudioTags(
            artist = parts[0].blankToNull(),
            title = parts.drop(1).joinToString(SEPARATOR).blankToNull(),
        )
        else -> AudioTags(title = parts.firstOrNull().blankToNull())
    }
}

/** Embedded tags win field by field; a blank one does not. Only the file knows the duration. */
fun mergeTags(embedded: AudioTags, fromName: AudioTags): AudioTags = AudioTags(
    title = embedded.title.blankToNull() ?: fromName.title.blankToNull(),
    artist = embedded.artist.blankToNull() ?: fromName.artist.blankToNull(),
    durationMs = embedded.durationMs ?: fromName.durationMs,
)

private fun String?.blankToNull(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
