# W1 Acceptance Evidence Ledger

This ledger maps the current W1 proof surface to concrete repo evidence. It is
intended for the Monday demo packet: open the runbook, run the gate, capture the
listed artifacts, and use this file as the acceptance-test index.

## Verified Baseline

Last evidence baseline before this ledger:

```bash
695c016 docs: update W1 demo evidence for V9 learning loop (#56)
```

Expected local gate:

```text
npm run typecheck
npm test -> 247/247
npm run demo:w1-queue
npm run smoke
npm run build
npm run test-fixtures:validate
git diff --check
```

The browser demo is fixture-backed and local-only. Backend audit proof comes
from `npm run smoke` and workflow tests; browser action-log clicks are demo
evidence, not production persistence.

## Evidence Commands

Run from a fresh checkout:

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

Capture smoke output when preparing the proof packet:

```bash
npm run smoke | tee /tmp/kerf-w1-smoke-output.txt
```

## Acceptance Map

| Acceptance item | Current evidence | Files / commands |
|---|---|---|
| AT-001 AltitudePacket and DecisionPacket typed contract | DecisionPacket fixtures generated from typed packets through the gate; type tests pin closed vocabularies. | `tests/altitude-types.test.ts`, `tests/decision-packet-fixtures.test.ts`, `src/altitude/types.ts` |
| AT-002 Policy Gate deterministic DecisionPacket output | Gate tests cover validator ordering, deterministic options, allowed/block paths, and DecisionPacket shape. | `tests/altitude-policy-gate.test.ts`, `npm test` |
| AT-003 V1/V2/V6 send-safety validators | Invoice/proposal external-send blocks and approval-populated pass paths are tested through workflow converters and gate output. | `tests/invoice-followup-gate-integration.test.ts`, `tests/proposal-followup-gate-integration.test.ts`, `tests/altitude-policy-gate.test.ts` |
| AT-004 V7 source-basis validator | Missing `source_refs` / `evidence_ids` / `claim_ids` forces `BLOCKED_PENDING_SOURCE` across invoice, proposal, and drift scenarios. | `tests/decision-packet-fixtures.test.ts`, `tests/altitude-policy-gate.test.ts`, `tests/drift-detection-workflow.test.ts` |
| AT-005 V8 model-inference labeling | V8 correction paths are covered by gate tests and by generated invoice/proposal/drift fixture scenarios. | `tests/altitude-policy-gate.test.ts`, `tests/decision-packet-fixtures.test.ts`, `tests/decision-card-ui.test.ts` |
| AT-006 V9 learning-signal drafts | V9 emits learning-signal drafts for V8 corrections, V7 source blocks, and V18 altitude divergence; smoke commits drafts as `learning_signal.drafted` events. | `tests/altitude-policy-gate.test.ts`, `tests/learning-signal-events.test.ts`, `tests/smoke-learning-signals.test.ts`, `npm run smoke` |
| AT-013 V12 audit-trail completeness | Gate result includes audit/validator evidence and workflow tests verify event-log chains for approve/reject/block paths. | `tests/altitude-policy-gate.test.ts`, `tests/invoice-followup-gate-integration.test.ts`, `tests/proposal-followup-gate-integration.test.ts` |
| AT-017 V15 i18n parity | EN/ES map parity is type-enforced by `TranslationMap` and runtime-checked for matching keys and non-empty values. | `tests/i18n-parity.test.ts`, `npm test` |
| AT-019 V17 token-budget check | V17 participates in canonical gate order and validator tests. | `tests/altitude-policy-gate.test.ts`, `tests/decision-packet-fixtures.test.ts` |
| AT-019 hosting-route-check adapter leg | Pure adapter guard emits `hosting_route_check`, blocks unapproved/mismatched/retired endpoints, and has no network dependency. | `tests/hosting-route-check.test.ts`, `src/hosting/routeCheck.ts` |
| AT-020 V18 altitude assignment | Baseline floors and divergence are tested; V9 records altitude-divergence learning drafts when V18 overrides model suggestion. | `tests/altitude-policy-gate.test.ts`, `tests/decision-packet-fixtures.test.ts`, `tests/learning-signal-events.test.ts` |
| W1 visible operator surface | Mixed queue renders 13 cards across invoice, proposal, and drift with workflow-aware labels, filters, badges, audit details, and learning signals. | `src/examples/README.md`, `npm run demo:w1-queue`, browser screenshots |

## Workflow Proof

| Workflow | Gate integration | Fixture coverage | UI coverage |
|---|---|---|---|
| `invoice_followup` | Candidate -> draft -> AltitudePacket -> Policy Gate -> DecisionPacket -> approval/audit smoke loop. | 4 generated scenarios: owner review, V2 external-send block, V7 source-basis block, V8 review. | DecisionCard + DecisionQueue mixed demo. |
| `proposal_followup` | Candidate -> draft -> AltitudePacket -> Policy Gate -> DecisionPacket -> approval/reject audit chains. | 5 generated scenarios: owner review, V2 external-send block, V7 source-basis block, V8 review, near-expiry. | Workflow-aware titles/subtitles and default approval labels. |
| `drift_detection` | Candidate -> alert -> AltitudePacket -> Policy Gate -> DecisionPacket; internal-only autonomous path. | 4 generated scenarios: default autonomous, high-confidence V8 review, V7 source-basis block, critical drift. | Severity badges, drift-specific labels (`Acknowledge`, `False positive`, `Act`), filter tab. |

## Browser Evidence Checklist

Use `src/examples/README.md` as the click script. Capture:

- Full queue screenshot on **All** with 13 cards.
- **Blocked** filter screenshot with blocked-card emphasis.
- **Drift** filter screenshot with severity badges and drift-specific actions.
- Audit/model disclosure screenshot showing validator order
  `V1 -> V2 -> V6 -> V7 -> V8 -> V9 -> V12 -> V17 -> V18`.
- Audit/model disclosure screenshot showing V9 Learning signals with one or more
  reason codes:
  - `model_inference_correction`
  - `source_basis_required`
  - `altitude_divergence`
- Reject / false-positive reason form screenshot after a submitted reason.
- Action log screenshot showing workflow-aware verbs:
  `approve`, `reject`, `edit`, `acknowledge`, `false_positive`, `act`.

## Smoke Evidence Checklist

From `/tmp/kerf-w1-smoke-output.txt`, capture:

- `invoice_followup_gate_loop.altitude_packet`
- `invoice_followup_gate_loop.decision_packet`
- `invoice_followup_gate_loop.invoice_audit`, with event kinds in order:
  `invoice_followup.detected`, `invoice_followup.drafted`,
  `invoice_followup.approval_requested`, `invoice_followup.approved`
- `invoice_followup_gate_loop.learning_signal_audit`, containing
  `learning_signal.drafted`
- At least one learning signal record with:
  - `sourceValidatorId`
  - `reason`
  - `summary`

## Known Boundaries

- Browser action log entries are local demo evidence only.
- Production operator decision persistence is still a follow-up slice.
- The mixed queue uses generated fixtures, not live QBO or Platform records.
- Kerf-app owns the pure hosting-route guard; Platform owns real model network
  invocation and adapter emission.
- V9 drafts learning signals; orchestration decides when to commit them as
  Blackboard events. `npm run smoke` demonstrates that explicit commit path.
