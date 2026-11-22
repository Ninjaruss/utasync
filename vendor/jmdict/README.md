# JMdict data: provenance

The Android app's dictionary and reading inventory are converted, at development time, from the
PWA's committed data. **This directory holds no data**: the input is read in place from
`public/jmdict-popover.json` and `public/jmdict-readings.json` (CLAUDE.md rule 5 forbids fetching
anything during the build, and copying 37 MB of JSON here would only duplicate it).

## Upstream

| | |
| --- | --- |
| Dictionary | JMdict (English), by the Electronic Dictionary Research and Development Group (EDRDG), https://www.edrdg.org/jmdict/j_jmdict.html |
| Distribution | `jmdict-simplified`, https://github.com/scriptin/jmdict-simplified, release `3.6.2+20260622163854`, asset `jmdict-eng-3.6.2+20260622163854.json.tgz` |
| Named in | `scripts/build-jmdict-gloss.mjs` (`TAG`), which produced the three `public/jmdict-*.json` files from that release |
| Licence | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://www.edrdg.org/edrdg/licence.html |

The `public/jmdict-*.json` files are a derivative of that release, not the release itself: the PWA's
audit rounds selected and corrected glosses (reading-disambiguated senses, kana headwords,
pronoun senses). The Android conversion inherits those corrections on purpose.

## What the Android build derives

- `android/data/src/main/assets/utasync-seed.db` (`dictionary` table) from `jmdict-popover.json`
- `android/japanese/src/main/assets/reading-alternates.json` from `jmdict-readings.json`

Both by `node scripts/build-japanese-db.mjs`, which prints every entry it drops and why.
These outputs are derivative works under the same licence.

## Attribution (must appear in the app, not only here)

> This application uses the JMdict dictionary file. JMdict is the property of the Electronic
> Dictionary Research and Development Group, and is used in conformance with the Group's licence
> (CC BY-SA 4.0). https://www.edrdg.org/edrdg/licence.html

The in-app attribution screen is not built yet; it is owed before release.
