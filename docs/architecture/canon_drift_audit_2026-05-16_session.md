# Cross-PR canon-drift audit — 2026-05-16 session

**Audit ran:** 2026-05-16 evening (end of session)
**Scope:** ~25 PRs across the V1.5 vertical-slice window, with focus on the Step B substrate landed in this session (PRs #188–#197).
**Posture:** per `cross_pr_canon_drift_audit_posture_2026-05-16.md` (PR #192) — >5 PRs in a session triggers an audit before close.
**Triggered by:** 5 new PRs in this session (#193, #194, #195, #196, #197) on top of the standing PR #192 threshold, plus an external reviewer flag that "Henderson severity block in dispatch vs warn in master brief" might be drift.

---

## TL;DR

**Three drift items found. All in design docs. Substrate code is the truth — design docs needed to catch up.**

| # | Item | Severity | Resolution |
|---|---|---|---|
| 1 | Master brief predicts Henderson drift severity `warn`; B.3 classifier emits `block` | **Material** — would cause a B.7 test write to fail if a reader followed the brief verbatim | Amended brief inline + B.7 commit message explains the canon-correct outcome |
| 2 | `field_daily_workflow_design_2026-05-15.md` §3 + §8 + brief §3 say "Track A drift validator already in `src/altitude/gate.ts`" — that validator doesn't exist with the claimed shape | **Material** — would mislead any future reader trying to thread Field Daily into Track A | §3 + §8 amended inline; brief amended inline |
| 3 | New `/field` route in B.4 brief vs existing `/field-capture` route in v15-vertical-slice router | **Minor** — risk of accidental collision | Already flagged in PR #196's Cursor brief as a `# Critical context` block. No further action needed. |

**No drift found in:**
- HOME/JOB/LOG/ME canon (consistent across design doc + briefs + two-gate doc after PR #181 + #187)
- `business_unit_margin_pct` tenant-vs-platform marking (correctly tenant-owned everywhere since PR #189 + #190)
- §13 disclosure pattern (consistent across right_hand_home_module_drawer_2026-05-15.md and Field Daily design)
- SourceRef URI scheme (kerf://daily-log/, kerf://voice-intake/ — consistent)
- Voice canon dependency block (correctly fenced in design doc + B.4-B.6 brief)

---

## Drift #1 — Henderson severity `warn` → `block`

**Files affected (before amendment):**
- `docs/agent-briefs/field-daily-step-b-vertical-slice-2026-05-16.md:252` — said "Run drift adapter → assert drift fires (severity `warn`)"

**Truth (from substrate):**
- `src/persistence/driftAdapter.ts` precedence rules (PR #195): when `schedule_status === 'behind'` AND (`money_risk_flags` non-empty OR `scope_change_flags` non-empty), severity is `block` (the stricter office-side stop). Henderson fires all three: behind + galvanized + scope expansion.
- `tests/e2e-field-daily-henderson.test.ts` (PR #197) locks `severity === 'block'` with an explicit comment block explaining the precedence rule.

**Why this is the correct outcome — NOT a regression to fix:**
Henderson is exactly the case where office-side should NOT send a CO until owner has reviewed. Galvanized + scope expansion + schedule slip → block. The master brief's `warn` prediction was conservative; the substrate is right, and B.7's lock formalizes it.

**Remediation:**
This PR amends the brief inline with an `[AMENDED 2026-05-16 by canon-drift audit]` callout pointing at PR #195 and #197 as the canonical source. The substrate is unchanged.

---

## Drift #2 — "Track A drift validator already in src/altitude/gate.ts"

**Files affected (before amendment):**
- `docs/architecture/field_daily_workflow_design_2026-05-15.md` §3 (table row 130, lines 245, 431)
- `docs/agent-briefs/field-daily-step-b-vertical-slice-2026-05-16.md:75` (substrate table) + line 167 (B.3 task scope)

**Truth (from substrate):**
- `src/altitude/gate.ts` is the W1 Policy Gate. Its validators are V1 (pricing source class), V2 (external send approval), V4 (recording consent), V6 (role redaction), V7 (source basis), V8 (model inference labeling), V17 (token budget), V18 (altitude assignment). **None of these is a drift validator.** No function takes `DailyLogExtractedFacts` (or anything close) as input.
- `src/workflows/drift-detection.ts` IS a drift module — but it operates on `LlmDriftCandidate` shapes from a frontier-tier LLM, uses a different severity vocab (`low|medium|high|critical`), and goes through `assembleDriftAlert` → `driftAlertToAltitudePacket` → `runPolicyGate`. **Structurally incompatible with the deterministic facts → drift_detected path.**

**What B.3 did about it:**
Took the Step B brief's own escape hatch:
> *"If the Track A validator doesn't expose a clean input shape, that's a precursor fix (small PR against Track A), not a duplication."*

Built `src/persistence/driftAdapter.ts` as a Field-Daily-specific deterministic classifier. **No W3 LLM logic reimplemented.** Documented the seam in the file's header comment so a future PR can lift the rule table into a unified Track A validator if/when one is built.

**Why the design docs got this wrong:**
The Field Daily design (2026-05-15) was written before the actual code path was attempted. The author reasonably assumed that "Track A drift detection" had a callable validator function. It does not; W3's drift detection is a full LLM pipeline + altitude gate, not a primitive. The brief's escape hatch was the right safety valve.

**Remediation:**
This PR amends §3 (table row), §8 (full subsection with the original plan kept for context + "Amended approach" below), and the brief's substrate table inline. The substrate is unchanged.

---

## Drift #3 — `/field` vs `/field-capture` route collision

**Files affected:**
- `docs/architecture/field_daily_workflow_design_2026-05-15.md` §7 (`/field` capture surface)
- `docs/agent-briefs/field-daily-step-b-vertical-slice-2026-05-16.md` §B.4 (also `/field`)
- `src/examples/v15-vertical-slice/router.ts:25` — existing `/field-capture` route for the proposal-first scaffold flow

**Risk:**
If a future Cursor agent reads the design doc and assumes `/field` should be added to the router alongside `/field-capture`, the two surfaces could end up sharing handlers or being confused for variants of one another. They are not the same — one is voice-capture-for-Daily-Log; the other is the proposal-first scaffold review.

**Resolution status:**
Already flagged in PR #196's Cursor brief under "Critical context" point #4:
> *"There is an existing `/field-capture` route in `src/examples/v15-vertical-slice/router.ts` that serves the proposal-first scaffold flow. The new B.4 route is a different surface — daily log entry capture, not proposal capture. Use a distinct route: `/field` (no `-capture` suffix) to keep these separate. Same pattern for `/relay`."*

**No further action needed.** Cursor will be reading PR #196 verbatim before building B.4.

---

## Substrate health summary

After this session's substrate work (PR #193–#197), the Field Daily Step B substrate is:

- **`src/persistence/fieldCapture.ts`** (PR #193) — play handler, pure function, propagates tenant/correlation/actor/entry_id, synthesizes source_refs per PR #176 rule
- **`src/persistence/dailyLogExtractor.ts`** (PR #194) — deterministic 9-fact extractor, locked against Henderson golden across 5 categories + 18 variant transcripts
- **`src/persistence/driftAdapter.ts`** (PR #195) — deterministic classifier (info/caution/warn/block) with explicit precedence, source_refs carry-through
- **`tests/e2e-field-daily-henderson.test.ts`** (PR #197) — full-chain integration lock; catches any drift between B.1+B.2+B.3 contracts

All four PRs share the **forbidden-surface invariant**: no LLM imports, no `fetch(`, no `process.env.*` secret reads, in both source files and tests.

**Test suite:** 1174/1174 with all 4 substrate PRs stacked (vs 1107 base + 67 added).

---

## Open follow-ups (NOT in this audit's scope)

- **B.4 + B.5 + B.6** — Cursor dispatched on PR #196's brief; will land as 3 PRs
- **B.7 phase 2** — extend `tests/e2e-field-daily-henderson.test.ts` to add the HTTP-level review flow (`POST /api/relay-cards/<id>/review`) once B.6 lands
- **Wiring play scheduler** — currently the daily-log entries endpoint emits `daily_log.entry_captured` but does NOT invoke the play handler automatically. Step C wires this so the substrate runs end-to-end without manual handler calls
- **Track A validator unification** — optional precursor PR if/when the time is right; B.3's rule table is small enough to lift directly

---

## Process note for future audits

This audit took ~25 minutes from "I'll do the audit" to "audit + amendments committed." The cost is small. The benefit is real: the next reader of the Field Daily design doc won't believe that `src/altitude/gate.ts` has a drift validator that takes facts as input. That hour saved is the audit's payoff.

**Per PR #192's posture:** audit triggers fire automatically at >5 PRs/session. This session shipped 5 new PRs (above the threshold) AND inherited 20+ prior PRs from the slice window. The audit is overdue across the slice as a whole; this audit covers Step B specifically. A wider slice-window audit is a candidate for a separate follow-up if the cross-PR drift surface (e.g., proposal artifact, tier-2 KB ingestion, Right Hand canon) needs another pass.
