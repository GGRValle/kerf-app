# W1 Demo Runbook

This runbook is the repeatable path for the Kerf W1 demo. It proves the current
safety spine and browser-visible operator surface from a fresh checkout.

For the acceptance-test evidence map, see
[`W1_ACCEPTANCE_EVIDENCE.md`](./W1_ACCEPTANCE_EVIDENCE.md). The runbook is the
demo procedure; the evidence ledger maps each W1 acceptance item to the tests,
smoke output, and browser artifacts that prove it.

## Verified Baseline

Last verified on **May 2, 2026** from `main` at:

```bash
382bf5f fix(demo): keep W1 card text readable in Safari (#62)
```

Expected green gate at this baseline:

```text
npm test -> 252/252
```

The browser demo is local-only. It uses generated DecisionPacket fixtures and
does not call QBO, Platform, Slack, Gmail, or any backend. The right-side action
log is browser-local demo evidence. Backend audit evidence comes from
`npm run smoke` and workflow tests.

This close baseline includes the W1 proof packet screenshots and the Safari
readability fix for file-open demos. The proof artifacts live under
[`evidence/2026-05-02-w1/`](./evidence/2026-05-02-w1/).

## Fresh Checkout Run

```bash
cd ~/code/kerf-app
git switch main
git pull --ff-only
npm install

npm run typecheck
npm test
npm run demo:w1-queue
npm run smoke
npm run build
npm run test-fixtures:validate
git diff --check
```

Expected outputs:

- `npm test` reports `252/252` passing tests.
- `npm run demo:w1-queue` builds
  `src/examples/w1-decision-queue-demo.bundle.js`.
- `npm run smoke` prints `invoice_followup_gate_loop` with an
  `altitude_packet`, `decision_packet`, `invoice_audit` event chain, and
  `learning_signal_audit` event chain (V9 drafts committed by the smoke
  harness as `learning_signal.drafted` events).
- `npm run test-fixtures:validate` prints `seed produced 4 events`.
- `git diff --check` prints nothing and exits cleanly.

## Open The Browser Demo

After `npm run demo:w1-queue`:

```bash
open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"
```

A regular browser such as Safari is preferred. If a chat preview or embedded
viewer opens a blank page, rebuild the bundle with `npm run demo:w1-queue` and
open the file directly in Safari.

## What Should Render

The W1 Standard UI demo should show:

- Top bar: `KERF`, `W1 · Decision surface`, and `Local only`.
- Main queue with 13 cards from `mixedDecisionPacketListFixture`.
- Filter buttons: All, Blocked, Owner Review, Invoice, Proposal, Drift.
- Right rail action log with Clear log and Reset demo controls.

Expected mixed queue summary:

| Metric | Expected |
|---|---:|
| Total | 13 |
| Allowed | 8 |
| Blocked | 5 |
| Owner review | 7 |
| Critical | 5 |

Workflow coverage:

| Workflow | Cards | Notes |
|---|---:|---|
| `invoice_followup` | 4 | Owner-review, V2 blocked, V7 blocked, V8 review. |
| `proposal_followup` | 5 | Owner-review, V2 blocked, V7 blocked, V8 review, near-expiry. |
| `drift_detection` | 4 | Internal-only cards with severity badges and drift-specific actions. |

## Audit / Model Details Disclosure

Each DecisionCard renders a collapsed `<details>` disclosure labeled
**Audit / model (non-authoritative)**. Expand it to see:

- **Suggested altitude** — the model's L0–L4 suggestion (audit-only;
  `system_final_altitude` is authoritative).
- **Source model** — which model produced the AltitudePacket
  (`qwen2.5-7b-instruct` for invoice/proposal; `claude-3.5-sonnet` for drift).
- **Validator order** — `V1 → V2 → V6 → V7 → V8 → V9 → V12 → V17 → V18`.
- **Learning signals** — V9 drafts listed by trigger when produced:
  - `model_inference_correction` — V8 corrected `model_inference_label` or
    `classification.confidence_band`.
  - `source_basis_required` — V7 critical-failed on missing source basis.
  - `altitude_divergence` — `model_suggested_altitude` diverged from
    `system_final_altitude`.

  An empty list is valid for packets where V9 found no triggers.

## Click Script

Use this script when recording evidence or rehearsing the Monday demo.

1. Start on **All**. Confirm the 13-card mixed queue and summary counts.
2. Click **Blocked**. Confirm blocked cards remain visually distinct.
3. Click **Owner Review**. Confirm external-send invoice/proposal cards appear.
4. Click **Drift**. Confirm drift cards show severity badges and actions:
   `Acknowledge`, `False positive`, `Act`.
5. On a drift card, click **Acknowledge**. The log should show:
   `acknowledge <packetId>`.
6. On a drift card, click **False positive**, enter a reason, and Submit. The
   log should show: `false_positive <packetId> reason=<typed reason>`.
7. On a drift card, click **Act**. The log should show: `act <packetId>`.
8. Click **Invoice** or **Proposal**. Confirm their action labels and log verbs
   remain `approve`, `reject`, and `edit`.
9. Reject an invoice or proposal. The inline form should say
   `Reject reason`.
10. Reject a drift card. The inline form should say
    `False positive reason`.
11. Click **Clear log**. The log should empty without changing open cards.
12. Open a reject form, then click **Reset demo**. The form should close and
    the log should clear.
13. On at least one drift card and one invoice/proposal card, expand the
    **Audit / model** disclosure. Confirm Learning signals appear with
    trigger codes (`model_inference_correction`, `source_basis_required`,
    `altitude_divergence`) when V9 produced drafts. An empty list is valid
    for packets that produced no triggers.

## Evidence To Capture

For the Monday proof packet, capture:

- Full queue screenshot on All.
- Drift filter screenshot showing severity badges.
- Audit/model panel screenshot showing Learning signals on a drift card
  where V9 produced drafts (e.g., `model_inference_correction` or
  `altitude_divergence`).
- Reject/false-positive form screenshot with reason submitted.
- Action log screenshot showing workflow-aware verbs.
- Smoke output excerpt showing `invoice_followup_gate_loop`.
- Smoke output excerpt showing `invoice_audit` in this order:
  `detected`, `drafted`, `approval_requested`, `approved`.
- Smoke output excerpt showing `learning_signal_audit` event chain
  (V9 drafts committed as `learning_signal.drafted`).

Optional evidence capture command:

```bash
npm run smoke | tee /tmp/kerf-w1-smoke-output.txt
```

## Known Boundaries

- Browser actions are demo-local DOM actions. They do not yet write production
  Blackboard operator decision events.
- The queue uses generated fixtures, not live QBO or Platform data.
- `npm run smoke` is the backend proof for invoice -> AltitudePacket ->
  Policy Gate -> DecisionPacket -> audit chain.
- Production operator decision persistence is a follow-up design/implementation
  slice.

