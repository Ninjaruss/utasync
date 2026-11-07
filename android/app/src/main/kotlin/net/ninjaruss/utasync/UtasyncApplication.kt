package net.ninjaruss.utasync

import android.app.Application
import net.ninjaruss.utasync.data.UtasyncDatabase

/** Manual dependency wiring: one database for the process. No DI framework until needed. */
class UtasyncApplication : Application() {
    val database: UtasyncDatabase by lazy { UtasyncDatabase.create(this) }
}
