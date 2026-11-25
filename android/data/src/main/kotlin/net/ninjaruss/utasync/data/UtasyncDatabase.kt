package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [SongEntity::class, LineEntity::class, AnchorEntity::class, AlignmentRunEntity::class, DictionaryEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(GlossConverter::class)
abstract class UtasyncDatabase : RoomDatabase() {
    abstract fun songDao(): SongDao

    abstract fun dictionaryDao(): DictionaryDao

    companion object {
        /** The prebuilt file holding every table, the dictionary filled in. See [seedBuilder]. */
        const val SEED_ASSET = "utasync-seed.db"

        fun create(context: Context): UtasyncDatabase = seedBuilder(context, "utasync.db").build()

        /**
         * `createFromAsset` copies the whole file on first creation, so the asset must hold every
         * table of this schema, not only the dictionary: `scripts/build-japanese-db.mjs` builds it
         * from the exported schema in `data/schemas`, and `tests/scripts` fails if the two drift.
         */
        fun seedBuilder(context: Context, name: String): RoomDatabase.Builder<UtasyncDatabase> =
            Room.databaseBuilder(context.applicationContext, UtasyncDatabase::class.java, name)
                .createFromAsset(SEED_ASSET)
    }
}
