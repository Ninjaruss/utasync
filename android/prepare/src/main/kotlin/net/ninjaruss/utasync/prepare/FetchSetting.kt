package net.ninjaruss.utasync.prepare

import android.content.Context

/**
 * Whether lyrics are looked up automatically on import. On by default (§5.4): the point of the
 * app is that a song arrives ready. Switching it off is not a failure — every song then takes a
 * manual rung (choose a result, paste the words, import an .lrc), which all still work.
 */
class FetchSetting(context: Context) {
    private val prefs =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var enabled: Boolean
        get() = prefs.getBoolean(KEY, true)
        set(value) {
            prefs.edit().putBoolean(KEY, value).apply()
        }

    private companion object {
        const val PREFS = "utasync"
        const val KEY = "fetch_lyrics"
    }
}
