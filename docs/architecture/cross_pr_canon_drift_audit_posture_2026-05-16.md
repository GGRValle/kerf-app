# Cross-PR Canon-Drift Audit Posture

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Permanent operational posture. Promoted from a one-pager to permanent canon per the 2026-05-16 amendment-review recommendation. Applies to every working session on `GGRValle/kerf-app` going forward.

---

## 1. The rule (one sentence)

**High-velocity sessions (>5 PRs in one push) trigger a cross-PR canon-drift audit before the worker sleeps or wraps the session.**

This is a check, not a note. The audit happens, is documented, and lands as part of the session's deliverable.

---

## 2. Why this exists

The 2026-05-15 → 2026-05-16 session shipped 20 PRs in roughly 22 hours. Per-PR self-review held — every PR had a verification gate, a test plan, a "what could break" field. **What did NOT hold was cross-PR audit.** The drift that the 2026-05-16 amendment review caught (slice transition undocumented, June 13 milestone unfounded, HOME/JOB/LOG/ME canon conflict half-resolved, business_unit margin tenant-leakage in design doc) didn't slip past any individual PR review. **It slipped past the absence of a review that compared multiple PRs against each other.**

The dynamic: success masks small canon drift. A session that ships 20 PRs with zero test regressions *feels* like a clean session. The depth of self-review per PR is held; the breadth of audit across PRs is not. Each PR looks fine in isolation; canon drifts in the spaces between them.

The reviewer's framing was sharp: *"the day felt successful — success masks the small things."* This posture is the operational fix.

---

## 3. When the audit fires

**Trigger threshold: >5 PRs in a single working session.**

A "working session" is a continuous block of work without a sleep/major-break boundary. The threshold is empirical — at ≤5 PRs, per-PR self-review carries the full review load. At >5 PRs, context per PR thins to the point where cross-PR conflicts slip past individual review.

Edge cases:
- 5 PRs is the boundary; ≥6 fires the audit
- Worker pauses for sleep → session ends; next session counts PRs independently
- "Continuation" sessions (resumed within ~4h) merge for the audit count
- Brief-only PRs count (the cost is review time, not code complexity)
- Cursor-dispatched PRs in parallel count toward the worker who dispatched

If in doubt, fire the audit. False positives cost ~10–15 min. False negatives cost a canon-drift PR like the ones the 2026-05-16 review caught.

---

## 4. What the audit checks

The audit is **not a re-review of each PR**. Per-PR review already happened. The audit checks the **spaces between PRs** — claims and design assumptions that span more than one PR.

### 4.1 Canon-doc cross-reference check

For each PR that referenced a canon doc:
- Did the PR's claims match what the canon doc actually says?
- Did any PR introduce a new canon claim (e.g., a date, a percentage, a milestone) without a canon doc backing it?
- Did multiple PRs reference the same canon doc with different interpretations?

Example caught by the 2026-05-16 review: PR #180 §8.1 introduced "June 13 internal release" with no canon doc; downstream PRs (#181, #185, #187) referenced "June 13" as if it were canon. The drift was that June 13 became canon-by-reference without ever being canon-by-decision.

### 4.2 Schema and type cross-pollution check

For each PR that touched type definitions or schema shape:
- Did a later PR add fields or values that contradict an earlier PR's design?
- Did any PR leak tenant-specific values into platform types? (the 2026-05-16 review's point #5)
- Did any PR introduce a closed enum where an open string was the right shape?

### 4.3 Acceptance-criteria propagation check

For each canon doc or design doc that established acceptance criteria:
- Do the downstream PRs honor those criteria?
- Did any PR silently relax a criterion (e.g., "approved-only" tightening rules that got loosened)?
- Did any PR introduce a verification trigger that another PR will need to honor but doesn't yet?

Example: the HOME tab smart-summary canon was established in PR #181 + #187. The Step B brief (PR #191) explicitly defers HOME tab build to Step D AND captures the verification trigger that Step D's PR must honor. **The trigger has to be carried forward in writing**, not held in the worker's head.

### 4.4 Vocabulary-and-naming drift check

For each PR that introduced or used canonical naming:
- "Right Hand" / "Field Hand" / "Chief of Staff" — naming canon consistent?
- "Proposal" vs "Invoice" vs "Estimate" — referent matches the type?
- "Slice" vs "Step" vs "Phase" — sequencing language consistent?

### 4.5 Cross-PR test surface check

For each PR that added tests:
- Do the tests collectively cover the cross-PR integration points?
- Did any PR add a test that another PR's change would break?
- Are golden fixtures (Dunne, Henderson) consistent across PRs that reference them?

---

## 5. How the audit is documented

The audit produces a short artifact at the end of the session. Shape:

```markdown
## Cross-PR canon-drift audit — <date> session

Session count: N PRs (#X, #Y, #Z, ...)

### Canon-doc cross-reference
- [findings or "none flagged"]

### Schema and type cross-pollution
- [findings or "none flagged"]

### Acceptance-criteria propagation
- [findings or "none flagged"]

### Vocabulary and naming drift
- [findings or "none flagged"]

### Cross-PR test surface
- [findings or "none flagged"]

### Findings → action
- [for each finding, a concrete follow-up: doc PR, schema PR, brief amendment, etc.]

### "None flagged" calibration check
- Sanity question: if the audit found nothing, was the audit done at the
  right depth, or did fatigue compress the review? If unsure, flag for
  fresh-eyes review next session.
```

The artifact lives either:
- Inline in the session's last commit message (for solo work)
- As a comment on the last PR of the session (for shared work)
- As a `.md` file in `docs/audits/<date>-cross-pr-audit.md` (for sessions with ≥10 PRs)

---

## 6. What the audit explicitly is NOT

- **Not a re-review of each PR individually.** Per-PR review already happened. This audit is the meta-level check.
- **Not a build task.** The audit takes ~10–15 minutes for a typical 6–10 PR session. ~20–30 minutes for a 15+ PR session. It's a checkpoint, not a project.
- **Not a celebration.** If the audit finds drift, that's the finding — it does not need to be balanced with "but the session was productive." The productivity is assumed; the audit is for the drift.
- **Not optional.** The trigger fires automatically at >5 PRs. The cost of skipping is the next session's amendment review.
- **Not a substitute for Codex pair-review.** When Codex returns, full pair-review of the substrate stays the higher-confidence check. The cross-PR audit is the in-session safety net.

---

## 7. The deeper principle

> *Big days are also when small drift hides best.*

This principle, stated in the 2026-05-16 closing reflection, is the operational truth this posture encodes. **Success doesn't expose canon drift; it conceals it.** The session that ships 20 PRs with zero regressions feels objectively good — and the feeling itself is what suppresses the cross-PR audit instinct. *I shipped a lot, the tests pass, what could I have missed?*

What you missed is in the spaces between the PRs. The undocumented transition. The implicit milestone. The half-resolved canon conflict. The tenant-leakage in a design doc that hasn't shipped to code yet but would have if implemented literally. Each is small. None would trip per-PR review. Each compounds.

The posture exists because the alternative is paying the cost in the next session's amendment review — which works (the 2026-05-16 review caught all four real drifts) but costs ~2 hours of cleanup against ~10 minutes of in-session audit. The audit is the cheaper version of the same correction.

---

## 8. Calibration over time

This is the first iteration of the posture. Future sessions will reveal whether:

- The >5 PRs trigger threshold is right (might tighten to >4 if drift surfaces below 5)
- The five audit dimensions are the right five (might add: external-dispatch-state drift, validator-coverage drift, test-fixture drift)
- The 10–15-minute audit budget is sustainable (might compress with practice)
- Solo audits catch the same things as paired audits (Codex pair-review when back will calibrate)

The posture document itself updates when calibration data accumulates. The next amendment to this file is itself a canon-trail entry.

---

## 9. Provenance

Authored during the 2026-05-16 working session, immediately after the amendment-review cleanup work (slice closure, two-gate decision, PR #189 amendment, Step B brief). Promoted from one-pager to permanent posture per the reviewer's recommendation:

> *Worth promoting the self-review discipline note from "one-pager" to a permanent posture memory: "high-velocity sessions (>5 PRs) trigger cross-PR canon-drift audit before sleep." That becomes a check, not a note.*

This file IS that check. It applies from this commit forward.

The principle "big days are also when small drift hides best" is the canon line worth preserving across all future sessions. It's the operational truth the posture encodes.
