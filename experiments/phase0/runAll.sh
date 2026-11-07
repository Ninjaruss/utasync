#!/usr/bin/env bash
# Phase 0 batch: arm D against each available prior, plus planted-offset stress runs.
# Sequential (one model job at a time), most informative runs first; a run whose output
# already exists is skipped, so the batch can be stopped and resumed.
# Logs to .cache/phase0/batch.log.
set -u
cd "$(dirname "$0")/../.."
log=.cache/phase0/batch.log; mkdir -p .cache/phase0
R=.cache/sync-benchmark/runs
out() { # output path knownTextAlign.mjs would write for these args
  local s=$1 p=$2 sh=${3:-}; local arm="D-whisper-knowntext@${p}"
  [ -n "$sh" ] && arm="${arm}${sh}s"
  echo ".cache/phase0/runs/${s}.$(echo "$arm" | sed -E 's/[^a-zA-Z0-9.-]+/_/g').json"
}
run() { # song priorKind(lrc|run) [shift] [runfile]
  local s=$1 p=$2 sh=${3:-} rf=${4:-}
  [ -f "$(out "$s" "$p" "$sh")" ] && { echo "skip $s $p $sh" >> "$log"; return; }
  local args=("$s" --prior "$([ "$p" = run ] && echo "run:$rf" || echo lrc)")
  [ -n "${MANIFEST:-}" ] && args+=(--manifest "$MANIFEST")
  [ -n "$sh" ] && args+=(--prior-shift "$sh")
  echo "=== ${args[*]} $(date -u +%FT%TZ)" >> "$log"
  node experiments/phase0/knownTextAlign.mjs "${args[@]}" >> "$log" 2>&1 </dev/null || echo "FAILED ${args[*]}" >> "$log"
}
run veil lrc
run veil run "" $R/veil-81cdf87f-cae5-4140-b157-b2498e67312e.json
run veil lrc +0.8
run guitar-loneliness lrc
run guitar-loneliness run "" $R/guitar-loneliness-2c772870-2210-4ac6-a7a5-80bbc3177d2e.json
run guitar-loneliness lrc +0.8
run going-my-way lrc
run going-my-way run "" $R/going-my-way-90159550-6e81-4988-b1a2-600e2dac98d0.json
run stranger-than-heaven lrc
run recollect lrc
run veil lrc -0.8
run guitar-loneliness lrc -0.8
run going-my-way lrc +0.8
# PJS medleys (corpus-onsets). Arm B is the synthetic prior the builder plants (D@lrc); arm A is the
# current pipeline's own output, read from the prior of D@run, which needs a browser run per medley:
#   npm run benchmark:sync -- stage-pilot --manifest .cache/pjs/manifest.json   (then /?benchmark=pilot)
#   npm run benchmark:sync -- collect
# A medley with no completed browser run yet is logged and skipped, so its arm A shows as "not
# evaluated" in the report rather than being faked. Manifests default to the two builder outputs
# (unaccompanied, --bed); override with PJS_MANIFESTS="a.json b.json".
for m in ${PJS_MANIFESTS:-.cache/pjs/manifest.json .cache/pjs-bed/manifest.json}; do
  [ -f "$m" ] || { echo "no PJS manifest at $m (build it: experiments/phase0/README.md)" >> "$log"; continue; }
  while IFS=$'\t' read -r id _; do
    MANIFEST=$m run "$id" lrc
    rf=$(node experiments/phase0/medleyBatch.mjs latest "$R" "$id")
    if [ -n "$rf" ]; then MANIFEST=$m run "$id" run "" "$rf"
    else echo "no completed arm A browser run for $id; D@run skipped" >> "$log"; fi
  done < <(node experiments/phase0/medleyBatch.mjs ids "$m")
done
echo "=== ALL DONE $(date -u +%FT%TZ)" >> "$log"
