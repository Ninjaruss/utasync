package net.ninjaruss.utasync

import android.app.Application
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.data.UtasyncDatabase
import net.ninjaruss.utasync.prepare.FetchSetting
import net.ninjaruss.utasync.prepare.Lrclib
import net.ninjaruss.utasync.prepare.UrlConnectionHttp
import net.ninjaruss.utasync.prepare.prepareSong

/** Manual dependency wiring: one database for the process. No DI framework until needed. */
class UtasyncApplication : Application() {
    val database: UtasyncDatabase by lazy { UtasyncDatabase.create(this) }

    /**
     * Process-lifetime scope for lyric lookups. A screen's own scope is cancelled when the
     * screen leaves composition, which would strand a song at `"fetching"` forever. This scope
     * outlives navigation and rotation. It does **not** outlive the process: see
     * [resetInterruptedLookups].
     */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The one LRCLIB client, shared by background lookups and the lyrics screen. */
    val lrclib by lazy {
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull()
        Lrclib(UrlConnectionHttp(), version ?: "0")
    }

    // A fetch can only be in flight inside a running process, so any song stored as "fetching" at
    // startup was cut off by the process dying. Lookups wait for this, so it cannot undo one.
    private val resetInterruptedLookups = appScope.launch(start = CoroutineStart.LAZY) {
        try {
            database.songDao().resetInterruptedLookups()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Log the failure's type only: no song title, artist, URI or path.
            Log.w("Utasync", "startup lookup reset failed: ${e.javaClass.simpleName}")
            // Must not escape to the thread's uncaught handler. The lookup waiting on this may
            // proceed: the worst case is a stale "fetching" label that its own write corrects.
        }
    }

    override fun onCreate() {
        super.onCreate()
        resetInterruptedLookups.start()
    }

    /**
     * Looks lyrics up for [songId] without blocking the caller. The result is not returned: every
     * state the user needs is written to the song's `prepareState` and lines, which the screens
     * observe. Never replaces a pinned song's sheet (`allowReplaceSheet` stays false).
     */
    fun lookUpLyrics(songId: Long) {
        appScope.launch {
            resetInterruptedLookups.join()
            val dao = database.songDao()
            val song = dao.song(songId) ?: return@launch
            try {
                prepareSong(dao, lrclib, song, fetchEnabled = FetchSetting(this@UtasyncApplication).enabled)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Never leave "fetching" behind: an unexpected error is a lookup that did not
                // complete, which is what "failed" means. Nothing about the song is logged.
                dao.setPrepareState(songId, "failed")
            }
        }
    }
}
