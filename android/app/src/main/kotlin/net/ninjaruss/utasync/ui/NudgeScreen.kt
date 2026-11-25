package net.ninjaruss.utasync.ui

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.session.MediaController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.resolveStarts
import net.ninjaruss.utasync.playback.Envelope
import net.ninjaruss.utasync.playback.Scrubber
import net.ninjaruss.utasync.playback.decodeEnvelope

private val Amber = Color(0xFFFFB300)
private val Blue = Color(0xFF1E88E5)

private object HandlerTimer : Scrubber.Timer {
    private val handler = Handler(Looper.getMainLooper())
    override fun nowMs() = SystemClock.uptimeMillis()
    override fun postDelayed(delayMs: Long, run: () -> Unit): () -> Unit {
        val r = Runnable(run)
        handler.postDelayed(r, delayMs)
        return { handler.removeCallbacks(r) }
    }
}

/**
 * Place a line's start by ear: drag the handle along the waveform and hear the song under your
 * thumb ([ScrubAudio]). Original time in amber, proposal in blue. Draws [NudgeState]; owns no
 * arithmetic. [controller] is the shared player, already holding this song's media item.
 *
 * The waveform decodes in the background behind an honest "Reading waveform" state: the track
 * and handle work immediately (they need only the player), the picture appears when ready,
 * and a failed decode shows a message and disables the handle. Leaving cancels the decode.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NudgeScreen(
    songId: Long,
    lineIndex: Int,
    dao: SongDao,
    controller: MediaController?,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    val song by dao.observeSong(songId).collectAsStateWithLifecycle(initialValue = null)
    val lines by dao.observeLines(songId).collectAsStateWithLifecycle(initialValue = null)
    val loadedLines = lines
    val audioUri = song?.audioUri
    if (loadedLines == null || audioUri == null || lineIndex !in loadedLines.indices) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    // Anchors win over computed starts: they are what the player shows.
    // An unsaved drag survives rotation (the waveform does not; it decodes again).
    var savedProposal by rememberSaveable(songId, lineIndex) { mutableStateOf<Long?>(null) }
    val state by produceState<NudgeState?>(null, songId, lineIndex) {
        value = NudgeState.forLine(resolveStarts(loadedLines, dao.anchors(songId)), lineIndex)
            .also { st -> savedProposal?.let(st::drag) }
    }
    // A pin can be removed, not only set: without this the only escape from a bad pin was
    // deleting the song. Live, so the button disappears the moment the pin is cleared.
    val anchors by dao.observeAnchors(songId).collectAsStateWithLifecycle(initialValue = emptyList())
    val isPinned = anchors.any { it.lineIndex == lineIndex && it.source == "user" }
    val s = state ?: return Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

    // Runs in this composition's coroutine (decodeEnvelope hops to Dispatchers.Default): never on the
    // main thread, and cancelled when the screen leaves.
    LaunchedEffect(s, audioUri) { s.load { decodeEnvelope(context, Uri.parse(audioUri)) } }

    val audio = remember(controller) {
        controller?.let { ScrubAudio(it.asPreviewPlayer(), Scrubber(it), HandlerTimer) }
    }
    DisposableEffect(audio) { onDispose { audio?.abandon() } }

    val scope = rememberCoroutineScope()
    val proposed by s.proposedFlow.collectAsStateWithLifecycle()
    val clamped by s.clampedFlow.collectAsStateWithLifecycle()
    LaunchedEffect(proposed) { savedProposal = proposed }
    val waveform by s.waveform.collectAsStateWithLifecycle()
    var window by remember(s) { mutableStateOf(NudgeWindow.around(s.initialCenterMs())) }
    // Leaving must not move the song: remember where the playhead was and put it back.
    val startPosition = remember(controller) { controller?.currentPosition }
    DisposableEffect(controller) {
        onDispose { startPosition?.let { controller?.seekTo(it) } }
    }
    var playing by remember { mutableStateOf(false) }
    LaunchedEffect(controller) {
        while (controller != null) { playing = controller.isPlaying; delay(200) }
    }
    // Derived from the collected state (not s.handleEnabled): reading the flow's value directly would
    // not trigger recomposition when the decode fails, leaving the handle looking alive.
    val enabled = waveform !is WaveformStatus.Failed && audio != null

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Nudge line ${lineIndex + 1}") },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Cancel") }
                },
            )
        },
    ) { pad ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(pad).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(loadedLines[lineIndex].text, style = MaterialTheme.typography.titleLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Text("Original ${fmt(s.original)}", color = Amber)
                Text("New ${fmt(proposed)}", color = Blue)
            }
            // Minimum-height status slot: a message appearing mid-drag must not shove the waveform
            // out from under the finger.
            Box(Modifier.fillMaxWidth().heightIn(min = 96.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                when (val w = waveform) {
                    WaveformStatus.Loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Text("Reading waveform… you can already drag to place the line by ear.")
                    }
                    is WaveformStatus.Failed -> Text(w.message, color = MaterialTheme.colorScheme.error)
                    is WaveformStatus.Ready -> Unit
                }
                if (clamped) Text("Stopped at the neighbouring line: a line cannot pass its neighbours.")
                }
            }

            val envelope = (waveform as? WaveformStatus.Ready)?.envelope
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .pointerInput(enabled, s, audio, window) {
                        if (!enabled) return@pointerInput
                        // Horizontal only, so a vertical swipe still scrolls the screen.
                        detectHorizontalDragGestures(
                            onDragStart = { o ->
                                audio!!.begin()
                                s.drag(window.msAt(o.x, size.width.toFloat()))
                                s.proposedMs?.let(audio::move)
                            },
                            onHorizontalDrag = { change, _ ->
                                change.consume()
                                s.drag(window.msAt(change.position.x, size.width.toFloat()))
                                s.proposedMs?.let(audio!!::move)
                            },
                            onDragEnd = { s.proposedMs?.let { audio!!.release(it) } ?: audio!!.abandon() },
                            onDragCancel = { audio!!.abandon() },
                        )
                    },
            ) {
                drawNudge(s, window, envelope, proposed, enabled)
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = controller != null, onClick = {
                    controller?.run { if (isPlaying) pause() else play() }
                }) { Text(if (playing) "Pause" else "Play") }
                OutlinedButton(enabled = controller != null, onClick = {
                    controller?.let { window = NudgeWindow.around(it.currentPosition) }
                }) { Text("Centre on playhead") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = enabled && proposed != null, onClick = {
                    s.fine(-NudgeState.FINE_STEP_MS); s.proposedMs?.let { audio?.preview(it) }
                }) { Text("−0.1 s") }
                OutlinedButton(enabled = enabled && proposed != null, onClick = {
                    s.fine(NudgeState.FINE_STEP_MS); s.proposedMs?.let { audio?.preview(it) }
                }) { Text("+0.1 s") }
            }
            Button(
                enabled = proposed != null && proposed != s.original && enabled,
                onClick = { scope.launch { s.save(dao, songId, lineIndex); onDone() } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save") }
            if (isPinned) {
                OutlinedButton(
                    onClick = { scope.launch { clearPin(dao, songId, lineIndex); onDone() } },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Clear pin (back to the computed time)") }
            }
        }
    }
}

private fun fmt(ms: Long?) = if (ms == null) "—" else "%.2f s".format(ms / 1000.0)

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawNudge(
    s: NudgeState,
    window: NudgeWindow,
    envelope: Envelope?,
    proposed: Long?,
    enabled: Boolean,
) {
    val w = size.width
    val h = size.height
    val mid = h / 2
    drawLine(Color.Gray, Offset(0f, mid), Offset(w, mid), strokeWidth = 1f)
    if (envelope != null) {
        val perMs = envelope.peaksPerSecond / 1000f
        for (x in 0 until w.toInt() step 2) {
            val a = ((window.msAt(x.toFloat(), w)) * perMs).toInt()
            val b = ((window.msAt(x + 2f, w)) * perMs).toInt().coerceAtLeast(a + 1)
            var peak = 0f
            for (i in a until minOf(b, envelope.peaks.size)) if (i >= 0 && envelope.peaks[i] > peak) peak = envelope.peaks[i]
            val half = peak * mid
            drawLine(Color.Gray, Offset(x.toFloat(), mid - half), Offset(x.toFloat(), mid + half), strokeWidth = 2f)
        }
    }
    // Everything is pinned to the view edge when it lies outside, so a clamp is never invisible.
    fun xOf(ms: Long) = window.xAt(ms, w).coerceIn(0f, w)
    for (n in listOfNotNull(s.neighbourBefore, s.neighbourAfter)) {
        val x = xOf(n)
        drawLine(Color.DarkGray, Offset(x, 0f), Offset(x, h), strokeWidth = 2f)
    }
    s.original?.let { drawLine(Amber, Offset(xOf(it), 0f), Offset(xOf(it), h), strokeWidth = 4f) }
    proposed?.let {
        val x = xOf(it)
        val c = if (enabled) Blue else Color.Gray
        drawLine(c, Offset(x, 0f), Offset(x, h), strokeWidth = 4f)
        drawCircle(c, radius = 28f, center = Offset(x, mid))
    }
}
