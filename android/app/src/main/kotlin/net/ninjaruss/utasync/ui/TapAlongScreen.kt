package net.ninjaruss.utasync.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.produceState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.align.AnchorSource
import net.ninjaruss.utasync.align.TapSession
import net.ninjaruss.utasync.align.TimingAnchor
import net.ninjaruss.utasync.align.countReplaced
import net.ninjaruss.utasync.data.AnchorEntity
import net.ninjaruss.utasync.data.SongDao
import kotlin.math.roundToLong

/** Unit boundary: `:align` speaks seconds, storage speaks milliseconds. Converted here, once. */
fun TimingAnchor.toEntity(songId: Long) = AnchorEntity(
    songId = songId,
    lineIndex = lineIndex,
    timeMs = (timeSec * 1000).roundToLong(),
    source = if (source == AnchorSource.USER) "user" else "auto",
)

/**
 * Time a song by ear: play it and tap once as each line begins. The tap reads the player clock, so
 * the time is whatever the audio is doing at that instant. A rejected tap (double-tap, past the
 * last line) changes nothing and says so. Save writes every tap as a "user" anchor; computed line
 * times are left alone, exactly as for a nudge. A partial session saves only the tapped lines (see
 * [TapSession]); the screen warns when a save would replace lines already timed by hand.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TapAlongScreen(songId: Long, dao: SongDao, controller: MediaController?, onDone: () -> Unit) {
    val lines by dao.observeLines(songId).collectAsStateWithLifecycle(initialValue = emptyList())
    // Tap times survive rotation (a LongArray is Bundle-safe). The session is rebuilt from them by
    // replay, and again once the lines load (lines.size is 0 until the flow emits).
    var savedTimes by rememberSaveable { mutableStateOf(longArrayOf()) }
    val session = remember(lines.size) { TapSession.fromTimes(lines.size, savedTimes.toList()) }
    var tapCount by remember(session) { mutableIntStateOf(session.taps.size) }
    val userAnchored by produceState(emptySet<Int>(), songId) {
        value = dao.anchors(songId).filter { it.source == "user" }.map { it.lineIndex }.toSet()
    }
    val replaced = countReplaced(session.taps, userAnchored).takeIf { tapCount > 0 } ?: 0
    var notice by remember { mutableStateOf("") }
    // Save is irreversible for the lines it replaces, and the caption above the button is not read
    // mid-flow; when it would overwrite hand-placed pins, ask. No threshold, no tolerance.
    var confirmReplace by remember { mutableStateOf(false) }
    var playing by remember(controller) { mutableStateOf(controller?.isPlaying == true) }
    DisposableEffect(controller) {
        val c = controller
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
        }
        c?.addListener(l)
        onDispose { c?.removeListener(l) }
    }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val next = session.nextLine

    LaunchedEffect(tapCount) {
        next?.let { listState.animateScrollToItem(maxOf(0, it - 1)) }
    }

    suspend fun saveTaps() {
        session.taps.forEach { dao.upsertUser(it.toEntity(songId)) }
        onDone()
    }

    if (confirmReplace) {
        AlertDialog(
            onDismissRequest = { confirmReplace = false },
            title = { Text(replaceHandTimedTitle(replaced)) },
            text = {
                Text(
                    "Saving your $tapCount tap${if (tapCount == 1) "" else "s"} replaces " +
                        "${handPlacedLines(replaced)}. ${handTimedLossNote(replaced)}",
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmReplace = false; scope.launch { saveTaps() } }) { Text("Replace") }
            },
            dismissButton = { TextButton(onClick = { confirmReplace = false }) { Text("Keep my timings") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tap along") },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Cancel") }
                },
            )
        },
        bottomBar = {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    notice.ifEmpty { if (next == null) "All ${lines.size} lines timed." else "Tap as line ${next + 1} begins." },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    if (replaced > 0) "Save replaces $replaced line${if (replaced == 1) "" else "s"} you already timed by hand. Taps are a first pass; fine-tune with nudge."
                    else "Taps are a first pass; fine-tune any line afterwards with nudge (long-press it).",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(
                    onClick = {
                        val at = controller?.currentPosition ?: return@Button
                        val line = session.tap(at)
                        notice = if (line == null) {
                            if (next == null) "Every line is already timed." else "Ignored: too soon after the last tap."
                        } else ""
                        tapCount = session.taps.size
                        savedTimes = session.tapTimesMs.toLongArray()
                    },
                    enabled = controller != null && next != null,
                    modifier = Modifier.fillMaxWidth().height(96.dp),
                ) { Text("TAP", style = MaterialTheme.typography.headlineMedium) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        controller?.run { if (isPlaying) pause() else play() }
                    }) { Text(if (playing) "Pause" else "Play") }
                    OutlinedButton(onClick = {
                        session.undoLast(); tapCount = session.taps.size
                        savedTimes = session.tapTimesMs.toLongArray(); notice = ""
                    }, enabled = tapCount > 0) {
                        Text("Undo")
                    }
                    Button(
                        onClick = { if (replaced > 0) confirmReplace = true else scope.launch { saveTaps() } },
                        enabled = tapCount > 0,
                    ) { Text("Save ($tapCount)") }
                }
            }
        },
    ) { padding ->
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(padding)) {
            itemsIndexed(lines, key = { _, l -> l.lineIndex }) { i, line ->
                val done = i < tapCount
                val isNext = i == next
                Text(
                    text = line.text,
                    style = if (isNext) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium,
                    fontWeight = if (isNext) FontWeight.Bold else FontWeight.Normal,
                    color = when {
                        isNext -> MaterialTheme.colorScheme.primary
                        done -> MaterialTheme.colorScheme.onSurfaceVariant
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 10.dp),
                )
            }
        }
    }
}
