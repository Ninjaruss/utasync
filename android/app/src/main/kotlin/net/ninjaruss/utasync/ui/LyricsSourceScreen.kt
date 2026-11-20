package net.ninjaruss.utasync.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.ninjaruss.utasync.align.Sheet
import net.ninjaruss.utasync.align.sheetFrom
import net.ninjaruss.utasync.align.splitPastedLyrics
import net.ninjaruss.utasync.data.PrepareState
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.prepare.FetchSetting
import net.ninjaruss.utasync.prepare.LookupOutcome
import net.ninjaruss.utasync.prepare.Lrclib
import net.ninjaruss.utasync.prepare.LrclibTrack
import net.ninjaruss.utasync.prepare.PrepareOutcome
import net.ninjaruss.utasync.prepare.adoptPastedLyrics
import net.ninjaruss.utasync.prepare.adoptTrack
import net.ninjaruss.utasync.prepare.prepareSong

/** What the user asked for that replaces the song's lyric sheet, held while pins are confirmed. */
internal sealed interface SheetChange {
    data object Search : SheetChange
    data class Adopt(val track: LrclibTrack) : SheetChange
    data class Paste(val text: String) : SheetChange
    data class Lrc(val uri: Uri) : SheetChange
}

/**
 * The prepare state an interrupted [change] must leave behind, or null to leave the stored state
 * alone. Only [SheetChange.Search] ever sets a state (`"fetching"`, inside `prepareSong`), so only
 * a search may write one here: resetting a cancelled paste or import to `"pending"` would downgrade
 * what a finished lookup had already learned, turning a "no lyrics found" song into "no lyrics yet".
 */
internal fun stateAfterInterruption(change: SheetChange, cancelled: Boolean): String? = when {
    change != SheetChange.Search -> null
    // Cancelled: nothing was learned, so neither a failure nor a miss may be shown.
    cancelled -> PrepareState.PENDING
    // An unexpected error: the lookup did not complete, which is what "failed" means.
    else -> PrepareState.FAILED
}

/**
 * Every way to give a song lyrics, none of which depends on automatic lookup being on: search
 * LRCLIB, choose one of its results, paste the words, or import an .lrc. **Nothing here chooses
 * among results for the user** (rule 2); a result is adopted only when tapped.
 *
 * Every path that replaces the sheet goes through one confirmation when the song has hand-placed
 * pins (ADR-0002): anchors are keyed by line index, so a re-split sheet silently re-points them.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LyricsSourceScreen(songId: Long, dao: SongDao, lrclib: Lrclib, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val fetchSetting = remember { FetchSetting(context) }
    var autoLookup by remember { mutableStateOf(fetchSetting.enabled) }

    var candidates by remember { mutableStateOf<List<LrclibTrack>>(emptyList()) }
    // The last thing a search came back with, which decides whether another may be offered.
    var lastOutcome by remember { mutableStateOf<LookupOutcome?>(null) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var pasted by rememberSaveable { mutableStateOf("") }
    // Held while the pin warning is on screen: the change itself waits for the user's answer.
    var pendingChange by remember { mutableStateOf<SheetChange?>(null) }
    var pendingPins by remember { mutableStateOf(0) }

    suspend fun perform(change: SheetChange, allowReplaceSheet: Boolean) {
        busy = true
        try {
            when (change) {
                SheetChange.Search -> {
                    val song = dao.song(songId) ?: return
                    lastOutcome = null
                    // The user asked, so the automatic setting does not apply: fetchEnabled = true.
                    when (val outcome = prepareSong(dao, lrclib, song, allowReplaceSheet, fetchEnabled = true)) {
                        is PrepareOutcome.Synced, is PrepareOutcome.WordsOnly -> onDone()
                        is PrepareOutcome.NeedsChoice -> {
                            candidates = outcome.candidates
                            message = "Several records could be this song. Choose the one that matches."
                        }
                        is PrepareOutcome.NotFound -> {
                            candidates = emptyList()
                            lastOutcome = outcome.outcome
                            // Per outcome: only OFFLINE may say LRCLIB was not reached, and a rate
                            // limit asks for a minute (see lookupFailureMessage). The fallback is
                            // never expected — NotFound is never built with FOUND — but this file
                            // promises never to be silent, so it says something rather than
                            // nothing if a later outcome arrives undecided.
                            message = lookupFailureMessage(outcome.outcome)
                                ?: "The lookup ended with nothing to show. Paste the words or import an .lrc."
                        }
                        // Unreachable with allowReplaceSheet checked by the caller; never silent.
                        PrepareOutcome.RefusedHasPins -> message = "This song has lines you timed by hand."
                        // Unreachable too: this call always passes fetchEnabled = true, because
                        // the user asked. Kept so the `when` stays exhaustive, and never silent.
                        PrepareOutcome.Disabled -> message = "Lookup is switched off."
                    }
                }
                is SheetChange.Adopt -> when (adoptTrack(dao, songId, change.track, consented = allowReplaceSheet)) {
                    is PrepareOutcome.Synced, is PrepareOutcome.WordsOnly -> onDone()
                    PrepareOutcome.RefusedHasPins -> message = "This song has lines you timed by hand."
                    else -> message = "That record has no lyrics to use."
                }
                is SheetChange.Paste -> {
                    when (adoptPastedLyrics(dao, songId, change.text, consented = allowReplaceSheet)) {
                        is PrepareOutcome.WordsOnly -> onDone()
                        PrepareOutcome.RefusedHasPins -> message = "This song has lines you timed by hand."
                        else -> message = "There were no words to use."
                    }
                }
                is SheetChange.Lrc -> {
                    when (importLrc(context, dao, songId, change.uri, consented = allowReplaceSheet)) {
                        is LrcImport.Imported -> onDone()
                        LrcImport.RefusedHasPins -> message = "This song has lines you timed by hand."
                        LrcImport.NoLines -> message = "That file has no timed lines. Nothing was changed."
                    }
                }
            }
        } catch (e: CancellationException) {
            // Leaving mid-search must not strand the song at "fetching"; see stateAfterInterruption
            // for why a cancelled paste or import must leave the state exactly as it is.
            stateAfterInterruption(change, cancelled = true)?.let {
                withContext(NonCancellable) { dao.setPrepareState(songId, it) }
            }
            throw e
        } catch (e: Exception) {
            stateAfterInterruption(change, cancelled = false)?.let { dao.setPrepareState(songId, it) }
            message = "Something went wrong. Nothing was changed."
        } finally {
            busy = false
        }
    }

    // The single door for a sheet replacement: ask first when pins would be re-pointed.
    fun request(change: SheetChange) {
        scope.launch {
            val pins = dao.anchors(songId).count { it.source == "user" }
            if (pins > 0) {
                pendingPins = pins
                pendingChange = change
            } else {
                perform(change, allowReplaceSheet = false)
            }
        }
    }

    val pickLrc = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) request(SheetChange.Lrc(uri))
    }

    pendingChange?.let { change ->
        AlertDialog(
            onDismissRequest = { pendingChange = null },
            title = { Text(replaceHandTimedTitle(pendingPins)) },
            text = {
                Text("New lyrics replace ${handPlacedLines(pendingPins)}. ${handTimedLossNote(pendingPins)}")
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingChange = null
                    scope.launch { perform(change, allowReplaceSheet = true) }
                }) { Text("Replace") }
            },
            dismissButton = { TextButton(onClick = { pendingChange = null }) { Text("Keep my timings") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Lyrics") },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Look up lyrics automatically", Modifier.weight(1f))
                Switch(
                    checked = autoLookup,
                    onCheckedChange = { autoLookup = it; fetchSetting.enabled = it },
                )
            }
            Text(
                "Searching below and pasting work whether this is on or off.",
                style = MaterialTheme.typography.bodySmall,
            )
            HorizontalDivider()

            Button(
                onClick = { request(SheetChange.Search) },
                // Disabled after a rate limit: see searchAllowed. The message beside it says why.
                enabled = !busy && searchAllowed(lastOutcome),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Searching…" else "Find lyrics")
            }
            if (message.isNotEmpty()) Text(message)
            candidates.forEach { track ->
                val usable = sheetFrom(track.syncedLyrics, track.plainLyrics, track.instrumental) != Sheet.None
                Text(
                    candidateLabel(track),
                    color = if (usable) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = usable && !busy) { request(SheetChange.Adopt(track)) }
                        .padding(vertical = 12.dp),
                )
            }
            HorizontalDivider()

            OutlinedTextField(
                value = pasted,
                onValueChange = { pasted = it },
                label = { Text("Paste the words") },
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { request(SheetChange.Paste(pasted)) },
                enabled = !busy && splitPastedLyrics(pasted).isNotEmpty(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Use these words") }
            OutlinedButton(
                onClick = { pickLrc.launch(arrayOf("*/*")) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Import an .lrc file") }
        }
    }
}
