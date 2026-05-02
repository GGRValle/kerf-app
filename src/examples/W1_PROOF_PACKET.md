# W1 Proof Packet

**Capture date:** May 2, 2026  
**Operator sign-off:** TODO  
**Repo baseline:** `a72713e feat(decisions): add operator decision event templates (#58)`

This proof packet is the compact Monday-demo evidence bundle. The backend proof
is complete as of `a72713e`; browser screenshots are the remaining human-capture
items from Safari on the MacBook Pro.

## Backend Gate Evidence

| Field | Evidence |
|---|---|
| Test gate | `npm test -> 252/252` |
| Typecheck | `npm run typecheck` passed |
| Smoke | `npm run smoke` passed |
| Build | `npm run build` passed |
| Fixtures | `npm run test-fixtures:validate -> seed produced 4 events` |
| Whitespace | `git diff --check` clean |
| Demo bundle | `src/examples/w1-decision-queue-demo.bundle.js` built, approx. 74.5kb |

## Smoke Proof

`npm run smoke` produced `invoice_followup_gate_loop` with:

| Field | Value |
|---|---|
| Gate verdict | `allowed: false` |
| Critical failures | `['V2']` |
| Safe next action | `block_external_send` |
| Review requirement | `OWNER_REVIEW` |
| Altitude | baseline `L2` -> final `L3` |
| Validator order | `V1, V2, V6, V7, V8, V9, V12, V17, V18` |

`invoice_audit` event order:

```text
invoice_followup.detected
invoice_followup.drafted
invoice_followup.approval_requested
invoice_followup.approved
```

`learning_signal_audit` contained one `learning_signal.drafted` event:

```text
sourceValidatorId: V18
reason: altitude_divergence
summary: V18 detected model_undercaution for invoice_followup.
```

Interpretation: the model suggested `L2`; V18 applied external-send and money
mutation escalation floors, producing final `L3`; V9 correctly drafted a learning
signal for the altitude divergence.

## Browser Screenshot Checklist

Capture these from Safari after running `npm run demo:w1-queue`:

| # | Screenshot | Status |
|---|---|---|
| 1 | All filter: full 13-card queue with summary row visible | TODO |
| 2 | Drift filter: 4 drift cards with severity badges | TODO |
| 3 | Audit/model disclosure: validator order plus non-empty V9 Learning signals | TODO |
| 4 | False positive form: drift reject reason form open with typed reason | TODO |
| 5 | Action log: mixed verbs `approve`, `reject`, `edit`, `acknowledge`, `false_positive`, `act` | TODO |

Suggested local command:

```bash
cd ~/code/kerf-app
git switch main && git pull --ff-only
npm run demo:w1-queue
open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"
```

## Known Boundaries

- Browser action log entries are local demo evidence only.
- Production persistence now has a typed pure event-template contract via
  `operatorDecisionToEventTemplate`, but browser actions do not append
  `decision.resolved` events yet.
- The mixed queue uses generated fixtures, not live QBO or Platform records.
- `npm run smoke` is the backend proof for invoice -> AltitudePacket -> Policy
  Gate -> DecisionPacket -> audit chain plus V9 learning-signal commit.
