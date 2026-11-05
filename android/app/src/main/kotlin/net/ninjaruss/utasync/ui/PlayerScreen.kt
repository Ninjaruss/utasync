package net.ninjaruss.utasync.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.align.activeLineIndex
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.playback.PlayerConnection

@OptIn(ExperimentalMaterial3Api::class)
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
    LaunchedEffect(controller) {
        val c = controller ?: return@LaunchedEffect
        while (true) {
            withFrameNanos { }
            positionMs = c.currentPosition
            playing = c.isPlaying
        }
    }

    val starts = remember(lines) { lines.map { it.startMs } }
    val active = activeLineIndex(starts, positionMs)
    val listState = rememberLazyListState()
    LaunchedEffect(active) {
        if (active >= 0) listState.animateScrollToItem(maxOf(0, active - 2))
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
                actions = { TextButton(onClick = { pickLrc.launch(arrayOf("*/*")) }) { Text("Lyrics…") } },
            )
        },
        bottomBar = {
            BottomAppBar {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Button(onClick = { controller?.run { if (isPlaying) pause() else play() } }) {
                        Text(if (playing) "Pause" else "Play")
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
                            .clickable(enabled = line.startMs != null) { line.startMs?.let { controller?.seekTo(it) } }
                            .padding(horizontal = 24.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}
