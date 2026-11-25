package net.ninjaruss.utasync.prepare

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The only part that touches the network, and it decides nothing: request, body, headers.
 * It never logs a body (ADR-0004).
 */
class UrlConnectionHttp : HttpGet {
    override suspend fun get(url: String, userAgent: String): HttpResponse =
        withContext(Dispatchers.IO) {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = READ_TIMEOUT_MS
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("User-Agent", userAgent)
                conn.setRequestProperty("Accept", "application/json")
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                HttpResponse(
                    code = code,
                    contentType = conn.contentType,
                    body = body,
                    retryAfterSec = conn.getHeaderFieldInt("Retry-After", -1).takeIf { it >= 0 },
                )
            } finally {
                conn.disconnect()
            }
        }
}
