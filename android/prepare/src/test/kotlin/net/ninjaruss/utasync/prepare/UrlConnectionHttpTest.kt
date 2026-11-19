package net.ninjaruss.utasync.prepare

import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Stands up a loopback server so the headers and bodies are asserted where they are received.
 * It is a bare ServerSocket: the unit-test classpath is android.jar, which has no
 * com.sun.net.httpserver, and this adds no dependency.
 */
class UrlConnectionHttpTest {
    private class Seen {
        @Volatile var userAgent: String? = null
        @Volatile var accept: String? = null
    }

    private fun <T> withServer(
        status: Int,
        contentType: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
        block: (url: String, seen: Seen) -> T,
    ): T {
        val seen = Seen()
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val worker = thread(isDaemon = true) {
            try {
                server.accept().use { sock ->
                    val input = sock.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                    input.readLine() // request line
                    while (true) {
                        val line = input.readLine() ?: break
                        if (line.isEmpty()) break
                        val i = line.indexOf(':')
                        val name = line.substring(0, i).trim().lowercase()
                        val value = line.substring(i + 1).trim()
                        if (name == "user-agent") seen.userAgent = value
                        if (name == "accept") seen.accept = value
                    }
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    val head = StringBuilder("HTTP/1.1 $status X\r\n")
                    head.append("Content-Type: $contentType\r\n")
                    headers.forEach { (k, v) -> head.append("$k: $v\r\n") }
                    head.append("Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n")
                    sock.getOutputStream().apply {
                        write(head.toString().toByteArray(Charsets.ISO_8859_1))
                        write(bytes)
                        flush()
                    }
                }
            } catch (_: java.io.IOException) {
                // the server was closed before a request arrived
            }
        }
        try {
            return block("http://127.0.0.1:${server.localPort}/api/get", seen)
        } finally {
            server.close()
            worker.join(2_000)
        }
    }

    private val ua = "Utasync/test (https://example.invalid)"

    @Test fun `the user agent and accept headers reach the server`() {
        withServer(200, "application/json", "{}") { url, seen ->
            val r = runBlocking { UrlConnectionHttp().get(url, ua) }
            assertEquals(200, r.code)
            assertEquals(ua, seen.userAgent)
            assertEquals("application/json", seen.accept)
            assertEquals("{}", r.body)
            assertNull(r.retryAfterSec)
        }
    }

    @Test fun `a 429 returns its error-stream body, content type and Retry-After`() {
        withServer(429, "application/json", "{\"message\":\"slow down\"}", mapOf("Retry-After" to "7")) { url, _ ->
            val r = runBlocking { UrlConnectionHttp().get(url, ua) }
            assertEquals(429, r.code)
            assertEquals("{\"message\":\"slow down\"}", r.body)
            assertEquals("application/json", r.contentType)
            assertEquals(7, r.retryAfterSec)
        }
    }

    @Test fun `a Retry-After that is not an integer is null`() {
        withServer(429, "text/plain", "x", mapOf("Retry-After" to "Wed, 21 Oct 2026 07:28:00 GMT")) { url, _ ->
            val r = runBlocking { UrlConnectionHttp().get(url, ua) }
            assertEquals(429, r.code)
            assertNull(r.retryAfterSec)
        }
    }
}
