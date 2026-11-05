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
import kotlin.math.roundToLong

/** Adds a local audio file to the library without copying it (persisted read permission). */
suspend fun importAudio(context: Context, dao: SongDao, uri: Uri): Long = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        ?: "Untitled"
    dao.insertSong(
        SongEntity(
            title = name.substringBeforeLast('.'),
            audioUri = uri.toString(),
            createdAtMs = System.currentTimeMillis(),
        ),
    )
}

/** Replaces a song's lines with a synced .lrc file. Returns the number of lines imported. */
suspend fun importLrc(context: Context, dao: SongDao, songId: Long, uri: Uri): Int = withContext(Dispatchers.IO) {
    val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        ?: return@withContext 0
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
    dao.replaceLines(songId, lines)
    lines.size
}
