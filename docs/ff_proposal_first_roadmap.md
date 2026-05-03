# Proposal-First F&F Roadmap

Status: planning · Aligned with `main` after [#69](https://github.com/GGRValle/kerf-app/pull/69) (F&F core path doc) and [#70](https://github.com/GGRValle/kerf-app/pull/70) (proposal-first queue ordering).

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
- Captured proof packet at
  [`src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md`](../src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md)
  documents the W1 close.

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

- **Proposal detail / review panel.** Clicking a proposal card opens a
  fuller surface where the operator reads the proposal in context, sees
  the drafted follow-up, and edits or approves.
- **Proposal operator action persistence.** PR #58 added operator
  decision event templates; the proposal flow needs to actually persist
  approve/edit/reject decisions so the audit chain reflects real
  operator activity, not just demo-mode logs.
- **Live-ish proposal read surface, or seeded realistic data.** Either a
  stubbed adapter for a Platform-side proposal source, or seeded
  fixtures with enough variety (sent / viewed / near-expiry /
  change-requested) to carry a 5-minute demo.
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

Two-to-three weeks, ordered so each PR makes the proposal loop more
usable than the last:

1. **Proposal detail / review panel.** New screen/route from a proposal
   card click. Full proposal context, drafted follow-up, operator
   action affordances. Keeps the workflow-aware copy chain.
2. **Proposal action audit persistence.** Wire
   `applyProposalFollowupApprovalAction` results through PR #58's
   operator-decision-event-template path into the Blackboard event log.
   Operator clicks approve → `proposal_followup.approved` event lands
   and persists across reload.
3. **Proposal read surface adapter stub.** Replace seeded fixtures with
   a stubbed adapter that reads from a Platform-side proposals
   endpoint (or local mock matching the contract). Gate / wall / UI
   unchanged; data source swapped at the boundary.
4. **Hosted demo shell.** Static-site or single-server deployment
   target with read-only single-tenant gating. F&F recipient gets a
   URL, not a clone instruction.
5. **F&F evidence packet.** Same shape as the W1 proof packet, scoped
   to the proposal loop: smoke output for proposal gate flow, audit
   chain screenshots, F&F click script.

After this sequence, the F&F pitch has a usable proposal loop with
captured evidence. Nice-to-haves can land in parallel or after,
prioritized by demo feedback.
