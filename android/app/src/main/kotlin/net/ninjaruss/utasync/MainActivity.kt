package net.ninjaruss.utasync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import net.ninjaruss.utasync.ui.LibraryScreen
import net.ninjaruss.utasync.ui.PlayerScreen
import net.ninjaruss.utasync.ui.UtasyncTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val dao = (application as UtasyncApplication).database.songDao()
        setContent {
            UtasyncTheme {
                // Two screens; a navigation library is not worth it yet.
                var openSongId by rememberSaveable { mutableStateOf<Long?>(null) }
                val songId = openSongId
                if (songId == null) {
                    LibraryScreen(dao = dao, onOpen = { openSongId = it })
                } else {
                    BackHandler { openSongId = null }
                    PlayerScreen(songId = songId, dao = dao, onBack = { openSongId = null })
                }
            }
        }
    }
}
