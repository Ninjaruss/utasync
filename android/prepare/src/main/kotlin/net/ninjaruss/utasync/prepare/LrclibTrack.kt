package net.ninjaruss.utasync.prepare

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** One LRCLIB record. Lyrics are null for an instrumental or when LRCLIB has none. */
data class LrclibTrack(
    val id: Long,
    val trackName: String,
    val artistName: String,
    val albumName: String?,
    val durationSec: Int?,
    val instrumental: Boolean,
    val plainLyrics: String?,
    val syncedLyrics: String?,
)

/** Null for a 404 error body, plain-text error, or anything else that is not a track record. */
fun parseTrack(json: String): LrclibTrack? = try {
    toTrack(JSONObject(json))
} catch (_: JSONException) {
    null
}

/** Empty for anything that is not a JSON array of records. */
fun parseTracks(json: String): List<LrclibTrack> = try {
    val array = JSONArray(json)
    (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::toTrack) }
} catch (_: JSONException) {
    emptyList()
}

// An error body ({"statusCode":404,...}) has no id or trackName, so it is not a record.
private fun toTrack(o: JSONObject): LrclibTrack? {
    if (!o.has("id") || o.isNull("id") || !o.has("trackName") || o.isNull("trackName")) return null
    return LrclibTrack(
        id = o.getLong("id"),
        trackName = o.getString("trackName"),
        artistName = o.optText("artistName").orEmpty(),
        albumName = o.optText("albumName"),
        durationSec = if (o.has("duration") && !o.isNull("duration")) o.optDouble("duration").toInt() else null,
        instrumental = o.optBoolean("instrumental", false),
        plainLyrics = o.optText("plainLyrics"),
        syncedLyrics = o.optText("syncedLyrics"),
    )
}

private fun JSONObject.optText(key: String): String? =
    if (has(key) && !isNull(key)) getString(key) else null
