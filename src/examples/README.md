# W1 Demo Runbook

This runbook is the repeatable path for the Kerf W1 demo. It proves the current
safety spine and browser-visible operator surface from a fresh checkout.

For the acceptance-test evidence map, see
[`W1_ACCEPTANCE_EVIDENCE.md`](./W1_ACCEPTANCE_EVIDENCE.md). The runbook is the
demo procedure; the evidence ledger maps each W1 acceptance item to the tests,
smoke output, and browser artifacts that prove it.

For F&F, **proposal follow-up** is the work that clears the path to billing;
invoice and drift rows sit in the same queue so the surface stays honest, not
busy.

## Verified Baseline

Last verified on **2026-05-03** (proposal proof packet readiness pass) from
`main` at:

```bash
4c9bece fix(demo): align W1 skeleton and error states (#90)
```

Expected green gate at this baseline:

```text
npm test -> all passing (runner prints subtest tally; refresh if the ledger lags)
```

The browser demo is local-only. It uses generated DecisionPacket fixtures and
does not call QBO, Platform, Slack, Gmail, or any backend. The right-side action
log is browser-local demo evidence. Backend audit evidence comes from
`npm run smoke` and workflow tests.

This close baseline includes the W1 proof packet screenshots and the Safari
readability fix for file-open demos. The proof artifacts live under
[`evidence/2026-05-02-w1/`](./evidence/2026-05-02-w1/). Proposal F&F draft packet:
[`evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](./evidence/2026-05-03-proposal-ff/PROOF_PACKET.md).

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

- `npm test` exits `0` with all subtests passing (runner prints the tally).
- `npm run demo:w1-queue` builds
  `src/examples/w1-decision-queue-demo.bundle.js`.
- `npm run smoke` prints `invoice_followup_gate_loop` with an
  `altitude_packet`, `decision_packet`, `invoice_audit` event chain, and
  `learning_signal_audit` event chain (V9 drafts committed by the smoke
  harness as `learning_signal.drafted` events).
- `npm run test-fixtures:validate` prints `seed produced 4 events`.
- `git diff --check` prints nothing and exits cleanly.

## Proposal follow-up smoke (F&F proof)

```bash
npm run smoke:proposal-ff
```

Runs `src/examples/proposal-ff-smoke.ts` against a **temporary JSONL** EventLog
(no Platform, no fetch, no backend writes). It proves, end to end:

- **Approve chain** — operator approve after `proposal_followup.approval_requested`.
- **Reject chain** — operator reject with reason after the same request state.
- **JSONL reopen durability** — events survive closing the write session and
  reopening the same file.
- **Golden contract** — tests compare the stable proof object to
  [`evidence/ff-proposal-smoke/proposal-ff-smoke-proof.json`](./evidence/ff-proposal-smoke/proposal-ff-smoke-proof.json)
  (refresh that file with `npm run smoke:proposal-ff -- --write-golden` when the
  harness contract intentionally changes).
- **Proof packet** — operator narrative, golden excerpt, and browser checklist:
  [`evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](./evidence/2026-05-03-proposal-ff/PROOF_PACKET.md).
  One committed stdout capture (npm banner + JSON, machine-specific
  `jsonl_path`) lives at
  [`evidence/2026-05-03-proposal-ff/smoke_output.txt`](./evidence/2026-05-03-proposal-ff/smoke_output.txt);
  re-run `npm run smoke:proposal-ff 2>&1 | tee …/smoke_output.txt` when the
  harness contract changes or you need a fresh path for audit.

## Open The Browser Demo

After `npm run demo:w1-queue`:

```bash
open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"
```

A regular browser such as Safari is preferred. If a chat preview or embedded
viewer opens a blank page, rebuild the bundle with `npm run demo:w1-queue` and
open the file directly in Safari.

### Hosted-style local server (recommended for F&F dry runs)

For browsing over `http://` rather than `file://` — same demo, same bundle,
served by a simple zero-dependency Python static server. Closer to how the
demo will eventually deploy for friends-and-family access:

```bash
npm run demo:w1-queue:serve
# Opens nothing; once the server starts, visit:
#   http://localhost:8000/examples/w1-decision-queue-demo.html
# Ctrl-C to stop.
```

Requirements: Python 3 on `PATH` (ships with macOS). Port 8000 free.
The script builds the bundle then starts `python3 -m http.server 8000
--directory src`. No auth, no fetch, no backend writes — same pure
demo-local fixtures as the file:// path. The HTTP path is preferred for
F&F dry runs because some browsers (notably Chrome and chat-preview
viewers) restrict `file://` asset loading.

## What Should Render

The W1 Standard UI demo should show:

- Top bar (see `w1-decision-queue-demo.html`): `KERF` mark; title
  `W1 · Proposal-first queue demo`; brand tag `Standard UI · local only`; pill
  `Local only`.
- Lead copy: **Proposal path** paragraph under the filters (All / Proposal,
  tinted proposal rows, right panel, Approve / Edit / Reject, action log — no
  network).
- Main queue with 12 cards from `seededMixedDecisionPacketListFixture`
  (local `ProposalReadSurfaceAdapter` seeded proposal read surface + invoice/drift fixtures).
- Filter buttons: All, Blocked, Owner Review, Invoice, Proposal, Drift.
- Right rail action log with Clear log and Reset demo controls.

Expected mixed queue summary:

| Metric | Expected |
|---|---:|
| Total | 12 |
| Allowed | 5 |
| Blocked | 7 |
| Owner review | 7 |
| Critical | 7 |

Workflow coverage:

| Workflow | Cards | Notes |
|---|---:|---|
| `invoice_followup` | 4 | Owner-review, V2 blocked, V7 blocked, V8 review. |
| `proposal_followup` | 4 | Seeded proposal read surface rows (sent, viewed, near-expiry, change-requested). |
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

1. Start on **All**. Confirm the 12-card mixed queue and summary counts.
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
14. Click **Proposal**. Confirm only the four seeded `proposal_followup` rows
    (same 12-card fixture; button `title` in HTML calls out “four seeded proposal
    follow-up rows”).
15. From **All** or **Proposal**, click a tinted proposal card. Confirm the
    right **proposal detail** panel opens with drafted follow-up and footer
    **Approve** / **Reject** / **Edit** (banner: same actions as the card).
16. On a proposal card or detail footer, click **Approve**. Confirm
    `approve <packetId>` appears in **ACTION LOG** (and proposal workflow audit
    rows per known boundaries).
17. On a different proposal row (or after **Reset demo**), open detail if
    needed and click **Edit**. Confirm `edit <packetId>` appears in **ACTION LOG**
    (demo logs immediately; no separate editor modal).
18. On another proposal row, click **Reject**, complete **Reject reason**, then
    **Submit**. Confirm `reject <packetId>` (and reason tail if shown) in
    **ACTION LOG**.
19. Without **Clear log**, scroll **ACTION LOG** so multiple proposal `approve` /
    `reject` / `edit` lines are visible in one frame when capturing packet
    evidence (mirrors [`evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](./evidence/2026-05-03-proposal-ff/PROOF_PACKET.md) §8.1).

## Evidence To Capture

For the Monday proof packet, capture:

- Full queue screenshot on All.
- Drift filter screenshot showing severity badges.
- Audit/model panel screenshot showing Learning signals on a drift card
  where V9 produced drafts (e.g., `model_inference_correction` or
  `altitude_divergence`).
- Reject/false-positive form screenshot with reason submitted.
- Action log screenshot showing workflow-aware verbs.
- Action log screenshot showing `decision.resolved` audit rows for operator
  actions; proposal approve/reject rows should also show
  `proposal_followup.approved` or `proposal_followup.rejected`.
- Smoke output excerpt showing `invoice_followup_gate_loop`.
- Smoke output excerpt showing `invoice_audit` in this order:
  `detected`, `drafted`, `approval_requested`, `approved`.
- Smoke output excerpt showing `learning_signal_audit` event chain
  (V9 drafts committed as `learning_signal.drafted`).
- Proposal F&F packet: follow
  [`evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](./evidence/2026-05-03-proposal-ff/PROOF_PACKET.md)
  §8.1 for `screenshots/01-…` through `06-…`; optional fresh
  `npm run smoke:proposal-ff` tee into
  [`evidence/2026-05-03-proposal-ff/smoke_output.txt`](./evidence/2026-05-03-proposal-ff/smoke_output.txt)
  when re-baselining stdout.

Optional evidence capture command:

```bash
npm run smoke | tee /tmp/kerf-w1-smoke-output.txt
```

## Known Boundaries

- Browser actions append in-memory `decision.resolved` event-template records
  for demo evidence. Proposal approve/reject also append the corresponding
  `proposal_followup.approved` / `.rejected` workflow event in the same
  EventLog. Cross-restart durable storage remains a follow-up slice.
- The queue uses generated fixtures, not live QBO or Platform data.
- `npm run smoke` is the backend proof for invoice -> AltitudePacket ->
  Policy Gate -> DecisionPacket -> audit chain.
- Cross-restart production operator decision storage is a follow-up
  design/implementation slice.
