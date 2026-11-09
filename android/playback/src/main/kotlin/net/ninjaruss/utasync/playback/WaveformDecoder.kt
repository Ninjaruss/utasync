package net.ninjaruss.utasync.playback

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Per-bucket absolute peak of a decoded audio file, normalised to 0..1.
 *
 * [peaks] has one entry per 1/[peaksPerSecond] s of audio (channels are mixed by taking the
 * loudest sample in the bucket). [durationMs] is derived from the decoded frame count, not
 * from container metadata, so it is what the peaks really cover.
 */
data class Envelope(val peaksPerSecond: Int, val peaks: FloatArray, val durationMs: Long)

/**
 * Decodes the audio at [uri] to a peak envelope, on [Dispatchers.Default].
 *
 * Returns [Result.failure] when the URI cannot be opened or decoded (revoked SAF permission,
 * moved file, not audio, no decoder). Cancellation is rethrown, not wrapped.
 */
suspend fun decodeEnvelope(context: Context, uri: Uri, peaksPerSecond: Int = 200): Result<Envelope> =
    withContext(Dispatchers.Default) {
        try {
            Result.success(decode(context, uri, peaksPerSecond))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

private suspend fun decode(context: Context, uri: Uri, peaksPerSecond: Int): Envelope {
    require(peaksPerSecond > 0) { "peaksPerSecond must be positive" }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
        extractor.setDataSource(context, uri, null)
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: error("no audio track")
        extractor.selectTrack(track)
        val inFormat = extractor.getTrackFormat(track)
        codec = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(inFormat, null, null, 0)
        codec.start()

        var sampleRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var floatPcm = false

        // Capacity from the container's duration hint (+ slack); grown if the hint is short/absent.
        val hintUs = if (inFormat.containsKey(MediaFormat.KEY_DURATION)) inFormat.getLong(MediaFormat.KEY_DURATION) else 0L
        var peaks = FloatArray((hintUs * peaksPerSecond / 1_000_000L).toInt() + 64)
        var peakCount = 0
        fun addPeak(v: Float) {
            if (peakCount == peaks.size) peaks = peaks.copyOf(maxOf(1024, peaks.size * 2))
            peaks[peakCount++] = v
        }
        var frames = 0L // decoded frames so far (one frame = one sample per channel)
        var bucketMax = 0f
        var bucketIdx = 0L // bucket k covers frames [k*rate/pps, (k+1)*rate/pps)

        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        while (!outputDone) {
            coroutineContext.ensureActive()
            if (!inputDone) {
                val i = codec.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val buf = codec.getInputBuffer(i)!!
                    val n = extractor.readSampleData(buf, 0)
                    if (n < 0) {
                        codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            val o = codec.dequeueOutputBuffer(info, 10_000)
            when {
                o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val f = codec.outputFormat
                    sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                }
                o >= 0 -> {
                    if (info.size > 0) {
                        val out = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
                        out.position(info.offset)
                        out.limit(info.offset + info.size)
                        val nFrames = info.size / ((if (floatPcm) 4 else 2) * channels)
                        for (fr in 0 until nFrames) {
                            for (c in 0 until channels) {
                                val v = if (floatPcm) out.getFloat() else out.getShort() / 32768f
                                val a = if (v < 0) -v else v
                                if (a > bucketMax) bucketMax = a
                            }
                            frames++
                            // Close every bucket whose end boundary this frame has reached.
                            while (frames * peaksPerSecond >= (bucketIdx + 1) * sampleRate) {
                                addPeak(bucketMax.coerceAtMost(1f))
                                bucketMax = 0f
                                bucketIdx++
                            }
                        }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        }
        // Flush the trailing partial bucket so the envelope covers the whole file.
        if (frames * peaksPerSecond > bucketIdx * sampleRate) addPeak(bucketMax.coerceAtMost(1f))
        return Envelope(peaksPerSecond, peaks.copyOf(peakCount), frames * 1000L / sampleRate)
    } finally {
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        extractor.release()
    }
}
