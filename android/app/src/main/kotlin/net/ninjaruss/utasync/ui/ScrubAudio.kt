package net.ninjaruss.utasync.ui

import androidx.media3.session.MediaController
import net.ninjaruss.utasync.playback.Scrubber

/** The slice of the player [ScrubAudio] drives; a fake in tests. */
interface PreviewPlayer {
    val isPlaying: Boolean
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
}

fun MediaController.asPreviewPlayer() = object : PreviewPlayer {
    override val isPlaying get() = this@asPreviewPlayer.isPlaying
    override fun play() = this@asPreviewPlayer.play()
    override fun pause() = this@asPreviewPlayer.pause()
    override fun seekTo(positionMs: Long) = this@asPreviewPlayer.seekTo(positionMs)
}

/**
 * Makes the nudge handle audible, whether or not the player was playing when the screen opened.
 *
 * **Why this design.** `seekTo` on a paused ExoPlayer is silent, so a bare [Scrubber] would
 * give a mute drag whenever the song was paused (the common case). Options weighed:
 * (a) leave the player playing for the whole drag: audio runs ahead of a stationary thumb, so
 * it stops being "the audio under your thumb"; (b) preview bursts after every seek: needs a
 * timer per seek and sounds chopped; (c) **chosen**: the first drag event starts playback,
 * the [Scrubber] keeps re-seeking it under the thumb, and when the finger stops moving for
 * [IDLE_PAUSE_MS] the player is paused, resuming on the next movement. A held finger therefore
 * repeats the sound at its spot rather than running away, and a moving finger hears continuous
 * audio. One constant, judged not measured (ledger L45).
 *
 * On release the play/pause state from before the gesture is restored, and the player is
 * seeked to the **finger's own last position** supplied by the caller. [Scrubber.stop] drops
 * any position held in its 60 ms window, so the player alone can lag the thumb; the caller's
 * value is the truth and is what gets saved.
 */
class ScrubAudio(
    private val player: PreviewPlayer,
    private val scrubber: Scrubber,
    private val timer: Scrubber.Timer,
) {
    private var active = false
    private var wasPlaying = false
    private var dragging = false
    private var cancelIdle: (() -> Unit)? = null

    fun begin() {
        enter()
        dragging = true
    }

    /** The finger is at [positionMs]: make it audible. */
    fun move(positionMs: Long) {
        enter()
        scrubber.scrubTo(positionMs)
        if (!player.isPlaying) player.play()
        armIdle()
    }

    /** The finger lifted at [finalMs] (the caller's own last position, not the player's). */
    fun release(finalMs: Long) {
        cancelIdle?.invoke(); cancelIdle = null
        scrubber.stop()
        dragging = false
        player.seekTo(finalMs)
        finish()
    }

    /** A fine-step button: seek straight there, sound briefly, then restore. */
    fun preview(positionMs: Long) {
        enter()
        player.seekTo(positionMs)
        if (!player.isPlaying) player.play()
        armIdle()
    }

    /** The screen is going away mid-gesture: leave the player as we found it. */
    fun abandon() {
        cancelIdle?.invoke(); cancelIdle = null
        scrubber.stop()
        dragging = false
        if (active) finish()
    }

    private fun enter() {
        if (!active) {
            active = true
            wasPlaying = player.isPlaying
        }
    }

    private fun armIdle() {
        cancelIdle?.invoke()
        cancelIdle = timer.postDelayed(IDLE_PAUSE_MS) {
            cancelIdle = null
            if (dragging) player.pause() else finish()
        }
    }

    private fun finish() {
        active = false
        if (wasPlaying) player.play() else player.pause()
    }

    companion object {
        /** 150 ms: a judgement, not measured (ledger L45): above the 60 ms seek window, below a felt pause. */
        const val IDLE_PAUSE_MS = 150L
    }
}
