package net.ninjaruss.utasync.playback

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WaveformDecoderTest {
    private lateinit var context: Context
    private val temp = mutableListOf<File>()

    @Before fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
    }

    @After fun tearDown() = temp.forEach { it.delete() }

    /** Mono 16-bit PCM WAV: [toneSec] of a 440 Hz sine at amplitude 0.5, then [silenceSec] of zeros. */
    private fun writeWav(toneSec: Double, silenceSec: Double, rate: Int = 44100): File {
        val toneN = (toneSec * rate).roundToInt()
        val total = toneN + (silenceSec * rate).roundToInt()
        val f = File.createTempFile("fixture", ".wav", context.cacheDir).also { temp += it }
        val pcm = java.nio.ByteBuffer.allocate(total * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until total) {
            val v = if (i < toneN) (0.5 * 32767 * sin(2 * PI * 440.0 * i / rate)).toInt() else 0
            pcm.putShort(v.toShort())
        }
        val hdr = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        hdr.put("RIFF".toByteArray()).putInt(36 + total * 2).put("WAVE".toByteArray())
        hdr.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(rate)
        hdr.putInt(rate * 2).putShort(2).putShort(16)
        hdr.put("data".toByteArray()).putInt(total * 2)
        RandomAccessFile(f, "rw").use { it.write(hdr.array()); it.write(pcm.array()) }
        return f
    }

    @Test fun envelopeLengthMatchesDuration() {
        val f = writeWav(toneSec = 3.0, silenceSec = 3.0) // 6.000 s
        val env = runBlocking { decodeEnvelope(context, Uri.fromFile(f), 200) }.getOrThrow()
        assertEquals(200, env.peaksPerSecond)
        val expected = 6.0 * 200
        // 50 ms == 10 peaks at 200/s
        assertEquals(expected, env.peaks.size.toDouble(), 10.0)
        assertEquals(6000.0, env.durationMs.toDouble(), 50.0)
        // Self-consistency: peaks cover the reported duration.
        assertEquals(env.durationMs / 1000.0 * 200, env.peaks.size.toDouble(), 10.0)
    }

    @Test fun silenceReadsLowAndToneReadsHigh() {
        val f = writeWav(toneSec = 3.0, silenceSec = 3.0)
        val env = runBlocking { decodeEnvelope(context, Uri.fromFile(f), 200) }.getOrThrow()
        val p = env.peaks
        // Stay 100 ms clear of the boundary at 3.0 s (peak index 600).
        val tone = p.slice(20 until 580)
        val silence = p.slice(620 until p.size - 20)
        assertTrue("tone min=${tone.min()}", tone.all { it in 0.3f..0.7f }) // amplitude 0.5, normalised 0..1
        assertTrue("silence max=${silence.max()}", silence.all { it < 0.02f })
        assertTrue(p.all { it in 0f..1f })
    }

    @Test fun unreadableUriReturnsFailure() {
        val missing = Uri.fromFile(File(context.cacheDir, "does-not-exist.wav"))
        val r1 = runBlocking { decodeEnvelope(context, missing, 200) }
        assertTrue(r1.isFailure)
        val bogus = Uri.parse("content://net.ninjaruss.utasync.nonexistent/audio/1")
        val r2 = runBlocking { decodeEnvelope(context, bogus, 200) }
        assertTrue(r2.isFailure)
        // A file that exists but is not audio must also fail, not throw.
        val junk = File.createTempFile("junk", ".wav", context.cacheDir).also { temp += it; it.writeText("not audio") }
        assertTrue(runBlocking { decodeEnvelope(context, Uri.fromFile(junk), 200) }.isFailure)
    }

    /** Positive control for the unreadable test: the same entry point succeeds on a good file. */
    @Test fun readableUriSucceeds() {
        val f = writeWav(1.0, 1.0)
        assertTrue(runBlocking { decodeEnvelope(context, Uri.fromFile(f), 200) }.isSuccess)
    }

    /** Gate measurement: 4-minute file. Logs the time; does NOT assert on it (emulator timing is not evidence). */
    @Test fun measureFourMinuteDecode() {
        val f = writeWav(toneSec = 120.0, silenceSec = 120.0, rate = 44100)
        val t0 = System.nanoTime()
        val env = runBlocking { decodeEnvelope(context, Uri.fromFile(f), 200) }.getOrThrow()
        val ms = (System.nanoTime() - t0) / 1_000_000
        Log.i("WaveformGate", "EMULATOR-MEASURED decode 240s wav: ${ms}ms peaks=${env.peaks.size} durationMs=${env.durationMs}")
        assertEquals(240.0 * 200, env.peaks.size.toDouble(), 10.0)
    }
}
