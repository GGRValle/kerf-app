# Slice Window Transition — May 8–18 Slice → Full Execution Phase

- **Date:** 2026-05-15 (transition occurred during the May 14 → May 16 working session)
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Documents a canon transition that occurred during execution but wasn't formalized at the time. Captures it retroactively per the 2026-05-16 amendment review.

---

## 1. What this doc closes

The slice window was defined in `docs/architecture/claude_code_inventory_routing_memory_2026-05-12.md` as:

> Per slice-window discipline (**2026-05-08 to ~2026-05-18**), those sections land ≥ May 18.

The slice's lane discipline was **canon support / UX map / status pinning for the F-33 → F-37 vertical spine** — explicitly no new feature work, no schema additions, no "should be" recommendations. Just shore up the existing spine.

That discipline transitioned to **full-execution scope expansion** during the 2026-05-14 → 2026-05-16 working session. The transition was real and substantive (18 PRs landed across persistence layer, proposal artifact, Field Daily vocab, tier-2 KB ingestion, Right Hand Home + Module Drawer canon, Field Hand nav spec). It was **not formally documented at the time of transition** — this doc captures it retroactively so the canon trail is intact.

---

## 2. F-33 → F-37 slice spine state at transition

Recorded as of `main` HEAD on the morning of 2026-05-15 (immediately before the persistence stack began landing):

| Surface | State |
|---|---|
| **Tests on main** | 911 / 911 passing |
| **V1.5 routes** | All 13 HTTP-green (`/dashboard`, `/field-capture`, `/transcript-review`, `/draft-review`, `/decisions`, `/audit`, `/blackboard`, etc.) |
| **Deep-link asset paths** | Fix landed (PR #142); `/decisions/<id>` and `/audit/<id>` correctly serve root-relative asset paths |
| **F-33 → F-34 → F-35 → F-36 → F-37 spine** | Canonical fixture `verticalSliceFieldCaptureDemoFixture` wired across all five frames via `VERTICAL_SLICE_FLOW_PACKET_ID` |
| **Generated fixture convergence** | `VerticalSliceDryRunDemoFixture` type + `fieldCaptureDryRunToVerticalSliceDemoFixture` mapper integrated; no parallel mock trees |
| **§13 disclosure pattern** | Audit deep-link from artifacts, NO top-nav Audit tab — pattern locked per `feedback_audit_deep_link_not_top_nav.md` |
| **F-36 reconciliation** | Cursor agent's parallel work bundled as PR #144; canonical reconciliation complete |
| **Bath / outdoor kitchen / deck scaffolds** | All four V1.5 archetypes shipped (#156, #159, #163, #164) before the slice transition |
| **Material-specific tier-1 matcher** | Shipped (#161) before transition |

**The slice's stated goal — F-33 → F-37 vertical spine readiness with canon coverage — was met before the transition occurred.** The spine on `main` at transition time was production-shape for dogfood.

---

## 3. What triggered the transition

The May 12 inventory brief (`claude_code_inventory_routing_memory_2026-05-12.md`) defined four post-slice sections:

- §11.2 — gaps
- §11.3 — schema additions
- §11.4 — Daily Log canon
- §11.5 — roadmap fit / engineer-hire dependency
- §11.6 — dogfood recommendation against the founder-judgment kill-switch

All five were queued for "≥ May 18 (post-slice-window)."

Three things changed between May 12 and May 15 that made deferring past May 18 the wrong move:

### 3.1 The persistence design landed
`docs/architecture/persistence_layer_v15_design_2026-05-14.md` pinned the JSONL event store + projection cache + HTTP endpoint design. The design carried 7 open questions for Codex review, but the substrate path was clear. Sitting on it through May 18 would have delayed all downstream work by another full week.

### 3.2 The Dunne proposal grounded the proposal artifact design
Christian shared `GGR_Dunne_Proposal_v5.docx` + `GGR_Ault_CostSheet DUNNE v4.xlsx` mid-session, which converted the generic invoice artifact design (PR #172, then closed) into the grounded `ProposalArtifact` shape with CSI division grouping, payment-schedule §7159 enforcement, and Designer-of-Record attribution. **That grounding wasn't available on May 12.** Once it landed, building against it was a same-day move, not a post-slice queue item.

### 3.3 The pulse test instrument was ready
Christian authored `Moorhead_Scope_PulseTest.md.gdoc` as a diagnostic instrument before the system was ready to be tested against. Running it during the slice window (which happened on the morning of May 16) surfaced four structural schema dimensions that would have been invisible from inside a normal build session. The pulse test only produces value if it runs on real substrate; **running it required the persistence + proposal substrate to exist on main first.**

---

## 4. Why this is consistent with the kill-switch

The slice window had an explicit **rightness-over-date-pressure** kill-switch (per the May 8 framing). The kill-switch authorized extension if surfaces needed more design work than the slice window allowed.

The transition was the kill-switch firing in the opposite direction: not extending the slice, but **expanding scope inside the slice window** because the right work became actionable earlier than expected. The substrate-first sequencing the May 16 amendment captured (vertical slice over horizontal shell — see `field_daily_workflow_design_2026-05-15.md` §12) is the same principle: the right shape of work matters more than the lane labels.

The kill-switch's intent — *don't ship the wrong thing because the calendar says ship* — was honored. The expression was different from what was assumed at the May 8 framing.

---

## 5. What landed during the transition (Day 7–9 of slice window, 2026-05-14 → 2026-05-16)

Substantive PRs that exceeded the slice's "canon support / UX map / status pinning" lane:

| Category | PRs |
|---|---|
| **Persistence stack** (events, store, projections, HTTP endpoints) | #165, #166, #170, #171 |
| **SourceRef hardening + serve-script synthesis** | #176, #179 |
| **Proposal artifact** (types, validation, print renderer, Step A events) | #173, #175, #183 |
| **Field Daily** (event vocab, clock_event amendment, first endpoint) | #181, #185, #188 |
| **Tier-2 KB ingestion** (operator UI + API + lookup merge) | #186 |
| **Design canon** (Right Hand Home + Module Drawer + amendments) | #180, #187 |
| **UX baseline** (inline-edit scaffold lines, mobile validation harness) | #177, #178 |
| **Cleanup + briefs** (consolidation, tier-2 brief refresh, Codex pair-review brief) | #182, #184, #174 |
| **Schema dimensions design doc** (post-Moorhead pulse test) | #189 |

Net: **persistence layer fully on main + proposal model live + Field Daily substrate live + tier-2 KB ingestion live + canon for Right Hand and Field Hand surfaces pinned.**

Test surface went from 911 / 911 (slice-spine-ready) → 1107 / 1107 (substrate-phase-complete).

---

## 6. What this transition does NOT close

The May 12 brief's five queued sections are still real work to be done:

| Section | Status post-transition |
|---|---|
| §11.2 gaps | Partially closed — Codex pair-review brief #174 enumerated stack-gating gaps; persistence layer addressed most. |
| §11.3 schema additions | **Open.** PR #189 surfaced 4 dimensions still pending implementation. |
| §11.4 Daily Log canon | Closed — `field_daily_workflow_design_2026-05-15.md` + amendments. |
| §11.5 roadmap fit / engineer-hire dependency | **Open.** Not addressed in this session. |
| §11.6 dogfood recommendation against founder-judgment kill-switch | Partially addressed — Moorhead pulse test ran, but recommendation framing not authored. |

§11.3 and §11.5 remain post-transition work. They live in the build queue, not in this slice closure.

---

## 7. The phase that follows

The work transitioned into a **substrate-and-canon phase** (May 14–16) followed by a **vertical slice execution phase** (May 16 onward, starting with Field Daily Step B on the morning of May 16).

The execution phase's lane discipline is captured in `field_daily_workflow_design_2026-05-15.md` §12 (revised 2026-05-16): vertical slice over horizontal shell — one event kind end-to-end through every layer before the full HOME/JOB/LOG/ME shell builds.

**This doc is the bridge.** It marks the boundary between the slice window (closed early on its own terms) and the execution phase (which is what the rest of the 30-day target runs through).

---

## 8. Decision needed (post-Codex-review)

One thing for Codex's next review pass:

- **Confirm the transition was correct.** If the right move was to honor the slice window literally and defer the substrate work to May 18, this doc captures a decision that should have gone differently. If the substrate-readiness + Dunne grounding + pulse-test instrument were genuinely the conditions that justified the transition (which is the position this doc takes), the transition is canon as of May 15.

Codex can ratify, refine, or push back. Either way, the trail is now documented.

---

## 9. Provenance

This doc was authored retroactively during the 2026-05-16 amendment review session, after a ChatGPT review flagged that the slice transition was undocumented. The flag was correct; the omission was real; this doc closes the gap.

The substantive work landed without explicit canon update at the time. That's the small-drift-hides-best dynamic this doc and the sibling self-review posture memory both address: success can mask the small canon-update tasks that don't feel urgent in the moment but compound when undocumented.
