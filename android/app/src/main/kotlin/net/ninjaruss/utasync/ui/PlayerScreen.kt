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
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.ninjaruss.utasync.align.activeLineIndex
import net.ninjaruss.utasync.align.writeLrc
import net.ninjaruss.utasync.UtasyncApplication
import net.ninjaruss.utasync.data.LineEntity
import net.ninjaruss.utasync.data.PrepareState
import net.ninjaruss.utasync.data.Readiness
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.readinessOf
import net.ninjaruss.utasync.data.resolveStarts
import net.ninjaruss.utasync.japanese.WordInfo
import net.ninjaruss.utasync.playback.PlayerConnection

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun PlayerScreen(songId: Long, dao: SongDao, onBack: () -> Unit) {
    val context = LocalContext.current
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
    // Lines the user has pinned by hand, so a pin is visible and can be found again to clear.
    val pinned = remember(anchors) { anchors.filter { it.source == "user" }.map { it.lineIndex }.toSet() }

    // Export: the resolved times (pins folded in) leave as a plain .lrc, never the raw computed ones.
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }
    val exportLrc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri != null) {
            val export = writeLrc(starts.zip(lines.map { it.text }))
            scope.launch {
                // Nothing to write is not an export: a song with no timed line would otherwise
                // leave a zero-byte file behind and be told "Exported".
                val writeFailed = export.text.isNotEmpty() && runCatching {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(export.text.toByteArray()) }
                    }
                }.isFailure
                snackbar.showSnackbar(exportMessage(export, writeFailed))
            }
        }
    }

    // Long-press a line to nudge its start by ear; "Tap along" times the whole song. Hoisted
    // ABOVE the repeat loop on purpose: Compose keeps every effect of this composable alive while
    // a correction screen is up, so a loop declared below would still be seeking the player while
    // the user drags the nudge handle or taps along (it yanked the playhead out from under both).
    var nudging by rememberSaveable { mutableStateOf<Int?>(null) }
    var tapping by rememberSaveable { mutableStateOf(false) }
    var sourcing by rememberSaveable { mutableStateOf(false) }
    val correcting = nudging != null || tapping || sourcing

    // Practice: the line being looped (null = off) and the playback speed.
    var repeatLine by rememberSaveable { mutableStateOf<Int?>(null) }
    var speed by rememberSaveable { mutableStateOf(1f) }
    LaunchedEffect(controller) { controller?.let { speed = it.playbackParameters.speed } }
    LaunchedEffect(controller, speed) { controller?.setPlaybackSpeed(speed) }
    val loopRange = repeatLine?.let { repeatRange(starts, it, song?.durationMs ?: durationMs) }
    // Loop on the same per-frame clock that drives the highlight. When the clock reaches the
    // line's end, seek back to its start (also when the last line hits the end of the audio).
    LaunchedEffect(controller, loopRange, correcting) {
        val c = controller ?: return@LaunchedEffect
        val r = loopRange ?: return@LaunchedEffect
        if (r.isEmpty()) return@LaunchedEffect
        // Suspended while a correction screen owns the player. Repeat stays ON and resumes on return.
        if (correcting) return@LaunchedEffect
        while (true) {
            withFrameNanos { }
            if (c.playbackState == Player.STATE_ENDED || (c.isPlaying && c.currentPosition >= r.last)) {
                c.seekTo(r.first)
                if (c.playbackState == Player.STATE_ENDED) c.play()
            }
        }
    }
    // Furigana and word meanings. One cache for the screen, analysed a line at a time off the
    // main thread; a line that has not come back yet draws as plain text (see LineWordsCache).
    val app = context.applicationContext as UtasyncApplication
    val readingSetting = remember(app) { ReadingSetting(app) }
    // Re-read when the lyrics screen closes, because the control lives there: a mode chosen there
    // must be in force when the player comes back, without restarting the app.
    var readingMode by remember { mutableStateOf(readingSetting.mode) }
    LaunchedEffect(sourcing) { if (!sourcing) readingMode = readingSetting.mode }
    // A new cache per mode: the analysed lines hold the ruby the old mode produced, and OFF
    // produces none at all, so keeping them would leave furigana on screen after switching off.
    val wordsCache = remember(app, readingMode) { LineWordsCache({ app.analyzer() }, readingMode) }
    var lookingUp by remember { mutableStateOf<WordInfo?>(null) }
    // The line the sheet is showing, captured when it opens -- NOT the active line. The sheet is
    // read while the song keeps playing, so following the playhead would swap its contents, and
    // close it outright at an instrumental break, under someone mid-read.
    var sheetLineIndex by rememberSaveable { mutableStateOf<Int?>(null) }

    val readiness = readinessOf(song?.prepareState ?: PrepareState.PENDING, lines.size, starts.count { it != null })
    // Not singable means no highlight at all: half-timed lines must not pretend to follow along.
    // Stated as "only SINGABLE highlights" rather than "WORDS_ONLY does not", so a readiness that
    // is not about the lines (a lookup in flight, say) can never let a half-timed song follow along.
    val active = if (readiness != Readiness.SINGABLE) -1 else activeLineIndex(starts, positionMs)
    // The active line's words, for the sheet. Unconditional, so the effect behind it keeps its
    // place in composition: with no active line it analyses the empty string, which is no words.
    val activeLine = lines.getOrNull(active)
    val activeWords = rememberLineWords(wordsCache, activeLine?.lineIndex ?: -1, activeLine?.text ?: "")
    // The sheet's own line, held still while the playhead moves on. Unconditional for the same
    // reason as above; it is already analysed, since the menu item that opens the sheet is
    // disabled until the words are in hand.
    val sheetLine = sheetLineFor(sheetLineIndex, lines)
    val sheetWords = rememberLineWords(wordsCache, sheetLine?.lineIndex ?: -1, sheetLine?.text ?: "")
    val listState = rememberLazyListState()
    LaunchedEffect(active) {
        if (active >= 0) listState.animateScrollToItem(maxOf(0, active - 2))
    }

    // Hosted here so the player connection is shared; the state itself is declared above.
    nudging?.let { index ->
        BackHandler { nudging = null }
        NudgeScreen(songId, index, dao, controller, onDone = { nudging = null })
        return
    }

    if (tapping) {
        BackHandler { tapping = false }
        TapAlongScreen(songId, dao, controller, onDone = { tapping = false })
        return
    }

    if (sourcing) {
        BackHandler { sourcing = false }
        LyricsSourceScreen(
            songId, dao, (context.applicationContext as UtasyncApplication).lrclib,
            onDone = { sourcing = false },
        )
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
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
                    TextButton(onClick = { sourcing = true }) { Text("Lyrics…") }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text(LINE_WORDS_HEADING) },
                                enabled = activeWords != null && activeWords.isNotEmpty(),
                                onClick = {
                                    menuOpen = false
                                    sheetLineIndex = activeLine?.lineIndex
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Export .lrc") },
                                enabled = lines.isNotEmpty(),
                                onClick = {
                                    menuOpen = false
                                    exportLrc.launch("${song?.title ?: "lyrics"}.lrc")
                                },
                            )
                        }
                    }
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
                            // Name the line actually latched: the latch is at toggle time (L47).
                            label = { Text(repeatLine?.let { "Repeat line ${it + 1}" } ?: "Repeat line") },
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
        lookingUp?.let { word -> WordPopover(word, onClose = { lookingUp = null }) }
        // Only ever opened from the menu item, which is disabled until that line's words are in
        // hand. It closes when its own line is gone from the song (a replaced lyric sheet), never
        // because the playhead moved: see sheetLineFor.
        if (!sheetWords.isNullOrEmpty()) {
            LineWordsSheet(sheetWords) { sheetLineIndex = null }
        }
        if (lines.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(emptyPlayerMessage(readiness), Modifier.padding(24.dp))
                    // One button at most, and it always opens the lyrics screen, which searches on
                    // request whatever the automatic setting says. Which states get one, and why
                    // a rate-limited song gets none, is decided in emptyPlayerAction.
                    emptyPlayerAction(readiness)?.let { label ->
                        Button(onClick = { sourcing = true }) { Text(label) }
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (readiness == Readiness.WORDS_ONLY) {
                    Text(
                        WORDS_ONLY_NOTICE,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                    )
                }
                LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth()) {
                    itemsIndexed(lines, key = { _, line -> line.lineIndex }) { i, line ->
                        val isActive = i == active
                        val isPinned = line.lineIndex in pinned
                        val words = rememberLineWords(wordsCache, line.lineIndex, line.text)
                        val style = (if (isActive) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium)
                            .copy(
                                fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                                color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .semantics {
                                    if (isPinned) contentDescription = "Pinned: ${line.text}"
                                }
                                // The row is the control, except on the active line, where its own
                                // words are: nesting a second control inside one takes the tap away
                                // from it, and there is nothing to seek to on the line you are
                                // already on (the PWA's LyricDisplay.tsx:440). Long-press is
                                // unchanged on every row, which is why the row stays clickable.
                                .combinedClickable(
                                    onLongClickLabel = "Nudge this line's start",
                                    onLongClick = { nudging = i },
                                    onClickLabel = if (isActive) null else "Seek to this line",
                                    onClick = {
                                        if (!isActive) {
                                            starts.getOrNull(i)?.let { controller?.seekTo(it) }
                                            if (repeatLine != null && starts.getOrNull(i) != null) repeatLine = i
                                        }
                                    },
                                )
                                .padding(horizontal = 24.dp, vertical = 10.dp),
                        ) {
                            if (isPinned) Text("\uD83D\uDCCC ", style = style)
                            // Plain text until this line has been analysed: the lyric is on screen
                            // before the furigana is, with no spinner and no blank row.
                            if (words == null) {
                                Text(line.text, style = style)
                            } else {
                                RubyText(
                                    words = words,
                                    onWordTap = { index -> lookingUp = words[index] },
                                    tappable = isActive,
                                    // A word's own gesture handler swallows the long press, so
                                    // the row's is handed down to it: long-press is unchanged on
                                    // every row, the active one included.
                                    onWordLongPress = { nudging = i },
                                    onLongPressLabel = "Nudge this line's start",
                                    baseStyle = style,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The line the words sheet is showing: the one captured when it opened, looked up by **line
 * index** rather than by position in [lines].
 *
 * Two things fall out of that, and both are the point:
 * - The playhead is not an input. The sheet is read while the song plays on, so a sheet that
 *   tracked the active line would re-fill itself under the reader and empty on an instrumental
 *   break. It holds its line until it is closed.
 * - A line that is no longer in the song returns null, which closes the sheet. That is the
 *   replaced-lyric-sheet case (spec 7 item 7): the captured index may now name different text, or
 *   nothing at all, and showing the old words against the new line would be worse than closing.
 */
internal fun sheetLineFor(captured: Int?, lines: List<LineEntity>): LineEntity? =
    captured?.let { index -> lines.firstOrNull { it.lineIndex == index } }

/** Speed choices. A judgement, not a measurement: see ledger L47. */
private val SPEEDS = listOf(0.5f, 0.75f, 1f)
