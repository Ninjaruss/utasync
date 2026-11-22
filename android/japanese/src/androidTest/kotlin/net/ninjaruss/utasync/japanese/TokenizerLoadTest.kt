package net.ninjaruss.utasync.japanese

import android.util.Log
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Measurement, not a gate (ledger L52): times the first `tokenize` call, which pays for the
 * dictionary load through ART, and logs it under tag "TokenizerLoad". It asserts only that
 * tokenising worked; it sets no budget. Run it in a fresh process for a cold figure.
 */
class TokenizerLoadTest {
    @Test fun firstTokenizeCallIsTimedAndReported() {
        val rt = Runtime.getRuntime()
        System.gc()
        val before = rt.totalMemory() - rt.freeMemory()
        val t0 = System.nanoTime()
        val tokens = tokenize("今日は雨")
        val firstMs = (System.nanoTime() - t0) / 1_000_000.0
        System.gc()
        val after = rt.totalMemory() - rt.freeMemory()
        val t1 = System.nanoTime()
        tokenize("明日会いましょう")
        val secondMs = (System.nanoTime() - t1) / 1_000_000.0
        val line = "api=${android.os.Build.VERSION.SDK_INT} device=${android.os.Build.MODEL} " +
            "firstMs=$firstMs secondMs=$secondMs heapDeltaMB=${(after - before) / 1048576.0}"
        Log.i("TokenizerLoad", line)
        println("TokenizerLoad $line")
        assertTrue(tokens.isNotEmpty())
    }
}
