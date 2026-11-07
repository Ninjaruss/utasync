#!/usr/bin/env bash
# Runs the pre-registered spike in 2026-11-04-prior-following.md (resumable).
set -u
cd "$(dirname "$0")/../../.."
log=.cache/phase0/spike-2026-11-04.log
for s in veil guitar-loneliness going-my-way; do
  for sh in "" +0.8 -0.8; do
    tag=$( [ -n "$sh" ] && echo "${sh}s" ); f=".cache/phase0/runs/${s}.$(echo "D-whisper-knowntext~filler@lrc${tag}" | sed -E 's/[^a-zA-Z0-9.-]+/_/g').json"
    [ -f "$f" ] && continue
    echo "=== $s filler shift=${sh:-0} $(date -u +%T)" >> "$log"
    node experiments/phase0/knownTextAlign.mjs "$s" --prior lrc --filler '♪' ${sh:+--prior-shift $sh} >> "$log" 2>&1 || echo "FAILED $s $sh" >> "$log"
  done
done
echo "=== SPIKE DONE $(date -u +%T)" >> "$log"
