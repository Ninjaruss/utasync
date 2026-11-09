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
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.align.AnchorSource
import net.ninjaruss.utasync.align.TapSession
import net.ninjaruss.utasync.align.TimingAnchor
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
 * times are left alone, exactly as for a nudge.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TapAlongScreen(songId: Long, dao: SongDao, controller: MediaController?, onDone: () -> Unit) {
    val lines by dao.observeLines(songId).collectAsStateWithLifecycle(initialValue = emptyList())
    val session = remember(lines.size) { TapSession(lines.size) }
    var tapCount by remember(session) { mutableIntStateOf(0) }
    var notice by remember { mutableStateOf("") }
    var playing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val next = session.nextLine

    LaunchedEffect(tapCount) {
        next?.let { listState.animateScrollToItem(maxOf(0, it - 1)) }
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
                Button(
                    onClick = {
                        val at = controller?.currentPosition ?: return@Button
                        val line = session.tap(at)
                        notice = if (line == null) {
                            if (next == null) "Every line is already timed." else "Ignored: too soon after the last tap."
                        } else ""
                        tapCount = session.taps.size
                    },
                    enabled = controller != null && next != null,
                    modifier = Modifier.fillMaxWidth().height(96.dp),
                ) { Text("TAP", style = MaterialTheme.typography.headlineMedium) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        controller?.run { if (isPlaying) pause() else play(); playing = isPlaying }
                    }) { Text(if (playing) "Pause" else "Play") }
                    OutlinedButton(onClick = { session.undoLast(); tapCount = session.taps.size; notice = "" }, enabled = tapCount > 0) {
                        Text("Undo")
                    }
                    Button(
                        onClick = { scope.launch { session.taps.forEach { dao.upsertAnchor(it.toEntity(songId)) }; onDone() } },
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
