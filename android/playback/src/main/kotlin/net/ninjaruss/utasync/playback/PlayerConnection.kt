package net.ninjaruss.utasync.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture

/** Connects the UI to [PlaybackService]. Call [release] when the screen goes away. */
class PlayerConnection(private val context: Context) {
    private var future: ListenableFuture<MediaController>? = null

    fun connect(onReady: (MediaController) -> Unit) {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val f = MediaController.Builder(context, token).buildAsync()
        future = f
        f.addListener({ if (!f.isCancelled) onReady(f.get()) }, ContextCompat.getMainExecutor(context))
    }

    fun release() {
        future?.let { MediaController.releaseFuture(it) }
        future = null
    }
}
