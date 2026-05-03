# W1 Proof Packet

**Capture date:** May 2, 2026  
**Operator sign-off:** Christian Asdal · GGRValle

**Repo baseline:** `382bf5f fix(demo): keep W1 card text readable in Safari (#62)`

This proof packet is the compact Monday-demo evidence bundle. The backend proof
and browser proof are complete as of `382bf5f`. The canonical packet with the
five committed screenshots lives at
[`evidence/2026-05-02-w1/PROOF_PACKET.md`](./evidence/2026-05-02-w1/PROOF_PACKET.md).

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

Captured from Safari after running `npm run demo:w1-queue`:

| # | Screenshot | Status |
|---|---|---|
| 1 | All filter: full 13-card queue with summary row visible | Captured: [`01-all-queue.png`](./evidence/2026-05-02-w1/screenshots/01-all-queue.png) |
| 2 | Drift filter: 4 drift cards with severity badges | Captured: [`02-drift-filter-badges.png`](./evidence/2026-05-02-w1/screenshots/02-drift-filter-badges.png) |
| 3-5 | Drift card, false-positive form, and mixed action log | Captured in [`evidence/2026-05-02-w1/screenshots/`](./evidence/2026-05-02-w1/screenshots/) |

Suggested local command:

```bash
cd ~/code/kerf-app
git switch main && git pull --ff-only
npm run demo:w1-queue
open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"
```

## Known Boundaries

- Browser actions append in-memory `decision.resolved` event-template records
  for demo evidence. Durable production persistence remains a follow-up slice.
- The mixed queue uses generated fixtures, not live QBO or Platform records.
- `npm run smoke` is the backend proof for invoice -> AltitudePacket -> Policy
  Gate -> DecisionPacket -> audit chain plus V9 learning-signal commit.
