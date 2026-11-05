package net.ninjaruss.utasync.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/** A song in the library. [audioUri] is a persisted SAF content URI; the audio is not copied. */
@Entity(tableName = "songs")
data class SongEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val artist: String = "",
    val audioUri: String,
    val durationMs: Long? = null,
    /** Where the lyric text came from: "lrc-file", "embedded", "lrclib", "paste". */
    val lyricsSource: String? = null,
    val createdAtMs: Long,
)

/** One lyric line. Times are the latest COMPUTED timing; user fixes live in [AnchorEntity]. */
@Entity(
    tableName = "lines",
    primaryKeys = ["songId", "lineIndex"],
    foreignKeys = [ForeignKey(SongEntity::class, ["id"], ["songId"], onDelete = ForeignKey.CASCADE)],
)
data class LineEntity(
    val songId: Long,
    val lineIndex: Int,
    val text: String,
    val startMs: Long?,
    val endMs: Long?,
    /** Calibrated probability that the start is within 0.5 s, when an aligner produced it. */
    val confidence: Float? = null,
)

/**
 * A hard pin on a line start (ADR-0002). Stored apart from computed timings so no
 * re-alignment can overwrite a user fix.
 */
@Entity(
    tableName = "anchors",
    primaryKeys = ["songId", "lineIndex"],
    foreignKeys = [ForeignKey(SongEntity::class, ["id"], ["songId"], onDelete = ForeignKey.CASCADE)],
)
data class AnchorEntity(
    val songId: Long,
    val lineIndex: Int,
    val timeMs: Long,
    /** "user" or "auto". */
    val source: String,
)

/** Provenance of every alignment, so a better engine can re-prepare and be compared. */
@Entity(
    tableName = "alignment_runs",
    foreignKeys = [ForeignKey(SongEntity::class, ["id"], ["songId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("songId")],
)
data class AlignmentRunEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val songId: Long,
    /** e.g. "lrc-as-is", "whisper-knowntext-windowed". */
    val method: String,
    val modelSha256: String?,
    val createdAtMs: Long,
    /** Small JSON summary (median shift, flagged lines); never lyric text. */
    val summaryJson: String,
)
