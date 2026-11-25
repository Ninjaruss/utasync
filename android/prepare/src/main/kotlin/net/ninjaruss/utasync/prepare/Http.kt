package net.ninjaruss.utasync.prepare

/** A response, reduced to what the retry policy and the parser need. */
data class HttpResponse(
    val code: Int,
    val contentType: String?,
    val body: String,
    val retryAfterSec: Int?,
)

/** One GET. Throws [java.io.IOException] when the request never reached the server. */
fun interface HttpGet {
    suspend fun get(url: String, userAgent: String): HttpResponse
}

/** What a lookup ended in. Carries no text: failures are an outcome and a status code. */
enum class LookupOutcome { FOUND, NO_ENTRY, OFFLINE, RATE_LIMITED, ERROR }
