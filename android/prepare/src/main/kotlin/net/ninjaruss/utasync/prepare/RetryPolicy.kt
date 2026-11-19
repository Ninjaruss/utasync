package net.ninjaruss.utasync.prepare

// Guesses and service guidance, not measurements: see ledger entry L51.
const val CONNECT_TIMEOUT_MS = 10_000
const val READ_TIMEOUT_MS = 20_000
const val MAX_ATTEMPTS = 3
const val BASE_BACKOFF_MS = 500L
const val MAX_BACKOFF_MS = 30_000L
const val PACING_DELAY_MS = 300L

/** How the server answered, as far as the retry policy cares. */
enum class Reply { JSON, NOT_FOUND, RATE_LIMITED, BUSY, CLIENT_ERROR, SERVER_ERROR }

fun classify(code: Int, contentType: String?): Reply = when {
    // LRCLIB answers a malformed query in plain text, sometimes with a 200.
    code in 200..299 ->
        if (contentType?.contains("json", ignoreCase = true) == true) Reply.JSON else Reply.CLIENT_ERROR
    code == 404 -> Reply.NOT_FOUND
    code == 429 -> Reply.RATE_LIMITED
    code == 503 -> Reply.BUSY
    code in 400..499 -> Reply.CLIENT_ERROR
    else -> Reply.SERVER_ERROR
}

/**
 * Milliseconds to wait before the next attempt, or null for "do not retry". [attempt] is the
 * one that just failed, counting from 1. The caller supplies [jitterMs] so this stays pure.
 */
fun retryDelayMs(reply: Reply, retryAfterSec: Int?, attempt: Int, jitterMs: Long): Long? {
    if (reply == Reply.JSON || reply == Reply.NOT_FOUND || reply == Reply.CLIENT_ERROR) return null
    if (attempt >= MAX_ATTEMPTS) return null
    val base = if (retryAfterSec != null) {
        retryAfterSec.coerceAtLeast(0) * 1000L
    } else {
        BASE_BACKOFF_MS shl (attempt - 1)
    }
    return base.coerceAtMost(MAX_BACKOFF_MS) + jitterMs
}

fun outcomeOf(reply: Reply): LookupOutcome = when (reply) {
    Reply.JSON -> LookupOutcome.FOUND
    Reply.NOT_FOUND -> LookupOutcome.NO_ENTRY
    Reply.RATE_LIMITED -> LookupOutcome.RATE_LIMITED
    Reply.BUSY, Reply.CLIENT_ERROR, Reply.SERVER_ERROR -> LookupOutcome.ERROR
}
