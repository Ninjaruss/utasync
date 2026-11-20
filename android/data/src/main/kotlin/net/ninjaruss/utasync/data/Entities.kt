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
    /**
     * What preparation has been **attempted**. It deliberately says nothing about what the lines
     * contain — readiness for singing is derived from the lines themselves — so the two cannot
     * drift apart.
     *
     * Every value lives in [PrepareState]; nothing may write a string that is not one of them,
     * because [readinessOf] can only fall back to "no lyrics yet" for a state it cannot read.
     *
     * - `"pending"` — nothing attempted yet.
     * - `"fetching"` — a lookup is in flight.
     * - `"done"` — lyrics are stored.
     * - `"no-match"` — the service answered and has nothing this song can use automatically (no
     *   record, an instrumental, or candidates only the user can choose among), or no query
     *   could be formed. The user must act; an automatic retry would change nothing.
     * - `"failed"` — the service could not be reached: offline or an error. A retry is sensible.
     * - `"rate-limited"` — the service WAS reached and asked us to wait. No retry is offered.
     * - `"off"` — automatic lookup is switched off, so nothing has been attempted.
     *
     * `"no-match"`, `"failed"` and `"rate-limited"` are deliberately separate: showing "couldn't
     * reach the service" when the service answered perfectly well — or when it answered by asking
     * us to wait — is the kind of dishonest label this project has already paid for once.
     */
    val prepareState: String = "pending",
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
    /**
     * Wall-clock time this row was written, stamped by [SongDao.upsertUser]/[SongDao.upsertAuto].
     * Callers leave it at 0; the DAO fills it in. It exists so that "the most recent correction
     * wins" is available to [resolveStarts] as a conflict rule without a later schema migration
     * (the app has never shipped, so the column is free today and costs a migration tomorrow).
     * The resolver does not use it yet — see its KDoc.
     */
    val writtenAtMs: Long = 0,
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
