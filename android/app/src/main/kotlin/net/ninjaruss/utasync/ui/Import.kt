package net.ninjaruss.utasync.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.ninjaruss.utasync.align.parseLrc
import net.ninjaruss.utasync.data.LineEntity
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.SongEntity
import net.ninjaruss.utasync.prepare.SheetReplacement
import net.ninjaruss.utasync.prepare.mergeTags
import net.ninjaruss.utasync.prepare.readTags
import net.ninjaruss.utasync.prepare.replaceSheetLines
import net.ninjaruss.utasync.prepare.tagsFromFilename
import kotlin.math.roundToLong

/** Adds a local audio file to the library without copying it (persisted read permission). */
suspend fun importAudio(context: Context, dao: SongDao, uri: Uri): Long = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        ?: "Untitled"
    val tags = mergeTags(readTags(context, uri), tagsFromFilename(name))
    dao.insertSong(
        SongEntity(
            title = tags.title ?: name.substringBeforeLast('.'),
            artist = tags.artist.orEmpty(),
            durationMs = tags.durationMs,
            audioUri = uri.toString(),
            createdAtMs = System.currentTimeMillis(),
        ),
    )
}

/** What [importLrc] did. */
sealed interface LrcImport {
    data class Imported(val lineCount: Int) : LrcImport

    /** The song has hand-placed pins and the import was not consented to: nothing changed. */
    data object RefusedHasPins : LrcImport

    /** The file was unreadable or held no timed lines: nothing changed. */
    data object NoLines : LrcImport
}

/** Replaces a song's lines with a synced .lrc file; see [replaceSheetLines] for the guards. */
suspend fun importLrc(context: Context, dao: SongDao, songId: Long, uri: Uri, consented: Boolean = false): LrcImport =
    withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: return@withContext LrcImport.NoLines
        val rows = parseLrc(text)
        val lines = rows.mapIndexed { i, row ->
            LineEntity(
                songId = songId,
                lineIndex = i,
                text = row.text,
                startMs = (row.timeSec * 1000).roundToLong(),
                endMs = rows.getOrNull(i + 1)?.let { (it.timeSec * 1000).roundToLong() },
            )
        }
        when (replaceSheetLines(dao, songId, lines, consented)) {
            SheetReplacement.REPLACED -> LrcImport.Imported(lines.size)
            SheetReplacement.REFUSED_HAS_PINS -> LrcImport.RefusedHasPins
            SheetReplacement.EMPTY -> LrcImport.NoLines
        }
    }
