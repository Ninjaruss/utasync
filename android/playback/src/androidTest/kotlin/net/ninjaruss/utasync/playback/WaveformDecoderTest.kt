package net.ninjaruss.utasync.playback

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
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

    private fun tmp(suffix: String) = File.createTempFile("fixture", suffix, context.cacheDir).also { temp += it }

    /**
     * Interleaved stereo 16-bit PCM: [toneSec] of 440 Hz, then [silenceSec] of zeros.
     * Left amplitude 0.25, right 0.5, so the correct per-bucket peak (max over channels) is 0.5
     * and a decoder that only reads channel 0 reads 0.25.
     */
    private fun pcm(toneSec: Double, silenceSec: Double, rate: Int): ShortArray {
        val toneN = (toneSec * rate).roundToInt()
        val total = toneN + (silenceSec * rate).roundToInt()
        val out = ShortArray(total * 2)
        for (i in 0 until toneN) {
            val s = sin(2 * PI * 440.0 * i / rate)
            out[2 * i] = (0.25 * 32767 * s).toInt().toShort()
            out[2 * i + 1] = (0.5 * 32767 * s).toInt().toShort()
        }
        return out
    }

    private fun writeWav(pcm: ShortArray, rate: Int): File {
        val f = tmp(".wav")
        val data = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        pcm.forEach { data.putShort(it) }
        val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        h.put("RIFF".toByteArray()).putInt(36 + pcm.size * 2).put("WAVE".toByteArray())
        h.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(2).putInt(rate)
        h.putInt(rate * 4).putShort(4).putShort(16)
        h.put("data".toByteArray()).putInt(pcm.size * 2)
        RandomAccessFile(f, "rw").use { it.write(h.array()); it.write(data.array()) }
        return f
    }

    /** AAC-LC in an M4A container, encoded in-test (MediaCodec + MediaMuxer). Nothing is committed. */
    private fun writeAac(pcm: ShortArray, rate: Int): File {
        val f = tmp(".m4a")
        val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 1 shl 16)
        }
        val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        enc.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        enc.start()
        val mux = MediaMuxer(f.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var track = -1
        val info = MediaCodec.BufferInfo()
        var pos = 0 // in shorts
        var inDone = false
        var outDone = false
        try {
            while (!outDone) {
                if (!inDone) {
                    val i = enc.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val b = enc.getInputBuffer(i)!!.order(ByteOrder.nativeOrder())
                        b.clear()
                        val n = minOf(b.capacity() / 2, pcm.size - pos)
                        val us = pos / 2 * 1_000_000L / rate
                        if (n <= 0) {
                            enc.queueInputBuffer(i, 0, 0, us, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inDone = true
                        } else {
                            b.asShortBuffer().put(pcm, pos, n)
                            enc.queueInputBuffer(i, 0, n * 2, us, 0)
                            pos += n
                        }
                    }
                }
                val o = enc.dequeueOutputBuffer(info, 10_000)
                when {
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> track = mux.addTrack(enc.outputFormat).also { mux.start() }
                    o >= 0 -> {
                        val ob = enc.getOutputBuffer(o)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0) mux.writeSampleData(track, ob, info)
                        enc.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
                    }
                }
            }
        } finally {
            runCatching { enc.stop() }; enc.release()
            runCatching { mux.stop() }; mux.release()
        }
        return f
    }

    private fun decode(f: File) = runBlocking { decodeEnvelope(context, Uri.fromFile(f), 200) }

    private fun assertLengthAndShape(env: Envelope, seconds: Double, tol: Float) {
        assertEquals(200, env.peaksPerSecond)
        // Compare against the KNOWN source length, not the decoder's own durationMs.
        // 50 ms == 10 peaks at 200/s.
        assertEquals("peaks.size", seconds * 200, env.peaks.size.toDouble(), 10.0)
        assertEquals("durationMs", seconds * 1000, env.durationMs.toDouble(), 50.0)
        val p = env.peaks
        val boundary = (seconds / 2 * 200).toInt()
        val tone = p.slice(20 until boundary - 20)
        val silence = p.slice(boundary + 20 until p.size - 20)
        assertTrue("tone range ${tone.min()}..${tone.max()}", tone.all { it in (0.5f - tol)..(0.5f + tol) })
        assertTrue("silence max=${silence.max()}", silence.all { it < 0.02f })
        assertTrue(p.all { it in 0f..1f })
    }

    @Test fun wavStereoLengthAndShape() {
        val rate = 44100
        assertLengthAndShape(decode(writeWav(pcm(3.0, 3.0, rate), rate)).getOrThrow(), 6.0, 0.02f)
    }

    @Test fun aacStereoLengthAndShape() {
        val rate = 44100
        val env = decode(writeAac(pcm(3.0, 3.0, rate), rate)).getOrThrow()
        Log.i("WaveformGate", "aac 6s: peaks=${env.peaks.size} durationMs=${env.durationMs}")
        // Lossy codec: wider level tolerance; the length bound is the same 50 ms.
        assertLengthAndShape(env, 6.0, 0.1f)
    }

    @Test fun unreadableUriReturnsFailure() {
        val missing = Uri.fromFile(File(context.cacheDir, "does-not-exist.wav"))
        assertTrue(runBlocking { decodeEnvelope(context, missing, 200) }.isFailure)
        val bogus = Uri.parse("content://net.ninjaruss.utasync.nonexistent/audio/1")
        assertTrue(runBlocking { decodeEnvelope(context, bogus, 200) }.isFailure)
        val junk = tmp(".wav").also { it.writeText("not audio") }
        assertTrue(decode(junk).isFailure)
    }

    /** Positive control: the same entry point succeeds on good input, so a blanket-failure stub cannot pass. */
    @Test fun readableUriSucceeds() {
        assertTrue(decode(writeWav(pcm(1.0, 1.0, 44100), 44100)).isSuccess)
    }

    /**
     * Gate measurement on 4 minutes of stereo AAC (the realistic input), after a warm-up decode
     * so JIT cost is excluded. Logs the timings; asserts only a coarse real-time-factor bound
     * (hang / order-of-magnitude regression), NOT the hardware-dependent 2 s gate.
     */
    @Test fun measureFourMinuteAacDecode() {
        val rate = 44100
        val src = pcm(120.0, 120.0, rate)
        val aac = writeAac(src, rate)
        val wav = writeWav(src, rate)
        decode(aac).getOrThrow() // warm-up, not timed
        val dev = "${android.os.Build.MODEL} sdk${android.os.Build.VERSION.SDK_INT} " +
            if (android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.HARDWARE.contains("ranchu")) "EMULATOR" else "DEVICE"
        var worstRtf = 0.0
        repeat(3) { run ->
            val t0 = System.nanoTime()
            val env = decode(aac).getOrThrow()
            val ms = (System.nanoTime() - t0) / 1_000_000
            val rtf = ms / 240_000.0
            worstRtf = maxOf(worstRtf, rtf)
            Log.i("WaveformGate", "[$dev] AAC-LC stereo 44.1k 240s warm run${run + 1}: ${ms}ms rtf=${"%.4f".format(rtf)} peaks=${env.peaks.size} durationMs=${env.durationMs}")
            assertEquals(240.0 * 200, env.peaks.size.toDouble(), 10.0)
        }
        val t0 = System.nanoTime()
        decode(wav).getOrThrow()
        Log.i("WaveformGate", "[$dev] PCM-WAV stereo 44.1k 240s warm: ${(System.nanoTime() - t0) / 1_000_000}ms")
        assertTrue("real-time factor $worstRtf >= 10x audio length", worstRtf < 10.0)
    }
}
