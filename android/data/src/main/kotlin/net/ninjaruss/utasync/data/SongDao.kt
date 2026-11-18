package net.ninjaruss.utasync.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
abstract class SongDao {
    @Query("SELECT * FROM songs ORDER BY createdAtMs DESC")
    abstract fun observeSongs(): Flow<List<SongEntity>>

    @Query("SELECT * FROM songs WHERE id = :id")
    abstract fun observeSong(id: Long): Flow<SongEntity?>

    @Insert
    abstract suspend fun insertSong(song: SongEntity): Long

    @Query("SELECT * FROM lines WHERE songId = :songId ORDER BY lineIndex")
    abstract fun observeLines(songId: Long): Flow<List<LineEntity>>

    @Query("DELETE FROM lines WHERE songId = :songId")
    protected abstract suspend fun deleteLines(songId: Long)

    @Insert
    protected abstract suspend fun insertLines(lines: List<LineEntity>)

    /** Replaces a song's lyric text and computed timings. Anchors are kept. */
    @Transaction
    open suspend fun replaceLines(songId: Long, lines: List<LineEntity>) {
        deleteLines(songId)
        insertLines(lines)
    }

    @Query("SELECT * FROM anchors WHERE songId = :songId ORDER BY lineIndex")
    abstract suspend fun anchors(songId: Long): List<AnchorEntity>

    /** Live view of the pins, so a screen showing timings updates the moment one is saved. */
    @Query("SELECT * FROM anchors WHERE songId = :songId ORDER BY lineIndex")
    abstract fun observeAnchors(songId: Long): Flow<List<AnchorEntity>>

    /**
     * Raw row write. **Protected on purpose**: it accepts any [AnchorEntity.source], and there is
     * one anchor row per line, so an "auto" row written this way would silently destroy a user's
     * pin — the predecessor's exact failure (ADR-0002). The only doors out of this class are
     * [upsertUser] and [upsertAuto], which each enforce their half of the rule. Do not widen it.
     */
    @Upsert
    protected abstract suspend fun upsertAnchor(anchor: AnchorEntity)

    @Query("SELECT * FROM anchors WHERE songId = :songId AND lineIndex = :lineIndex")
    protected abstract suspend fun anchorOn(songId: Long, lineIndex: Int): AnchorEntity?

    /** Clock for [AnchorEntity.writtenAtMs]. Overridable so a test can write a known time. */
    protected open fun nowMs(): Long = System.currentTimeMillis()

    /**
     * The ONLY way a user's timing may be stored as a pin. A user pin replaces whatever is on the
     * line (an earlier user pin or an auto one): the user is the authority.
     */
    @Transaction
    open suspend fun upsertUser(anchor: AnchorEntity) {
        require(anchor.source == "user") { "upsertUser stores user anchors only" }
        upsertAnchor(anchor.copy(writtenAtMs = nowMs()))
    }

    /**
     * The ONLY way an automatic timing may be stored as a pin. There is one anchor row per line, so
     * a plain upsert of an "auto" anchor would silently replace a user's pin; this refuses
     * to. It replaces an earlier auto pin, never a user one. Returns whether it wrote.
     */
    @Transaction
    open suspend fun upsertAuto(anchor: AnchorEntity): Boolean {
        require(anchor.source == "auto") { "upsertAuto stores auto anchors only" }
        if (anchorOn(anchor.songId, anchor.lineIndex)?.source == "user") return false
        upsertAnchor(anchor.copy(writtenAtMs = nowMs()))
        return true
    }

    /**
     * Removes the pin on one line, so a bad correction can be undone without deleting the song.
     * The line falls back to its computed time (see [resolveStarts]). No-op when there is no pin.
     */
    @Query("DELETE FROM anchors WHERE songId = :songId AND lineIndex = :lineIndex")
    abstract suspend fun deleteAnchor(songId: Long, lineIndex: Int)

    @Insert
    abstract suspend fun insertRun(run: AlignmentRunEntity): Long
}
