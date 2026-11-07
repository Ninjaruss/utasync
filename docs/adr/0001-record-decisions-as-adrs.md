# ADR-0001: Record decisions as short ADRs; plans are not instructions

- Status: accepted
- Date: 2026-11-03

## Context

Between June and September 2026 the project produced 72 plan/spec files (~38,000 lines) and
a 1,775-line accuracy plan with 21+ rounds. Agents could not read them in full, decisions
were re-litigated, and some conclusions ("CTC is a dead end") were recorded without the
condition under which they would stop holding. There was no `CLAUDE.md`.

## Decision

- `CLAUDE.md` (≤150 lines) holds the product goal, commands and standing rules.
- Each decision is an ADR in `docs/adr/NNNN-title.md`, one page at most, with: context,
  decision, evidence, consequences, and **what would reverse it**.
- Plans may still be written for large work, but they are working notes. When a plan's
  outcome matters later, it becomes an ADR or a ledger entry.

## Consequences

Agents read `CLAUDE.md` plus the ADR for the area they touch. `docs/superpowers/` remains
as evidence and history.

## Reversal

Revisit if ADRs go stale (an ADR contradicted by the code for more than one release).
