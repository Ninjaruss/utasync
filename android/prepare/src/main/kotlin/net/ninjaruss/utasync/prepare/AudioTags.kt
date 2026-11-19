package net.ninjaruss.utasync.prepare

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri

/** What we know about a song from its file. Null means "the file did not say", never a guess. */
data class AudioTags(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
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
            album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM).blankToNull(),
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

/**
 * Best-effort tags from a display name: "Artist - Title.ext", optionally preceded by a track
 * number. Only a spaced dash separates, so "Jay-Z" and underscored names stay whole.
 */
fun tagsFromFilename(displayName: String): AudioTags {
    var parts = displayName.replace(EXTENSION, "").split(SEPARATOR).map { it.trim() }
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
    album = embedded.album.blankToNull() ?: fromName.album.blankToNull(),
    durationMs = embedded.durationMs ?: fromName.durationMs,
)

private fun String?.blankToNull(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
