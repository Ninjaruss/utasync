package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.PrepareState

/**
 * The rules behind renaming a song, kept out of the composable so they can be read and tested.
 *
 * The app had no way to correct a name at all until now (first real-song run, 2026-11-28). That
 * matters more than it sounds: every audio file on the owner's device is downloader output with
 * no embedded tags, so the filename decides the name, `/api/get` cannot run without an artist,
 * and ledger L67 measured that no filename rule reaches those songs. Typing the name is the only
 * thing that does.
 */

/**
 * The title and artist to store, or null when there is nothing to write: a blank title, or a name
 * that is already what it would become. Both values are trimmed, so trimming alone is not a
 * change.
 *
 * A blank **artist** is allowed and meaningful — it is what the import stores for a tag the file
 * did not have, and `prepareSong` reads it as "absent", skipping the rung that needs both names
 * rather than sending an empty one. A blank **title** is refused: a song with no name can be
 * neither looked up nor told apart in the library.
 */
fun renamedTitleArtist(
    currentTitle: String,
    currentArtist: String,
    title: String,
    artist: String,
): Pair<String, String>? {
    val newTitle = title.trim()
    val newArtist = artist.trim()
    if (newTitle.isEmpty()) return null
    if (newTitle == currentTitle.trim() && newArtist == currentArtist.trim()) return null
    return newTitle to newArtist
}

/**
 * The prepare state to write after a rename, or null to leave the stored one alone.
 *
 * A stored lookup result is an answer about the name that was asked for. Once the name changes,
 * that answer is about a different question, and a song with no lines must not go on saying "No
 * lyrics found" — the user renamed it precisely because the old name was wrong. Such a song goes
 * back to [PrepareState.PENDING], which reads as "No lyrics yet" and offers to look again.
 *
 * Two things are deliberately left alone. A song that **has lines** keeps its state: lines outrank
 * the state everywhere ([net.ninjaruss.utasync.data.readinessOf]), and renaming is no reason to
 * forget that a song is singable. And a state that recorded nothing about the old name — nothing
 * tried yet, lookup switched off, or a lookup still running — is not a stale answer, so there is
 * nothing to clear. (A lookup in flight will write its own result for the old name when it
 * finishes; it is a lookup the user themselves started moments earlier, and the fix is to search
 * again, which the lyrics screen offers on the same screen as the rename.)
 *
 * The set below is the one to edit when a state is added to [PrepareState]; `RenameSongTest`
 * derives its domain from [PrepareState.ALL], so a forgotten state fails there rather than
 * silently keeping a stale miss.
 */
private val LEARNED_NOTHING = setOf(PrepareState.PENDING, PrepareState.OFF, PrepareState.FETCHING)

fun stateAfterRename(prepareState: String, hasLines: Boolean): String? = when {
    hasLines -> null
    prepareState in LEARNED_NOTHING -> null
    else -> PrepareState.PENDING
}
