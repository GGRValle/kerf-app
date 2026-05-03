# W1 Close Note — Monday Demo Prep

Status: practical demo prep · Aligned with `main` after [#75](https://github.com/GGRValle/kerf-app/pull/75).

## What the W1 demo proves

**One Policy Gate. One audit path. One UI surface. Three workflows.**

- **invoice_followup** — past-due invoice → AltitudePacket → Policy Gate →
  DecisionPacket → operator approval/rejection → Blackboard audit chain.
- **proposal_followup** — viewed-but-undecided proposal → same path; same
  validator wall; same approval semantics.
- **drift_detection** — operational drift signal → same path, but autonomous
  internal-summary track (no external send, no money mutation, drift-specific
  action labels).

All three workflows pass through the same nine-validator wall (V1, V2, V6, V7,
V8, V9, V12, V17, V18) in canonical order. V9 emits learning-signal drafts
when the model diverges, V8 corrects, or V7 blocks; the smoke harness commits
those drafts as `learning_signal.drafted` events. The audit chain proves causal
ordering across detected → drafted → approval_requested → approved/rejected.

The browser-local Standard UI demo renders all three workflows in a single
DecisionQueue. Operator-facing copy is workflow-aware at every layer:

- **Buttons** — `Approve / Reject / Edit` for invoice + proposal; `Acknowledge
  / False positive / Act` for drift.
- **Reason form** — opens with `Reject reason` for invoice/proposal; `False
  positive reason` for drift.
- **Action log** — records `approve / reject / edit` for invoice/proposal;
  `acknowledge / false_positive / act` for drift.
- **Operator summary (#66)** — workflow-aware "Next step" headline above each
  card. See [`docs/product/decision_card_operator_copy_rules.md`](./product/decision_card_operator_copy_rules.md)
  for the canonical copy table.

## F&F Core Path

For Friends-and-Family fundraising and the first paying-tenant
conversations, **proposal follow-up is the lead revenue path.** Contractors
close more dollars when proposals get reviewed and sent faster; that's the
primary unlock the demo should anchor on. The architectural parity above
(one gate, three workflows) is real and provable; the commercial pitch
order is not parity.

The F&F core path:

```
Proposal review / follow-up
  → operator approve / edit / reject (workflow-aware operator summary)
  → audit event chain
     (proposal_followup.detected → drafted → approval_requested → approved/rejected)
  → future: send tracking + client reply attribution (W2+)
```

Invoice follow-up and drift detection are **supporting loops** that prove
the gate generalizes:

- **invoice_followup** — cash recovery on already-billed work. Operational
  hygiene; not the lead revenue unlock for new contractor adoption.
- **drift_detection** — operational excellence (stalled commitments,
  near-deadline permits, callback promises). Demonstrates the gate handles
  internal-only autonomous workflows; not a sales lead.

**Pitch order for the demo.** Lead with the seeded proposal read surface:
the All queue now opens proposal-first, with four eligible proposal
follow-ups generated from realistic seeded proposal records. Walk through
the first proposal card and its review panel, then move to invoice and
drift as proof the same gate / wall / UI handles different workflow
shapes. Don't open the demo with the invoice card.

**W2 prioritization implication.** Proposal-flow enhancements lead the next
cycle. Since #72, #73, and #74 already landed the detail panel,
browser-local operator decision audit rows, and seeded proposal read
surface, the remaining core path is durable proposal action persistence,
a live-ish proposal read adapter boundary, send tracking, and client
reply attribution. Invoice and drift get hardening and edge-case
coverage, not new feature surface, until proposal lifecycle persistence
ships.

## Demo path (what to run on Monday)

```bash
cd ~/code/kerf-app
git switch main && git pull --ff-only
npm install
npm run typecheck
npm test
npm run demo:w1-queue
npm run smoke 2>&1 | tee /tmp/kerf-w1-smoke-output.txt
npm run build
npm run test-fixtures:validate
git diff --check
open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"
```

Detailed runbook + click script: [`src/examples/README.md`](../src/examples/README.md).

Acceptance-test mapping: [`src/examples/W1_ACCEPTANCE_EVIDENCE.md`](../src/examples/W1_ACCEPTANCE_EVIDENCE.md).

Captured proof packet (gate output, smoke excerpts, screenshots):
[`src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md`](../src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md).

## Do not regress

The following invariants are load-bearing for the Monday demo and W2+ work.
Future PRs that violate any of these must explain why in the PR body and
update this list (and the runtime contract) in the same change.

- [ ] **No raw validator IDs in card headline or summary.** "V2", "V18",
      "AT-019", and reason codes (`external_send_approval_missing`,
      `source_basis_required`, etc.) stay inside the audit disclosure. The
      operator-summary headline uses plain English.
- [ ] **No model suggestion shown as authoritative UI.**
      `model_suggested_altitude`, `model_suggested_blackboard_rail`, and
      `divergenceClass` are audit context only. The card renders the
      authoritative `system_final_altitude` / `system_final_blackboard_rail`
      as the verdict.
- [ ] **Drift action labels stay `Acknowledge / False positive / Act`.**
      Invoice and proposal cards stay `Approve / Reject / Edit`. The trio is
      workflow-aware end-to-end (button label, reject-reason form copy,
      action-log verb).
- [ ] **Learning signals stay in the audit disclosure.** V9 drafts surface
      under the collapsed `<details>` panel, never as a top-level card field
      or as part of `operatorSummary`. Learning signals are system-improvement
      signals, not operator decisions.
- [ ] **Source-basis-block copy stays distinct from approval-block copy.**
      V7 (data problem) headline pattern: *"Can't verify {entity}: source
      data missing"*. V2 (approval problem) headline: *"Needs approval to
      send"*. Operators must be able to tell the two apart at a glance.
- [ ] **Workflow-aware copy ships at every layer simultaneously.** Adding a
      new workflow type means updating button labels, reason form copy,
      action log verbs, AND `buildOperatorSummary()` — all in one PR. Don't
      land partial workflow-aware support.
- [ ] **The validator order in `validator_results` stays canonical.**
      `V1 → V2 → V6 → V7 → V8 → V9 → V12 → V17 → V18`. V12's audit-trail
      check enforces this in tests; downstream consumers (V9 draft producers,
      audit chain readers) depend on it.
- [ ] **Money displays in dollars at the operator surface; cents in audit.**
      `formatCents()` formats at the headline; raw `amount_cents` stays in
      `extracted_facts` and the audit panel.

If you're adding a new gate outcome, validator, or workflow — read
[`docs/product/decision_card_operator_copy_rules.md`](./product/decision_card_operator_copy_rules.md)
first.
