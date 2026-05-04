# Proposal-First F&F Roadmap

Status: active roadmap · Aligned with `main` after [#75](https://github.com/GGRValle/kerf-app/pull/75) (seeded proposal queue polish).

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
- Proposal detail / review panel is landed.
- Browser demo actions append in-memory `decision.resolved` audit rows using
  the typed operator-decision event-template contract; proposal approve/reject
  also append the matching proposal workflow event in the same EventLog path.
- Seeded proposal read surface is landed: five realistic proposal records
  produce four eligible proposal follow-up DecisionPackets through the real
  detect -> draft -> AltitudePacket -> Policy Gate path.
- The seeded proposal read surface now reads through a local
  `ProposalReadSurfaceAdapter` boundary, so the seed can be swapped for a
  Platform read source without changing the gate or UI.
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

## Landed Since This Roadmap Was Drafted

- **Proposal detail / review panel (#72).** Clicking a proposal card opens a
  fuller surface where the operator reads the proposal in context, sees
  the drafted follow-up, and edits or approves.
- **Demo operator decision audit rows (#73).** Browser actions now append
  in-memory `decision.resolved` rows using the same typed
  operator-decision event-template path that production persistence will
  wire durably.
- **Seeded proposal read surface (#74).** The W1 demo proposal slice now
  starts from seeded `ProposalFollowupFacts` with sent, viewed,
  near-expiry, and change-requested records, then runs the real proposal
  workflow and Policy Gate.
- **Seeded proposal scanability polish (#75).** The queue calls out the
  12-card seeded mix and adds demo-only visual rhythm for the four seeded
  proposal cards.

## Required before F&F

- **Cross-restart proposal operator action storage.** The browser demo now
  commits proposal operator decisions and proposal workflow outcomes to the
  in-memory EventLog. Remaining work is a storage-backed EventLog so
  approve/edit/reject survives reload and can be used as F&F evidence.
- **Platform-backed proposal read adapter implementation.** The demo has a
  local/no-network adapter boundary. Remaining work is implementing a
  Platform-backed adapter on the other side of that boundary, then swapping
  data sources without changing the gate or UI.
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

1. **Proposal detail / review panel.** Landed in
   [#72](https://github.com/GGRValle/kerf-app/pull/72). New screen/route from a proposal
   card click. Full proposal context, drafted follow-up, operator
   action affordances. Keeps the workflow-aware copy chain.
2. **Proposal action audit persistence.** Advanced beyond
   [#73](https://github.com/GGRValle/kerf-app/pull/73): browser actions
   append in-memory `decision.resolved` rows using the typed
   event-template contract, and proposal approve/reject now append the
   matching proposal workflow outcome event. Remaining work is
   storage-backed persistence across reload.
3. **Proposal read surface adapter stub.** Advanced beyond #74: seeded
   realistic proposal data feeds the demo through the real workflow and
   gate, and the read surface now has a local/no-network adapter boundary.
   Remaining work is a Platform-backed adapter implementation that can
   swap in at the boundary.

   Historical context: partially landed in
   [#74](https://github.com/GGRValle/kerf-app/pull/74): seeded realistic
   proposal data first fed the demo through the real workflow and gate.
4. **Hosted demo shell.** Static-site or single-server deployment
   target with read-only single-tenant gating. F&F recipient gets a
   URL, not a clone instruction.
5. **F&F evidence packet (drafted).** Same shape as the W1 proof packet, scoped
   to the proposal loop: `npm run smoke:proposal-ff` stdout capture, golden
   proof JSON, approve/reject + JSONL reopen durability, browser click-script
   placeholders, and screenshot placeholders — see
   [`src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](../src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md).
   Operator still replaces `smoke_output.txt` via `tee` and fills screenshots
   before treating the packet as distribution-locked.

After this sequence, the F&F pitch has a usable proposal loop with
captured evidence. Nice-to-haves can land in parallel or after,
prioritized by demo feedback.
