# Proposal F&F Evidence Packet — 2026-05-03 (draft)

| Field | Value |
|---|---|
| Capture date | 2026-05-03 (draft ledger) |
| Main SHA (branch tip at draft) | [`3870ec2`](https://github.com/GGRValle/kerf-app/commit/3870ec2) — `test(examples): golden proof contract for proposal-ff JSONL smoke (#86)` |
| Scope | **Proposal loop only** — JSONL durability smoke + browser click script placeholders + screenshot placeholders |
| Prepared by | Kerf evidence/docs track |
| Source-of-truth docs | [`src/examples/README.md`](../../README.md) (runbook) · [`src/examples/W1_ACCEPTANCE_EVIDENCE.md`](../../W1_ACCEPTANCE_EVIDENCE.md) (ledger) · [`docs/ff_proposal_first_roadmap.md`](../../../docs/ff_proposal_first_roadmap.md) |

---

## 1. Executive summary

This packet is the **Friends-and-Family proposal-first** companion to the frozen W1 proof packet under `src/examples/evidence/2026-05-02-w1/`. It does not re-prove the full three-workflow W1 spine. It proves, in one narrow slice:

1. **Harness stdout** — `npm run smoke:proposal-ff` emits a stable proof object (plus an ephemeral `jsonl_path`).
2. **Golden contract** — committed JSON under `src/examples/evidence/ff-proposal-smoke/` is the regression anchor for that proof shape.
3. **Approve / reject audit chains** — event kinds through `proposal_followup.approval_requested` into `decision.resolved` and the matching workflow terminal (`proposal_followup.approved` or `proposal_followup.rejected`).
4. **Durability** — the same proof reports `durability: "ok"` after closing and reopening the JSONL `EventLog` session (see `src/examples/proposal-ff-smoke.ts`).
5. **Browser evidence (placeholders)** — operator captures screenshots and follows the click script below; paths are markdown-only until assets exist.

---

## 2. Verification gate (proposal F&F slice)

Run from a fresh checkout of `main` (or this branch rebased on `main`):

```bash
cd ~/code/kerf-app
git switch main && git pull --ff-only
npm install
npm run typecheck
npm test
npm run smoke:proposal-ff 2>&1 | tee src/examples/evidence/2026-05-03-proposal-ff/smoke_output.txt
git diff --check
git rev-parse --short HEAD
```

**Captured note:** `smoke_output.txt` was generated with `npm run smoke:proposal-ff` on the verification machine. The `jsonl_path` is ephemeral; the proof fields (`approve_chain`, `reject_chain`, `total_events_after_reopen`, `durability`) match the committed golden file in §3.2.

---

## 3. Smoke output (`npm run smoke:proposal-ff`)

### 3.1 Quoted stdout shape

The harness prints a single pretty-printed JSON object to stdout. Captured draft copy lives in:

[`smoke_output.txt`](./smoke_output.txt)

**Excerpt (proof fields; `jsonl_path` is per-run):**

```json
{
  "jsonl_path": "<ephemeral temp path from smoke_output.txt>",
  "proof_version": 1,
  "total_events_after_reopen": 10,
  "approve_chain": [
    "proposal_followup.detected",
    "proposal_followup.drafted",
    "proposal_followup.approval_requested",
    "decision.resolved",
    "proposal_followup.approved"
  ],
  "reject_chain": [
    "proposal_followup.detected",
    "proposal_followup.drafted",
    "proposal_followup.approval_requested",
    "decision.resolved",
    "proposal_followup.rejected"
  ],
  "durability": "ok"
}
```

### 3.2 Golden proof JSON path (contract)

Committed golden (no temp paths; `npm test` compares live smoke output to this file):

**Path:** [`src/examples/evidence/ff-proposal-smoke/proposal-ff-smoke-proof.json`](../ff-proposal-smoke/proposal-ff-smoke-proof.json)

**Full golden contents:**

```json
{
  "proof_version": 1,
  "total_events_after_reopen": 10,
  "approve_chain": [
    "proposal_followup.detected",
    "proposal_followup.drafted",
    "proposal_followup.approval_requested",
    "decision.resolved",
    "proposal_followup.approved"
  ],
  "reject_chain": [
    "proposal_followup.detected",
    "proposal_followup.drafted",
    "proposal_followup.approval_requested",
    "decision.resolved",
    "proposal_followup.rejected"
  ],
  "durability": "ok"
}
```

---

## 4. Approve chain (correlation `proposal_smoke_approve`)

Per-event kinds in correlation order (see golden `approve_chain`):

| Step | Event kind |
|---:|---|
| 1 | `proposal_followup.detected` |
| 2 | `proposal_followup.drafted` |
| 3 | `proposal_followup.approval_requested` |
| 4 | `decision.resolved` |
| 5 | `proposal_followup.approved` |

---

## 5. Reject chain (correlation `proposal_smoke_reject`)

| Step | Event kind |
|---:|---|
| 1 | `proposal_followup.detected` |
| 2 | `proposal_followup.drafted` |
| 3 | `proposal_followup.approval_requested` |
| 4 | `decision.resolved` |
| 5 | `proposal_followup.rejected` |

---

## 6. Durability across JSONL reopen

After both flows write to a temp JSONL file, the harness closes the log, reopens it via `createJsonlEventLog`, reads `all()`, and asserts:

- `total_events_after_reopen` **10** (five events per correlation × two correlations).
- Approve and reject chains still end in `decision.resolved` plus the correct terminal workflow event.
- Golden field **`durability`: `"ok"`** documents that reopen succeeded.

---

## 7. Browser click script (placeholders — operator fills)

Runbook entry point remains [`src/examples/README.md`](../../README.md). For F&F proposal evidence, capture **in order**:

1. **Proposal filter** — `[PLACEHOLDER]` Open W1 queue demo HTML from built bundle; select **Proposal** filter; note four eligible proposal cards and proposal-first ordering vs **All**.
2. **Proposal detail panel** — `[PLACEHOLDER]` Click a seeded proposal card; confirm detail / review panel opens with drafted follow-up in context.
3. **Approve** — `[PLACEHOLDER]` Use **Approve** on one proposal card (or panel); confirm action log verb and any in-demo persistence behavior per runbook.
4. **Edit** — `[PLACEHOLDER]` Use **Edit** (if shown); confirm inline edit path and log entry shape.
5. **Reject** — `[PLACEHOLDER]` Use **Reject** with a short reason; confirm reason form and log entry.
6. **Action log** — `[PLACEHOLDER]` Scroll action log rail; capture entries showing workflow-aware verbs for proposal (`approve` / `reject` / `edit` as applicable).

**Per-shot browser steps:** see §8.1 (maps each `screenshots/*.png` to clicks in order).

---

## 8. Screenshot placeholders (markdown only — operator captures later)

Save assets under `src/examples/evidence/2026-05-03-proposal-ff/screenshots/` (create directory on capture). Until then, these links are intentionally broken placeholders.

### 8.1 Operator screenshot checklist

Prereq for every row: from repo root run `npm run demo:w1-queue`, then open `src/examples/w1-decision-queue-demo.html` in a desktop browser (runbook: `open -a Safari "$(pwd)/src/examples/w1-decision-queue-demo.html"` or `npm run demo:w1-queue:serve` and visit `http://localhost:8000/examples/w1-decision-queue-demo.html`).

| ID | Save as | Exact capture actions |
|---|---|---|
| S1 | `screenshots/01-proposal-filter.png` | Click **All** → click **Proposal** → capture with **Proposal** filter visually active and the queue showing only proposal cards. |
| S2 | `screenshots/02-proposal-detail-panel.png` | With **Proposal** filter active, click the title/summary area of any proposal card (not a filter chip) → capture with the proposal **detail / review** panel open (drafted follow-up visible). |
| S3 | `screenshots/03-proposal-approve.png` | On an allowed proposal path, click **`Approve`** in the card footer or detail footer → capture immediately after: proposal UI + right-rail **ACTION LOG** showing a new `approve …` line for that `packet_id`. |
| S4 | `screenshots/04-proposal-edit.png` | On a **different** proposal card than S3 (or after **Reset demo**), open its detail if needed → click **`Edit`** → capture after the click: same surface + **ACTION LOG** line `edit …` for that `packet_id`. |
| S5 | `screenshots/05-proposal-reject.png` | On another proposal card, click **`Reject`** → in the inline **Reject reason** form, type a short reason → click **`Submit`** → capture after submit: card/panel state + **ACTION LOG** `reject …` (and reason tail if shown) for that `packet_id`. |
| S6 | `screenshots/06-proposal-action-log.png` | Without **Clear log** (use one continuous session from S3–S5 if possible), scroll the **ACTION LOG** rail until at least two of `approve` / `reject` / `edit` lines for proposal work are visible together → capture the rail. |

Per-shot detail for §7: use the same ordering as S1→S6 when rehearsing.

| ID | Intent |
|---|---|
| S1 | ![Proposal filter — Proposal tab selected](screenshots/01-proposal-filter.png) |
| S2 | ![Proposal detail / review panel open](screenshots/02-proposal-detail-panel.png) |
| S3 | ![Approve path — card or panel + action log tail](screenshots/03-proposal-approve.png) |
| S4 | ![Edit path — draft edit surface + action log](screenshots/04-proposal-edit.png) |
| S5 | ![Reject path — reason form submitted + action log](screenshots/05-proposal-reject.png) |
| S6 | ![Action log — proposal verbs highlighted](screenshots/06-proposal-action-log.png) |

---

## 9. Workflow proof matrix (proposal-only row)

| Workflow | Harness / contract | UI evidence |
|---|---|---|
| `proposal_followup` | `npm run smoke:proposal-ff` + golden `proposal-ff-smoke-proof.json` | §7–§8.1 placeholders + [`README.md`](../../README.md) |

---

## 10. Known boundaries

- This packet **does not** supersede or edit the frozen W1 packet (`2026-05-02-w1`).
- Browser steps remain **local demo** evidence unless/until hosted demo and storage-backed persistence land (see roadmap).
- `jsonl_path` in stdout is **ephemeral**; only the golden JSON and matching proof fields are stable contracts.

---

## 11. Sign-off (draft)

| | |
|---|---|
| **Status** | Draft — smoke output captured; screenshots pending under §8 |
| **Next** | Operator runs full gate in §2 and attaches real `jsonl_path` + browser captures |

---

*Draft 2026-05-03. Structure mirrors [`../2026-05-02-w1/PROOF_PACKET.md`](../2026-05-02-w1/PROOF_PACKET.md) with proposal-loop scope. Runbook: [`README.md`](../../README.md); ledger: [`W1_ACCEPTANCE_EVIDENCE.md`](../../W1_ACCEPTANCE_EVIDENCE.md).*
