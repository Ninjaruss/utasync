package net.ninjaruss.utasync.prepare

import java.net.URLEncoder

/**
 * What we know about a track before asking LRCLIB for its lyrics.
 *
 * There is deliberately no album. LRCLIB's endpoints accept `album_name`, but nothing here ever
 * populated it, so the README claimed the query carried an album it never sent. Adding one would
 * change which records match — an accuracy change, which rule 1 would want measured — so the
 * field is gone rather than quietly wired up: what leaves the device is exactly the title, the
 * artist and, for `/api/get`, the duration.
 */
data class TrackQuery(
    val title: String,
    val artist: String,
    val durationSec: Int? = null,
)

private const val BASE = "https://lrclib.net/api"

/** `GET /api/get`: exact match; the server also checks [TrackQuery.durationSec] within +-2 s. */
fun getUrl(q: TrackQuery): String = build(
    "$BASE/get",
    "track_name" to q.title,
    "artist_name" to q.artist,
    "duration" to q.durationSec?.toString(),
)

/** `GET /api/search`: fuzzy match. The endpoint accepts no duration, so none is sent. */
fun searchUrl(q: TrackQuery): String = build(
    "$BASE/search",
    "track_name" to q.title,
    "artist_name" to q.artist,
)

/** LRCLIB asks clients to identify themselves with the app name, version and a link. */
fun userAgent(versionName: String): String =
    "Utasync/$versionName (https://github.com/Ninjaruss/utasync)"

private fun build(base: String, vararg params: Pair<String, String?>): String =
    params
        .filter { !it.second.isNullOrBlank() }
        .joinToString("&", prefix = "$base?") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
