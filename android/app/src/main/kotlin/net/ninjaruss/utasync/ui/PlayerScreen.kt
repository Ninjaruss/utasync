package net.ninjaruss.utasync.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.align.activeLineIndex
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.resolveStarts
import net.ninjaruss.utasync.playback.PlayerConnection

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun PlayerScreen(songId: Long, dao: SongDao, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val song by dao.observeSong(songId).collectAsStateWithLifecycle(initialValue = null)
    val lines by dao.observeLines(songId).collectAsStateWithLifecycle(initialValue = emptyList())

    var controller by remember { mutableStateOf<MediaController?>(null) }
    DisposableEffect(Unit) {
        val connection = PlayerConnection(context)
        connection.connect { controller = it }
        onDispose { connection.release() }
    }

    // Load this song into the shared player unless it is already the current item.
    LaunchedEffect(controller, song?.audioUri) {
        val c = controller ?: return@LaunchedEffect
        val s = song ?: return@LaunchedEffect
        if (c.currentMediaItem?.mediaId != s.id.toString()) {
            c.setMediaItem(
                MediaItem.Builder()
                    .setMediaId(s.id.toString())
                    .setUri(s.audioUri)
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(s.title).setArtist(s.artist).build())
                    .build(),
            )
            c.prepare()
        }
    }

    // Read the player clock once per frame: no timers, no drift between audio and highlight.
    var positionMs by remember { mutableLongStateOf(0L) }
    var playing by remember { mutableStateOf(false) }
    var durationMs by remember { mutableLongStateOf(0L) }
    LaunchedEffect(controller) {
        val c = controller ?: return@LaunchedEffect
        while (true) {
            withFrameNanos { }
            positionMs = c.currentPosition
            playing = c.isPlaying
            durationMs = c.duration.coerceAtLeast(0L)  // TIME_UNSET (negative) until prepared
        }
    }

    // The only way to read timings: pins win over computed times (see resolveStarts).
    val anchors by dao.observeAnchors(songId).collectAsStateWithLifecycle(initialValue = emptyList())
    val starts = remember(lines, anchors) { resolveStarts(lines, anchors) }

    // Practice: the line being looped (null = off) and the playback speed.
    var repeatLine by rememberSaveable { mutableStateOf<Int?>(null) }
    var speed by rememberSaveable { mutableStateOf(1f) }
    LaunchedEffect(controller) { controller?.let { speed = it.playbackParameters.speed } }
    LaunchedEffect(controller, speed) { controller?.setPlaybackSpeed(speed) }
    val loopRange = repeatLine?.let { repeatRange(starts, it, song?.durationMs ?: durationMs) }
    // Loop on the same per-frame clock that drives the highlight. When the clock reaches the
    // line's end, seek back to its start (also when the last line hits the end of the audio).
    LaunchedEffect(controller, loopRange) {
        val c = controller ?: return@LaunchedEffect
        val r = loopRange ?: return@LaunchedEffect
        if (r.isEmpty()) return@LaunchedEffect
        while (true) {
            withFrameNanos { }
            if (c.playbackState == Player.STATE_ENDED || (c.isPlaying && c.currentPosition >= r.last)) {
                c.seekTo(r.first)
                if (c.playbackState == Player.STATE_ENDED) c.play()
            }
        }
    }
    val active = activeLineIndex(starts, positionMs)
    val listState = rememberLazyListState()
    LaunchedEffect(active) {
        if (active >= 0) listState.animateScrollToItem(maxOf(0, active - 2))
    }

    // Long-press a line to nudge its start by ear. Hosted here so the player connection is shared.
    var nudging by rememberSaveable { mutableStateOf<Int?>(null) }
    nudging?.let { index ->
        BackHandler { nudging = null }
        NudgeScreen(songId, index, dao, controller, onDone = { nudging = null })
        return
    }

    var tapping by rememberSaveable { mutableStateOf(false) }
    if (tapping) {
        BackHandler { tapping = false }
        TapAlongScreen(songId, dao, controller, onDone = { tapping = false })
        return
    }

    val pickLrc = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { importLrc(context, dao, songId, uri) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(song?.title ?: "") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(onClick = { tapping = true }, enabled = lines.isNotEmpty()) { Text("Tap along") }
                    TextButton(onClick = { pickLrc.launch(arrayOf("*/*")) }) { Text("Lyrics…") }
                },
            )
        },
        bottomBar = {
            BottomAppBar {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Button(onClick = { controller?.run { if (isPlaying) pause() else play() } }) {
                            Text(if (playing) "Pause" else "Play")
                        }
                        val canRepeat = repeatLine != null || starts.getOrNull(active) != null
                        FilterChip(
                            selected = repeatLine != null,
                            enabled = canRepeat,
                            onClick = { repeatLine = if (repeatLine != null) null else active },
                            label = { Text("Repeat line") },
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        SPEEDS.forEach { s ->
                            FilterChip(selected = speed == s, onClick = { speed = s }, label = { Text("${s}x") })
                        }
                    }
                }
            }
        },
    ) { padding ->
        if (lines.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No lyrics yet. Tap Lyrics… to load a synced .lrc file.", Modifier.padding(24.dp))
            }
        } else {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(padding)) {
                itemsIndexed(lines, key = { _, line -> line.lineIndex }) { i, line ->
                    val isActive = i == active
                    Text(
                        text = line.text,
                        style = if (isActive) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium,
                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                        color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .combinedClickable(
                                onLongClickLabel = "Nudge this line's start",
                                onLongClick = { nudging = i },
                                onClick = {
                                    starts.getOrNull(i)?.let { controller?.seekTo(it) }
                                    if (repeatLine != null && starts.getOrNull(i) != null) repeatLine = i
                                },
                            )
                            .padding(horizontal = 24.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}

/** Speed choices. A judgement, not a measurement: see ledger L47. */
private val SPEEDS = listOf(0.5f, 0.75f, 1f)
