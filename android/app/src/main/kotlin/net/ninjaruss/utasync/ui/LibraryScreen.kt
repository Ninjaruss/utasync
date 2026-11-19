package net.ninjaruss.utasync.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import net.ninjaruss.utasync.UtasyncApplication
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.readinessOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(dao: SongDao, onOpen: (Long) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val songs by dao.observeSongs().collectAsStateWithLifecycle(initialValue = emptyList())
    val counts by dao.observeLineCounts().collectAsStateWithLifecycle(initialValue = emptyList())
    val countsBySong = remember(counts) { counts.associateBy { it.songId } }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val id = importAudio(context, dao, uri)
            // Not awaited: the song is in the library now and its row follows the lookup via the
            // Flow. The outcome is discarded on purpose; prepareState and the lines say it all.
            (context.applicationContext as UtasyncApplication).lookUpLyrics(id)
            onOpen(id)
        }
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text("Utasync") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { pickAudio.launch(arrayOf("audio/*")) }) {
                Icon(Icons.Default.Add, contentDescription = "Add a song")
            }
        },
    ) { padding ->
        if (songs.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Add a song from your device to get started.", Modifier.padding(24.dp))
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(padding)) {
                items(songs, key = { it.id }) { song ->
                    val c = countsBySong[song.id]
                    val status = libraryStatus(readinessOf(song.prepareState, c?.total ?: 0, c?.timed ?: 0))
                    ListItem(
                        headlineContent = { Text(song.title) },
                        supportingContent = {
                            val text = status ?: song.artist.takeIf { it.isNotBlank() }
                            if (text != null) Text(text)
                        },
                        modifier = Modifier.clickable { onOpen(song.id) },
                    )
                }
            }
        }
    }
}
