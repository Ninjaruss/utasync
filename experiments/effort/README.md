# Approach B: does an aligner's draft cost the user less than tapping every line?

**Written before the numbers were put together. Time box: one day.**

## Why this is a new question and not ADR-0003 re-litigated

ADR-0003 forbids restating its gate after seeing a result, and this does not. That gate
asked **"is arm D accurate enough to be the engine?"** and a required column failed
(L62). This asks a different question that no gate here has asked: **"is arm D's output
a cheaper starting point for the user than nothing?"** A draft can be worth having while
being far too inaccurate to trust — those are not the same claim, and the second one is
about the product, not the model.

Arm D's accuracy is **not** re-scored. L62's numbers are taken exactly as they are.

## Declared up front: the data is already seen

I have read L62's per-song error table, so a threshold I choose now cannot be honestly
called pre-registered against it. Two things keep this usable:

- the threshold is argued from the **user's complaint**, not from the numbers: the
  objection is "a bunch of work", so a route that does not at least **halve** the work is
  not worth reversing an ADR for. Halving is also the shape this ledger already uses for
  "helps everywhere" (L68, L69).
- it is applied to **every** song including the one I already know is worst, and the
  result is reported as a **screen, not a certificate** — the same standing ADR-0007 gave
  its own LRC screen.

## What is counted

User **actions**, per song, to get every line correct:

- **Tap every line** (today's only route for a song with no record): `N` taps, where `N`
  is the line count. One real-time pass.
- **Align, then correct what is wrong:** `cost × B`, where `B` is the number of lines the
  user would bother to fix and `cost` is the actions one fix takes.

Both routes need at least one full listen, so listening time is not what separates them
and is not counted. What separates them is how much the user must *do* while listening.

`cost` is a **design choice, not a measurement**, so both live options are reported:

| correction affordance | actions per line | exists today? |
| --- | --- | --- |
| long-press the line → nudge screen → drag → done | **3** | yes |
| tap once on the beat while the song plays | **1** | **no** — `TapSession` times lines strictly in order from line 0, so there is no way to re-time line 17 alone |

`B` depends on how wrong a line must be before a user fixes it. L62 reports counts at
>1 s and >2 s, so both are carried through rather than one being picked.

## The gate

Build approach B only if, with the correction affordance **that exists today**, the
aligner route costs at most **half** the actions of tapping every line, on **every** one
of the five songs.

If it passes only under an affordance that does not exist, the finding is "build the
correction first", not "build the aligner".

## Limits

- Five songs, one library, one aligner run — the same corpus L62 used, with its caveats
  (a catalogue LRC is a reference, not truth).
- Actions are a proxy for effort. A tap placed in real time while a song plays is not the
  same work as a drag made at leisure, and this counts them as one each.
- `B` assumes the user finds every wrong line. L63 measured that nothing can mark them,
  so finding them means noticing them while listening — this therefore **understates** the
  aligner route's real cost.
