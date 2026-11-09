package net.ninjaruss.utasync.playback

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.session.MediaController

/**
 * Turns drag positions into audible seeks without flooding the player.
 *
 * A finger drag emits hundreds of events per second; seeking on each would queue seeks and
 * make the audio lag behind the thumb. So seeks are coalesced: the first position in a window
 * seeks at once (the drag is audible immediately), later ones are held, and when the window
 * ends only the **latest** held position is seeked to. At most one seek per
 * [COALESCE_WINDOW_MS]; the last position always wins. [stop] drops the held position, so no
 * seek happens after the finger lifts.
 *
 * Free of Android UI types: time and scheduling come from [Timer], so tests are deterministic.
 */
class Scrubber(private val seek: (Long) -> Unit, private val timer: Timer) {

    /** Clock and delayed-callback source. [postDelayed] returns a cancel function. */
    interface Timer {
        fun nowMs(): Long
        fun postDelayed(delayMs: Long, run: () -> Unit): () -> Unit
    }

    private var lastSeekAt = Long.MIN_VALUE
    private var pending: Long? = null
    private var cancelFlush: (() -> Unit)? = null

    /** Production constructor: seeks [controller] on the main looper. */
    constructor(controller: MediaController) : this({ controller.seekTo(it) }, MainTimer)

    fun scrubTo(positionMs: Long) {
        val now = timer.nowMs()
        if (lastSeekAt == Long.MIN_VALUE || now - lastSeekAt >= COALESCE_WINDOW_MS) {
            cancelFlush?.invoke()
            cancelFlush = null
            pending = null
            doSeek(positionMs, now)
        } else {
            val firstHeld = pending == null
            pending = positionMs
            if (firstHeld) {
                cancelFlush = timer.postDelayed(COALESCE_WINDOW_MS - (now - lastSeekAt)) { flush() }
            }
        }
    }

    /** Ends scrubbing. Issues no seek; a held position is discarded. */
    fun stop() {
        cancelFlush?.invoke()
        cancelFlush = null
        pending = null
        lastSeekAt = Long.MIN_VALUE
    }

    private fun flush() {
        cancelFlush = null
        val p = pending ?: return
        pending = null
        doSeek(p, timer.nowMs())
    }

    private fun doSeek(positionMs: Long, now: Long) {
        lastSeekAt = now
        seek(positionMs)
    }

    private object MainTimer : Timer {
        private val handler = Handler(Looper.getMainLooper())
        override fun nowMs() = SystemClock.uptimeMillis()
        override fun postDelayed(delayMs: Long, run: () -> Unit): () -> Unit {
            val r = Runnable(run)
            handler.postDelayed(r, delayMs)
            return { handler.removeCallbacks(r) }
        }
    }

    companion object {
        /**
         * 60 ms: a judgement, not measured (ledger L44). About four 60 Hz frames: short enough
         * that audio tracks the thumb, long enough to cap a drag at ~16 seeks/s.
         */
        const val COALESCE_WINDOW_MS = 60L
    }
}
