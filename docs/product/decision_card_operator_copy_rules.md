# DecisionCard Operator Copy Rules

Status: tracked product canon · Last aligned with `main` after [#66](https://github.com/GGRValle/kerf-app/pull/66) (`feat(ui): add operator summary to DecisionCard`).

This note captures the operator-facing copy rules for the W1 DecisionCard
surface. The W1 demo exposes `invoice_followup`, `proposal_followup`, and
`drift_detection` cards through one DecisionQueue. Future UI work should treat
this doc as guidance for what an operator sees on a card — not a runtime
contract. The runtime contract is the `operatorSummary` field on
`DecisionCardViewModel` (`src/ui/components/DecisionCard.ts`).

---

## 1. Copy rules

**1. Lead with action, not state.** Headlines tell the operator what to do, not
what the system did. *"Needs approval to send"* beats *"V2 critical fail —
external_send_approval_missing"*.

**2. Workflow-aware language; same outcome ≠ same words.** A drift card never
says "approve"; an invoice card never says "false positive." The button trio
already enforces this (`Approve / Reject / Edit` vs `Acknowledge / False
positive / Act`). The operator-summary headline matches.

**3. No validator IDs, codes, or altitude levels in headlines.** "V2",
"AT-019", "L3", "OWNER_REVIEW", reason codes (`external_send_approval_missing`,
`source_basis_required`, `audit_trail_*`) — all stay in the audit/model
disclosure. Operator-facing copy is plain English.

**4. Money in dollars at the headline; cents in audit.** "$4,725.00" not
"472500". Same for percentages, durations, and raw timestamps.

**5. Don't promote system-internal signals.** V9 learning drafts and V18
divergence are system-improvement signals, not operator decisions. Operator
never sees "model thought L2, system said L3" on the card; they see the
system's verdict directly. Learning signals live inside the audit disclosure.

**6. Source basis is first-class — distinct from approval-block copy.** When
V7 blocks (no source) the headline says it's a *data* problem, not an
approval problem. *"Can't verify {entity}: source data missing"* is the
canonical pattern, not *"Blocked — needs approval"*.

**7. Term consistency across surfaces.** If the button says "Owner approval,"
the form says "Owner approval reason," the audit log says `owner_approval`.
Don't drift the term across button → form → log.

---

## 2. operatorSummary outcomes (the runtime contract)

`buildOperatorSummary()` produces a `{ headline, detail, tone }` triple for every
DecisionPacket. The four `tone` values are `blocked | neutral | review |
action`, mapped to CSS tone rails on the card.

The table below documents the canonical copy that ships today. Future copy
edits go through this table; downstream UI must not invent its own headline
strings.

### A. Source basis missing — `tone: 'blocked'`

| Workflow | Headline | Detail |
|---|---|---|
| `invoice_followup` | Can't verify invoice details: source data missing | Add invoice source evidence before approving the reminder. |
| `proposal_followup` | Can't verify proposal status: source data missing | Add proposal source evidence before approving the follow-up. |
| `drift_detection` | Can't verify the signal: source data missing | Add signal evidence before choosing a drift disposition. |
| _other / fallback_ | Can't verify this decision: source data missing | Add source evidence before taking action. |

Trigger: `status === 'BLOCKED_PENDING_SOURCE'` or
`safe_next_action === 'block_promotion'` or `blocked_reasons` includes
`source_basis_required`.

### B. External send approval missing — `tone: 'blocked'`

| Workflow | Headline | Detail |
|---|---|---|
| `invoice_followup` | Needs approval to send | Approve to send the payment reminder. |
| `proposal_followup` | Needs approval to send | Approve to send the proposal follow-up. |
| _other / fallback_ | Needs approval to send | Approve before sending externally. |

Trigger: `safe_next_action === 'block_external_send'` or `blocked_reasons`
includes `external_send_approval_missing`.

(Drift cards never reach this state — drift has no external send.)

### C. Autonomous drift surface — `tone: 'neutral'`

| Workflow | Headline | Detail |
|---|---|---|
| `drift_detection` | Internal drift surfaced for awareness | `{subtitle}`. Use Acknowledge, False positive, or Act to choose a disposition. |

Trigger: `workflow === 'drift_detection'` and
`safe_next_action === 'allow_internal_summary'`.

### D. Owner review needed — `tone: 'review'`

| Workflow | Headline | Detail |
|---|---|---|
| `invoice_followup` / `proposal_followup` | Owner approval needed to send | `proposed_action.description` |
| `drift_detection` | Owner review needed | `proposed_action.description` |

Trigger: `safe_next_action === 'request_owner_approval'` or
`review_requirement === 'OWNER_REVIEW'`.

### E. Operator review needed — `tone: 'review'`

| Workflow | Headline | Detail |
|---|---|---|
| _all_ | Operator review needed | Review the draft before taking action. |

Trigger: `safe_next_action === 'request_human_review'` or
`review_requirement === 'OPERATOR_REVIEW'`.

### F. Allowed (operator action ready) — `tone: 'action'`

| Workflow | Headline | Detail |
|---|---|---|
| _all_ | Ready for operator action | `proposed_action.description` |

Trigger: `policy_gate_result.allowed === true` and no earlier branch matched.

### G. Fallback / mixed state — `tone: 'neutral'`

| Workflow | Headline | Detail |
|---|---|---|
| _all_ | Review before continuing | `proposed_action.description` |

Trigger: any DecisionPacket that doesn't fit the prior branches. Rare but
present so the card always renders something coherent.

---

## 3. What stays in the audit / model disclosure

Everything an operator doesn't need to make the *next* decision belongs inside
the collapsed `<details>` audit block on the card. The operator-summary section
is for the next click; the disclosure is for the why behind it.

- **Validator internals.** Validator IDs (V1–V18), per-validator pass/fail/
  critical, reason codes (`external_send_approval_missing`,
  `source_basis_required`, `pricing_source_class_invalid`, `audit_trail_*`),
  `field_corrected` records.
- **Altitude algorithm trace.** `model_suggested_altitude`, `divergenceClass`
  (`match` / `model_overcaution` / `model_undercaution`),
  `system_baseline_altitude`, `escalation_floor`, `matched_rules`, the V18
  derivation chain.
- **Model identifiers.** `source_model` (`qwen2.5-7b-instruct`,
  `claude-3.5-sonnet`), `token_usage`, `model_inference_label` enum value.
- **Learning signals.** V9 drafts, listed by trigger code (`v8_correction`,
  `v7_blocked`, `v18_divergence`). System-improvement signals — never decisions.
- **Gate metadata.** `gate_run_id`, `gate_version`, `evaluated_at`, validator
  `duration_ms`.
- **Raw IDs.** `packet_id`, `event_id`, internal entity refs. The card shows
  the human-readable label (e.g., `Demo Client Rivera · INV-1001`); the
  underlying IDs live in audit for support and debug.
- **Causal links.** `correlationId`, `causedBy`, source_ref URIs
  (`qbo://invoice/1001`, `slack://project/.../thread/callback`).
- **Money internals.** Raw `amount_cents`, `mutation_intent`
  (`read` / `propose` / `approve` / `commit`), `source_class` enum,
  `privileged_fields`.
- **Role / visibility internals.** `role_visibility` array,
  `review_requirement` enum value (the operator summary says "Owner approval
  needed"; the audit shows `OWNER_REVIEW`).

**The principle:** if the operator's next click changes based on it, surface
it in `operatorSummary`. If it explains *why* the gate decided what it did,
audit it.

---

## 4. Implementation reference

- View model: `src/ui/components/DecisionCard.ts` →
  `DecisionCardViewModel.operatorSummary` and `buildOperatorSummary()`.
- Renderer: `src/ui/components/DecisionCardView.ts` (Next step section above
  status metadata; tone class maps to compact CSS rails).
- Tests: `tests/decision-card-ui.test.ts` (operator-summary content per
  workflow + blocked-state branches + escaping + jargon-avoidance assertions).

When adding new outcome copy, edit `buildOperatorSummary()` and update both
the test file and §2 of this doc in the same PR.
