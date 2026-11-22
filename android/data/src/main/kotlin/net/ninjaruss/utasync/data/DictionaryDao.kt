package net.ninjaruss.utasync.data

import androidx.room.Dao
import androidx.room.Query

/** Read-only lookups into the bundled dictionary. Exact keys; there is no search. */
@Dao
interface DictionaryDao {
    /** Every sense group of [surface], in display order. Empty if the word is not in the dictionary. */
    @Query("SELECT * FROM dictionary WHERE surface = :surface ORDER BY senseIndex")
    suspend fun entriesFor(surface: String): List<DictionaryEntity>

    /** The sense groups of [surface] read as [reading], in display order. */
    @Query("SELECT * FROM dictionary WHERE surface = :surface AND reading = :reading ORDER BY senseIndex")
    suspend fun entriesFor(surface: String, reading: String): List<DictionaryEntity>
}
