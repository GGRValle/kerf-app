# Gate scorecard — PR #305 (`c94e168`) · Conversation Inversion (Dispatch 1)

**Gate:** Claude Code (independent). **Date:** 2026-06-07.
**Config:** reply brain `claude-haiku-4-5` · judge `claude-sonnet-4-6` · temp 0.
**Method:** PR checked out as worktree; harness imports the PR's own resolver. Lane A = deterministic floor probes (no model). Lane B = live reply brain through the real `resolveReplyWithModel`, frontier-judged, never string-matched.

## Verdict: **BLOCK**

The decisive criterion — *"Okonkwo novel narrative must produce a working draft with scope captured + ≤1 consequence-ranked question + identity as open_items"* — **fails on scope-captured**. Half the project (the ADU) is dropped from the working draft, end-to-end, and the dropped scope is mislabeled as fabrication. Root cause is a deterministic, model-independent defect in the draft-fabrication floor.

## Lane A — deterministic floor (PASS where it counts, one defect surfaced)

| Probe | Result |
|---|---|
| `inversion_floor_probe.mts` (EVAL05 honesty floor, current contract) | **7/7 PASS** — claim-without-artifact caught, false-completion backstop catves "Filed", malformed/outage/502 → honest fallback, no impersonation. |
| `inversion_fabrication_floor_probe.mts` (EVAL12 inverse — over-strip) | **3/4 — DEFECT.** Verbatim scope kept (A). Reordered scope kept (C). Truly-invented scope stripped (D, correct). **Faithful paraphrase that adds one clarifier token ("HVAC"/"conversion") → entire scope line stripped + flagged `unsupported_scope` (B).** |

## Lane B — live (`claude-haiku-4-5`, temp 0), frontier-judged

| Eval | Verdict | Finding |
|---|---|---|
| **OKONKWO (decisive)** | **FAIL** | Reply itself clean (1 question, no slot-asks, `claims_durable_action=false`, identity → open_items). But the model's ADU scope line — *"Garage ADU conversion: ~400 sqft, rough plumbing for kitchenette, mini-split HVAC"* — was stripped by the fabrication floor and flagged `unsupported_scope`. Persisted scope keeps the bath, **drops the ADU, kitchenette, mini-split** (3/6 scope keywords). |
| EVAL01 GOLD kitchen paragraph | FAIL | Reply slot-asks *"need client name, address, and timeline?"* + `next_question` repeats *"Client name and project address?"* — two slot/schema questions before a draft exists; no consequence-ranked (footprint) question. Flooring scope also stripped (paraphrase "1000 SF / install / approximately"). |
| EVAL01 Chen-embedded | FAIL (partial credit) | ✅ Does **not** re-ask the client name (heard "Chen"). ❌ But slot-asks budget/timeline before a draft; flooring scope stripped again. |

## Root cause (airtight, model-independent)

`hasSourceSupport` (modelReplyResolver.ts) requires **every** meaningful token (len≥4, non-stopword) of a scope/allowance line to appear verbatim in the operator corpus, and **every** number to match exactly. A live reply brain paraphrases ("HVAC", "conversion", "install", "approximately"); a single foreign token drops the **whole line** and mislabels it `unsupported_*`. This is the opposite of the floor's intent — it deletes *real* operator scope, not invented scope.

The route's deterministic seed (`deriveWorkingDraftFields`) does **not** recover it: for the Okonkwo text the seed extracts only `["bath remodel","flooring"]`, sets `archetypeHint: bath_refresh` and `projectName: "Okonkwo bath remodel"` — it never sees the ADU. Floor strip + blind backstop ⇒ ADU lost end-to-end.

**Why the PR's own Okonkwo test is green anyway:** its stub returns scope strings that are exact verbatim substrings of the operator text. The test never exercises paraphrase, so it cannot catch this. Against any real model it fails.

## What passes (credit where due)
- Honesty floor is solid: no false "filed/saved/sent" leaks; `claims_durable_action` correctly false in every live turn; malformed/outage → humble fallback.
- Client-name re-ask is correctly suppressed (half the inversion works).
- Identity/logistics correctly parked in `open_items` in the structured draft.

## Required to flip to MERGE
1. **Fabrication floor must not strip faithful paraphrase.** Support should be evidence-based (e.g. require numeric exactness + majority-token overlap, or anchor on the distinctive nouns/numbers actually present) rather than all-token-verbatim. Re-run `inversion_fabrication_floor_probe.mts` → 4/4. Case B must be kept; Case D must still strip.
2. **Re-run live OKONKWO** → ADU + kitchenette + mini-split present in persisted scope; ≤1 question; identity in open_items.
3. **Add a paraphrase-mode test** to `right-hand-model-turn-resolver.test.ts` (model returns scope that is faithful-but-not-verbatim) so the regression is locked, not stubbed away.
4. (Secondary, reply-brain tuning) GOLD paragraph should produce draft posture + the single footprint question, not budget/address/timeline slot-asks.

## Harness files (this dispatch)
- `inversion_floor_probe.mts` — Lane A honesty floor (EVAL05), 7/7.
- `inversion_fabrication_floor_probe.mts` — Lane A EVAL12 over-strip, exposes the defect deterministically.
- `inversion_live_eval.mts` — Lane B live conversational (OKONKWO + EVAL01 ×2), reply brain + frontier judge.
