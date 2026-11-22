package net.ninjaruss.utasync.japanese

/**
 * Analyse [text] into words with readings and meanings.
 *
 * Deliberately a stub: it returns nothing, so the accuracy audit's first run reports every
 * word as blank. That is the honest baseline every later task has to move. Do not make this
 * "do a little" before the real analyzer lands.
 */
@Suppress("UNUSED_PARAMETER")
suspend fun analyze(text: String, mode: ReadingMode): List<WordInfo> = emptyList()
