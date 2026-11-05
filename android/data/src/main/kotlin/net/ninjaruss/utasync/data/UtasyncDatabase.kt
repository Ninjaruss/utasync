package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [SongEntity::class, LineEntity::class, AnchorEntity::class, AlignmentRunEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class UtasyncDatabase : RoomDatabase() {
    abstract fun songDao(): SongDao

    companion object {
        fun create(context: Context): UtasyncDatabase =
            Room.databaseBuilder(context.applicationContext, UtasyncDatabase::class.java, "utasync.db").build()
    }
}
