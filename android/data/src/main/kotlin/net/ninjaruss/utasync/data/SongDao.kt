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

    @Upsert
    abstract suspend fun upsertAnchor(anchor: AnchorEntity)

    @Insert
    abstract suspend fun insertRun(run: AlignmentRunEntity): Long
}
