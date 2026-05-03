# Proposal-First F&F Roadmap

Status: planning · Aligned with `main` after [#74](https://github.com/GGRValle/kerf-app/pull/74) (seeded proposal read surface). The roadmap is partially executed — three of the five originally suggested PRs have landed; live-ish proposal read adapter, hosted demo shell, and F&F evidence packet remain.

This note translates the F&F prioritization captured in
[`docs/w1_close_note.md`](./w1_close_note.md) into the next two-to-three weeks
of work. Goal: make the proposal review/follow-up loop usable for
Friends-and-Family demos and first paying-tenant conversations before
expanding breadth into invoice polish, drift polish, or new workflows.

## Current state

- One Policy Gate. One audit chain. One UI surface.
- Three workflows visible in the W1 mixed queue: `proposal_followup`,
  `invoice_followup`, `drift_detection`.
- Proposal-first queue ordering is landed.
- Operator summary, workflow-aware buttons / reason form / action log
  verbs are landed.
- **Proposal detail / review panel landed** ([#72](https://github.com/GGRValle/kerf-app/pull/72)).
- **Operator decision audit events landed** ([#73](https://github.com/GGRValle/kerf-app/pull/73)) —
  operator approve / edit / reject now persists to the Blackboard event log.
- **Seeded proposal read surface landed** ([#74](https://github.com/GGRValle/kerf-app/pull/74)) —
  the demo uses `seededMixedDecisionPacketListFixture`, 12 cards (4 seeded
  proposal + 4 invoice + 4 drift). Proposal-first F&F path is now seeded
  local data, not only synthetic scenario fixtures.
- Captured proof packet at
  [`src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md`](../src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md)
  documents the W1 close (13-card pre-seeded-data baseline; proof packet stays
  frozen as historical evidence).

## F&F core path

```
proposal detected / reviewed
  → drafted follow-up visible to operator (DecisionCard)
  → operator approve / edit / reject
  → audit event chain (proposal_followup.detected → drafted →
    approval_requested → approved / rejected)
  → future: send tracking + client reply attribution
```

The F&F pitch anchors here. Everything else either supports this loop or
doesn't matter for F&F.

## Required before F&F

- ✅ **Proposal detail / review panel** ([#72](https://github.com/GGRValle/kerf-app/pull/72)) —
  proposal cards now open a fuller review surface with the drafted
  follow-up, source basis, and operator action affordances.
- ✅ **Proposal operator action persistence** ([#73](https://github.com/GGRValle/kerf-app/pull/73)) —
  `applyProposalFollowupApprovalAction` results flow through PR #58's
  operator-decision-event-template path into the Blackboard event log.
  Operator clicks approve → `proposal_followup.approved` event lands and
  persists.
- 🟡 **Live-ish proposal read surface.** Seeded realistic proposal data
  landed in [#74](https://github.com/GGRValle/kerf-app/pull/74) —
  `seededMixedDecisionPacketListFixture` provides four seeded proposal
  scenarios (sent / viewed / near-expiry / change-requested) alongside
  invoice and drift fixtures. **Remaining:** stubbed adapter against a
  Platform-side proposals endpoint (or local mock matching the contract)
  so the data source is swappable at the boundary, not hardcoded fixtures.
- **Basic hosted/protected demo access.** A way for an F&F recipient to
  load the demo (read-only, single-tenant, gated by shared link or
  basic auth) without `git clone` + `npm run`.
- **Boring failure states.** Empty queue, loading skeleton, error
  banner. F&F demos can't 404 or blank-screen on a fresh tab.
- **Evidence capture for proposal action audit.** Same shape as the W1
  smoke proof packet, scoped to proposal: gate output on a proposal
  packet, audit chain showing approve/reject, screenshot of operator
  action persisting through reload.

## Nice-to-have after F&F

Real value, but not blocking the F&F pitch:

- Invoice card polish (richer source-of-truth display, action
  affordances).
- Drift disposition polish (per-disposition handling, recommended
  next-step copy variants).
- Reply attribution (client response to a sent proposal attributed back
  to the operator's approve action).
- Better queue sorting / scoring (rank by altitude × urgency ×
  staleness like the Layer-A decisions projection).
- Spanish localization polish (i18n keys are wired; operator surface
  needs Spanish parity).

## Explicit non-goals

Each of these would expand surface without advancing the proposal loop:

- Full proposal generation (vs. follow-up). F&F reads existing
  proposals; new authorship is W2.5+.
- Full CRM replacement. We are not the source of record for client
  data.
- Multi-tenant admin console. Single-tenant demo is enough.
- Autonomous external sends. Operator approval stays load-bearing;
  the gate's `block_external_send` is a feature, not a bug.
- Payment collection / billing. Out of scope.
- Broad workflow expansion (intake, voice tour, memory promotion,
  etc.). Drift and invoice already prove the gate generalizes; more
  workflows don't strengthen the F&F pitch.

## Suggested PR sequence

Originally five PRs, ordered so each makes the proposal loop more usable
than the last. Three landed since the roadmap was written; remaining are
steps 3 (partial), 4, and 5.

1. ✅ **Proposal detail / review panel** — [#72](https://github.com/GGRValle/kerf-app/pull/72).
2. ✅ **Proposal action audit persistence** — [#73](https://github.com/GGRValle/kerf-app/pull/73).
3. 🟡 **Proposal read surface adapter.** Seeded local data shipped in
   [#74](https://github.com/GGRValle/kerf-app/pull/74). **Remaining:**
   stubbed adapter against a Platform-side proposals endpoint (or local
   mock matching the contract). Gate / wall / UI unchanged; data source
   swapped at the boundary.
4. **Hosted demo shell.** Static-site or single-server deployment
   target with read-only single-tenant gating. F&F recipient gets a
   URL, not a clone instruction.
5. **F&F evidence packet.** Same shape as the W1 proof packet, scoped
   to the proposal loop: smoke output for proposal gate flow, audit
   chain screenshots, F&F click script.

After step 5, the F&F pitch has a usable proposal loop with captured
evidence. Nice-to-haves can land in parallel or after, prioritized by
demo feedback.
