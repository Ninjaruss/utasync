package net.ninjaruss.utasync.ui

import kotlin.math.roundToLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import net.ninjaruss.utasync.data.AnchorEntity
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.playback.Envelope

/** What the waveform behind the nudge handle is doing. */
sealed interface WaveformStatus {
    /** Decoding. The handle still works: scrubbing needs the player, not the picture. */
    data object Loading : WaveformStatus
    data class Ready(val envelope: Envelope) : WaveformStatus
    /** Unreadable audio (moved file, revoked SAF permission). The handle is disabled. */
    data class Failed(val message: String) : WaveformStatus
}

/**
 * All arithmetic of the nudge screen, free of Compose so it is unit-testable.
 *
 * One timestamp per line; ends are implied, never stored. Only this line moves: nothing here
 * knows about, or can change, any other line. [original] is kept untouched for display
 * (amber) while [proposedMs] (blue) follows the finger. [original] is null for a line with no
 * computed time (lyrics pasted without timings); such a line is still nudgeable from the drag
 * alone.
 *
 * [neighbourBefore]/[neighbourAfter] are the nearest timed lines' effective starts (anchor if
 * pinned, else computed). Proposals are clamped to [MIN_GAP_MS] away from them.
 */
class NudgeState(val original: Long?, val neighbourBefore: Long?, val neighbourAfter: Long?) {

    private val proposal = MutableStateFlow(original)
    private val clamped = MutableStateFlow(false)
    private val waveformFlow = MutableStateFlow<WaveformStatus>(WaveformStatus.Loading)

    /** Observable proposal for the UI; null until a null-original line is first dragged. */
    val proposedFlow: StateFlow<Long?> get() = proposal
    val clampedFlow: StateFlow<Boolean> get() = clamped
    val waveform: StateFlow<WaveformStatus> get() = waveformFlow

    val proposedMs: Long? get() = proposal.value

    /** True when the last [drag]/[fine] was pulled back by a neighbour (or the song's ends). */
    val isClamped: Boolean get() = clamped.value

    /** The handle and fine buttons are dead when the audio is unreadable. */
    val handleEnabled: Boolean get() = waveformFlow.value !is WaveformStatus.Failed

    val canSave: Boolean get() = proposedMs != null && proposedMs != original

    fun drag(toMs: Long) {
        if (!handleEnabled) return
        set(toMs)
    }

    /** Moves the proposal by [deltaMs]. No-op until there is a proposal to move (null original, not yet dragged). */
    fun fine(deltaMs: Long) {
        if (!handleEnabled) return
        val base = proposedMs ?: return
        set(base + deltaMs)
    }

    /** One anchor, source "user". Throws if there is no proposal; guard with [canSave]. */
    fun toAnchor(songId: Long, lineIndex: Int): AnchorEntity =
        AnchorEntity(songId, lineIndex, checkNotNull(proposedMs) { "no proposed time" }, "user")

    /**
     * Runs [decode] and publishes the result. Stays [WaveformStatus.Loading] while it runs;
     * cancellation propagates and leaves Loading (nothing is leaked: the decode is the caller's coroutine).
     */
    suspend fun load(decode: suspend () -> Result<Envelope>) {
        waveformFlow.value = WaveformStatus.Loading
        val r = decode()
        waveformFlow.value = r.fold(
            onSuccess = { WaveformStatus.Ready(it) },
            onFailure = { WaveformStatus.Failed(UNREADABLE_MESSAGE) },
        )
    }

    /** Where the view should centre when it opens. */
    fun initialCenterMs(): Long = original
        ?: if (neighbourBefore != null && neighbourAfter != null) (neighbourBefore + neighbourAfter) / 2
        else neighbourBefore ?: neighbourAfter ?: 0L

    private fun set(requested: Long) {
        val lo = maxOf(0L, neighbourBefore?.plus(MIN_GAP_MS) ?: 0L)
        val hi = neighbourAfter?.minus(MIN_GAP_MS)
            ?: (waveformFlow.value as? WaveformStatus.Ready)?.envelope?.durationMs
            ?: Long.MAX_VALUE
        // Neighbours closer than 2 * MIN_GAP_MS leave no legal slot; the lower bound wins.
        val v = maxOf(lo, minOf(requested, hi))
        clamped.value = v != requested
        proposal.value = v
    }

    companion object {
        /** Equals `applyAnchors`'s `minGapSec` default (0.05 s): a stored time the align module would move is a defect. */
        const val MIN_GAP_MS = 50L
        /** The `±0.1 s` buttons. */
        const val FINE_STEP_MS = 100L

        const val UNREADABLE_MESSAGE =
            "Couldn't read this song's audio, so there is no waveform. The file may have been moved, " +
                "or access to it was revoked. Add the song again to fix its timing."

        /** Nearest timed line before and after [index] in [effectiveStarts] (anchor-overlaid starts). */
        fun forLine(effectiveStarts: List<Long?>, index: Int): NudgeState = NudgeState(
            original = effectiveStarts.getOrNull(index),
            neighbourBefore = (index - 1 downTo 0).firstNotNullOfOrNull { effectiveStarts[it] },
            neighbourAfter = (index + 1 until effectiveStarts.size).firstNotNullOfOrNull { effectiveStarts[it] },
        )
    }
}

/**
 * Persists a nudge: exactly one anchor row, through the user door ([SongDao.upsertUser]), which
 * is the only way a "user" pin may be stored. No [net.ninjaruss.utasync.data.LineEntity] is
 * written, so computed timings are untouched and re-alignment cannot undo the fix.
 */
suspend fun NudgeState.save(dao: SongDao, songId: Long, lineIndex: Int) {
    dao.upsertUser(toAnchor(songId, lineIndex))
}

/** Removes this line's pin, so a bad correction can be undone. The computed time comes back. */
suspend fun clearPin(dao: SongDao, songId: Long, lineIndex: Int) {
    dao.deleteAnchor(songId, lineIndex)
}

/** Maps screen x to song time for a fixed-span view. Pure so the drag mapping is testable. */
data class NudgeWindow(val startMs: Long, val spanMs: Long) {
    fun msAt(x: Float, widthPx: Float): Long =
        startMs + (x.coerceIn(0f, widthPx) / widthPx * spanMs).roundToLong()

    fun xAt(ms: Long, widthPx: Float): Float = (ms - startMs).toFloat() / spanMs * widthPx

    companion object {
        /** 12 s of song across the screen: a judgement (ledger L45), about two or three sung lines. */
        const val SPAN_MS = 12_000L

        fun around(centerMs: Long, spanMs: Long = SPAN_MS) = NudgeWindow(maxOf(0L, centerMs - spanMs / 2), spanMs)
    }
}
