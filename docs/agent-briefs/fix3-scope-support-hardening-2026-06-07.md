# Builder Brief — FIX-3 scope-support hardening (close the fail-open leak)

- **For:** Codex (builder), `GGRValle/kerf-app`
- **From:** Car-1 floor gate (spec: Christian / gate · landed by Claude Code session as the relay artifact)
- **Date:** 2026-06-07
- **Branch:** continue on the **#307** branch (built on `e9e3fe1`, post-#306 — do **not** revert routing). **Keep it one PR.**
- **Acceptance probe:** `bakeoff/inversion_fix3_scope_support_probe.mts` on `gate/car1-eval-harness` @ `cc09876` (now **13 cases**). `git fetch origin gate/car1-eval-harness`, copy it into the **fix worktree** (it imports `../src` relatively, so it runs against your resolver), and code until green.

> **Status (2026-06-07 PM):** Pass 1 (the two changes below) shipped as **#307, merged `a887cb0`**, live on kerf-v17-internal — adversarial re-smoke passed (decisive bar fixed; nothing-silent invariant holds in prod). **Change 2 (`partial_support`) landed correctly and generally — done.** **Change 1 (distinctive-token coverage) is only partially done:** the literal token `"plus"` was stop-listed, but the *shape* generalizes and other coincidental corpus tokens still inflate coverage. **The open task is Pass 2 (bottom of this brief)** — non-blocking (nothing-silent already holds), base it on **fresh main `a887cb0`**, not the merged #307 branch. Probe target is now **13/13**.

---

## Why this brief exists

FIX-3 (`0c2d001`) fixed the prod over-strip — the decisive `Mini-split supply and install` now survives — but on the **safety floor** it introduced a demonstrated **fail-open**: coverage counts raw token overlap, so a coincidental filler word inflates it and invented scope rides in **unflagged**. This is the floor that exists to stop model/ASR confabulation, so a silent admit is the failure mode we cannot ship. Probe currently reads **9/11**; the two red cases are the exact target.

```
XX [LEAK cabana] want=STRIP                 got=kept            ← connective "plus" inflation (metric bug)
XX [LEAK steam]  want=KEEP+partial_support  got=kept, NO flag   ← minority invention, silent
```

## The two changes (single PR, surgical — only `modelReplyResolver.ts` + tests + probe)

**1. Distinctive-token coverage → closes `cabana` (STRIP).**
`"plus"` counting as a supported anchor is a metric bug: `Mini-split … plus a new rooftop cabana` hits exactly 3/5 = 0.60 only because the operator's text contains "plus" ("…90 sqft, *plus* converting the garage…"). Exclude a **general** connective/function-word set from the supported count — do **not** special-case `"plus"` (whack-a-mole). Generalize so coincidental common-word overlap can't tip coverage; coverage must be carried by distinctive scope content, not filler.

**2. `partial_support` soft-flag → surfaces `steam` (KEEP + flag).**
`Curbless shower steam` (0.67) is coverage-**indistinguishable** from the legitimate `…tile, liner, drain` elaboration (0.60) — any threshold that strips steam also strips real scope. So the correct lock is not to strip it but to **surface** it: when a line is **kept via coverage** yet carries tokens absent from the corpus, emit `partial_support:<line>` — distinct from `unsupported_scope` (hard strip). Source-or-silent applied to the floor: the inferred detail stays, but never silently. **Add a unit test asserting the flag fires.**

## Invariants — do not touch

- **Number-exactness stays an absolute gate** (`numbersHaveExactSupport`) — any invented quantity/price still strips. Don't loosen it.
- **No route / allowlist / honesty-floor / schema changes.** Footprint stays `modelReplyResolver.ts` + tests + probe.
- The 6 KEEP cases anchor on **distinctive nouns** (mini-split, shower, bath, studs, ADU, cabinet, floor) — none on a connective — so de-anchoring connectives **will not** regress them. Verify it doesn't.
- Don't loosen further to pass — the goal is *tighter on cabana, visible on steam*, not more permissive.

## Lock it on main, not just the probe

Add the live-failure cases (`Mini-split supply and install` survives; `rooftop cabana` strips; `steam` keeps + flags) as **unit tests in `tests/right-hand-model-turn-resolver.test.ts`** — the probe is the gate's instrument; the unit tests are what hold the regression on main + CI (same discipline as the FIX2 paraphrase test).

## Acceptance the gate will re-verify (independently, not your numbers)

`FIX-3 probe 11/11` (cabana strips · steam KEEP+`partial_support`) · `fabrication 4/4` · `honesty 7/7` · resolver suite green · `tsc --noEmit` clean · new `partial_support` unit test passing · floor diff clean.

## Timebox / fallback

If change (1) cannot close `cabana` without regressing any of the 6 KEEPs, **stop and ping the gate** — we fall to shipping FIX-3 as-is (the realistic decisive bar is already met) + fast-follow the hardening, rather than thrash the safety spine. Not expected to fight (the KEEPs are noun-anchored), but the floor doesn't get over-tuned to hit a number.

## Process

Push hardening to #307 → **ping the gate the commit** → gate re-gates (probe from the fix worktree + invariants + floor-diff + flag test) → **gate triggers merge** → redeploy + adversarial re-smoke (confirms `Mini-split`/curbless/demo land in `working_draft.scope`, and that nothing untraceable to `heard_text` enters scope without `partial_support`). **Merge stays held until the probe is green.**

*(Pass 1 is complete — #307 merged `a887cb0`, re-smoke passed. The remaining work is Pass 2 below.)*

---

## Pass 2 — fast-follow: generic distinctive-token coverage · **OPEN (the actual next task)**

**Why:** Pass 1 closed the connective leak only for the literal token `"plus"` (stop-listed). The shape generalizes — **any** coincidental common token in the operator corpus inflates raw-token coverage to ≥0.60 and rides an invented noun in as `partial_support` (kept + flagged) instead of stripping it. Demonstrated against the live floor:

```text
stripped | Mini-split plus   rooftop cabana                       ← closed (plus stop-listed)
KEPT     | Mini-split down   rooftop cabana   [partial_support]   ← "down"  (op: "bath down to studs")
KEPT     | Mini-split rough  rooftop cabana   [partial_support]   ← "rough" (op: "rough plumbing")
```

**Target:** coverage must be carried by **distinctive scope content**, not coincidental filler — so **every** `Mini-split <x> rooftop cabana` variant STRIPs (its invented head noun is unanchored), while `Curbless shower steam` and faithful elaboration stay **KEEP + `partial_support`**. Keep `numbersHaveExactSupport` and the `partial_support` 3-state exactly as shipped; Pass 2 only tightens **which tokens count as anchors**.

**This is the genuinely-fuzzy part.** `"rough"` is filler in `rough rooftop cabana` but real scope in `rough plumbing` — the overlap is *coincidental*, not *coherent*. A general function-word stop-list closes `down`/`from`/`into` but not content-ish words like `rough`/`family`. You likely need coverage over the line's **distinctive nouns** (the supported set must include the line's head/distinctive noun, not just any overlapping token), or an equivalent distinctiveness signal.

**Do NOT whack-a-mole.** If you find yourself enumerating `"down"`, `"rough"`, … into the stop-list to pass the probe, **STOP and ping the gate** — that is Pass 1's mistake repeated. `partial_support` already holds the nothing-silent line in prod, so Pass 2 is **improvement, not emergency**: a principled distinctive-token rule that hits 13/13 without regressing the 6 KEEPs is the bar. If it needs heavy machinery (POS tagging) or won't come clean, **escalate for a design pass** rather than overfit.

**Acceptance (gate re-runs independently; base = fresh main `a887cb0`):** `inversion_fix3_scope_support_probe.mts` **13/13** (ALL cabana variants STRIP; `steam` KEEP+`partial_support`) · fabrication **4/4** · honesty **7/7** · resolver suite · `tsc --noEmit` · the 6 KEEP cases unregressed · the cabana-strip cases added as unit tests on main. Probe @ `gate/car1-eval-harness` (pushed) — copy into the fix worktree to run.

**Process:** new branch off `a887cb0` → push → **ping the gate the commit** → gate re-gates to 13/13 + invariants → **gate triggers merge** → redeploy + re-smoke. Non-blocking for the walk; **land before June 13.**
