# Sprint D.1 — Field Daily → CO Draft with Pricing

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **For:** Cursor SDK + Claude (mixed-ownership sprint)
- **Status:** Live brief. The bridge from "voice in → office sees drift card" to "voice in → office sees draft CO with pricing." Christian's stated goal on 2026-05-16 after the first internet deploy succeeded.
- **Anchors:**
  - V1.5 demo loop in production at https://kerf-v15-internal.fly.dev
  - `right_hand_home_module_drawer_2026-05-15.md` (Right Hand surface canon)
  - `field_daily_workflow_design_2026-05-15.md` §8 + §10 (plays not agents)
  - PR #198's canon-drift audit (substrate-is-truth principle)

---

## 1. Standing rules (verbatim — preserve in every worker handoff)

> You are working on GGRValle/kerf-app in the compressed F&F proposal-first push.
>
> Operating rules:
> - Base every branch on fresh main.
> - Keep PRs small and scoped.
> - Do not touch Policy Gate, schemas, fixtures, workflows, or EventLog unless your specific task says so.
> - Run the requested verification gate before reporting done.
> - Push your branch and open a PR if gh is available; otherwise push and report branch + commit.
> - Never rewrite frozen evidence under `src/examples/evidence/2026-05-02-w1` unless explicitly assigned.
> - No fetch, no Platform calls, no real auth, no backend writes unless explicitly assigned.
> - Report: branch, commit, files changed, tests run, what could break.

**Hard repo limits:** no force-push, no `git reset --hard`, no `clean -fd`, no `rm -rf`, no pre-merge branch deletion.

---

## 2. Why D.1 exists — the bridge in one diagram

**Today (deployed):**
```
Voice capture → facts → drift → relay_card.surfaced
  → office /relay shows: facts table + drift severity chip
  → "Mark reviewed → actioned" → relay_card.reviewed event → NOTHING fires downstream
```

**After D.1:**
```
Voice capture → facts → drift → relay_card.surfaced
  → IF scope_change_flags OR money_risk_flags non-empty:
       → fieldDailyToCoDraftPlay runs
       → Cost KB lookup (tier-2 actuals preferred, tier-1 fallback)
       → ProposalArtifact built (CSI-classified, §7159-compliant)
       → AltitudePacket → runPolicyGate → DecisionPacket
       → proposal.drafted event written
  → office /relay shows: facts + draft CO total + line items + Policy Gate decision
  → "Mark reviewed → actioned" → proposal.accepted event written (NOT external send — that's E.1)
```

**The win:** field signal becomes office-actionable money proposal, deterministically, with full audit trail. No external sends, no auto-money-movement — operator still approves before anything leaves the system.

---

## 3. Substrate consumed (already on main — don't rebuild)

| Substrate | Where | What |
|---|---|---|
| Field Daily play handler | `src/persistence/fieldCapture.ts` | Captured → facts emitter |
| 9-fact extractor | `src/persistence/dailyLogExtractor.ts` | Deterministic facts extraction |
| Drift adapter | `src/persistence/driftAdapter.ts` | Facts → drift severity |
| Relay-card surfacing play | `src/persistence/relayCardSurfacer.ts` | Drift → surfaced card |
| Play scheduler wired into endpoint | `scripts/serve-v15-vertical-slice.ts:handleCreateDailyLogEntry` | Inline chain on POST capture |
| **Cost KB seed (tier-1)** | `src/examples/v15-vertical-slice/v15-cost-kb-seed.ts` | KerfCostKbSeedRow with scope_category, item_name, range_low/high/default cents, confidence_score |
| **Tier-2 ingestion** | `src/persistence/kbIngestion.ts` | Tenant-actuals from past Excel/QBO data |
| **ProposalArtifact + CSI** | `src/proposal/types.ts`, `csi-divisions.ts`, `numbering.ts` | CSI MasterFormat divisions, sections, lines |
| **§7159 validator** | `src/proposal/validation.ts` | CA payment-schedule validator (hard-block on accepted) |
| **Proposal renderer** | `src/proposal/render.ts`, `print-style.ts` | HTML render of artifact |
| **Policy Gate + AltitudePacket** | `src/altitude/gate.ts`, `types.ts` | V1-V18 validators |
| **Decision Card UI** | `/decisions/<id>` route (pages.ts) | Existing operator approval surface |
| **proposal.drafted / proposal.accepted events** | `src/persistence/events.ts` | Event vocabulary already supports CO flow |
| **/relay UI** | `src/examples/v15-vertical-slice/pages/relay.ts` | Where the draft renders alongside facts |

**Substrate is real and substantial.** D.1 is mostly wiring + a thin new play module.

---

## 4. Five sub-steps (~10-13h total)

### D.1.1 — Field-Daily-to-CO-draft play (~3h)

**File:** `src/persistence/fieldDailyToCoDraftPlay.ts` (new)

A pure function that takes a `(driftEvent, factsEvent, projectContext, costKbSnapshot)` tuple and emits a `ProposalArtifact` (a CO draft).

**Trigger rule (extends C.1's surfacing rule):**
- ONLY fires when surfacing fired AND (`scope_change_flags` non-empty OR `money_risk_flags` non-empty)
- Skips when the surfacing was driven by `schedule_status='behind'` alone (no money lever)

**Scope-phrase → CSI division mapping (deterministic):**
- Tier 1: keyword-to-category table covering the top 20-30 common phrases
  - "wine fridge" / "beverage cooler" → CSI 11 30 00 (Residential Equipment / Appliances)
  - "vent fan" / "exhaust fan" → CSI 23 30 00 (HVAC Air Distribution)
  - "galvanized" / "copper substitution" → CSI 22 11 00 (Plumbing Piping)
  - "tile" / "backsplash" → CSI 09 30 00 (Tiling)
  - "recessed light" / "can light" → CSI 26 50 00 (Electrical / Lighting)
- Tier 2: anything not in the table → category `'GENERAL_FOLLOWUP'` + flag for operator to classify

**Pricing flow:**
- For each mapped CSI category, query `costKbSnapshot` (tier-2 first if available, tier-1 fallback)
- Use `default_cost_cents` if present, else midpoint of `range_low_cents` + `range_high_cents`
- Build a `ProposalLineItem` per scope phrase
- Sum line totals to `proposal.total_cents`

**Output:** a `ProposalArtifact` with:
- `status: 'DRAFTED'`
- `proposal_number` auto-generated per `src/proposal/numbering.ts`
- `divisions[]` filled per the mapping
- `payment_schedule` = standard 3-tier default from §7159 (deposit / mid / completion)
- `tax_treatment` from the project's tenant defaults
- `provenance` field tying back to the source `daily_log.entry_id` + `drift_event_id`

**Tests (~10):**
1. Henderson change-scope-flag fires CO draft with copper line item
2. Pure schedule-only drift does NOT fire CO draft (skip)
3. money_risk_flags=['galvanized'] fires CO draft with plumbing line
4. Unmapped scope phrase (e.g., "owner asked for a hot tub") → GENERAL_FOLLOWUP category
5. Cost KB hit prefers tier-2 over tier-1 when both exist
6. Tier-1 fallback when no tier-2 hit
7. §7159 payment_schedule default applied
8. provenance fields populated (source entry_id + drift event_id)
9. Determinism (single + 100-run)
10. Forbidden-surface (no LLM imports, no fetch)

---

### D.1.2 — Cost KB lookup helper (~1.5h)

**File:** `src/persistence/costKbLookup.ts` (new) — OR extension of `src/persistence/kbIngestion.ts` if cleaner

Pure function:
```ts
export function lookupCostForCsiCategory(
  csi_category: string,
  snapshot: KerfCostKbSnapshot,
  options?: { project_id?: string; preferred_tier?: 'tier_1' | 'tier_2' }
): KerfCostKbLookupHit | null
```

**Rule:**
- Tier-2 actuals (tenant-ingested) > tier-1 seed
- Within a tier, prefer rows with `confidence_score` high + `freshness_window_days` met
- Return `null` if no row passes the safety gate (RANGE_ONLY-or-better, non-empty source_ref_id)
- Caller (D.1.1) decides what to do with null (today: omit the line; flag for operator)

**Tests (~6):**
1. Tier-2 preferred over tier-1 when both exist for the category
2. Tier-1 fallback when no tier-2
3. Null when no row meets safety gate
4. Confidence score breaks ties within a tier
5. Freshness window respected (stale rows excluded)
6. project_id scoping (when set, prefers project-specific rows)

---

### D.1.3 — Scheduler wires the CO play (~2h)

**File:** `scripts/serve-v15-vertical-slice.ts` (modify `handleCreateDailyLogEntry`)

After C.1's surfacing play runs, if a `relay_card.surfaced` event was emitted AND the trigger rule from D.1.1 fires:
1. Build the cost KB snapshot (read events, materialize via `kbIngestion`'s existing surface)
2. Invoke `runFieldDailyToCoDraftPlay(driftEvent, factsEvent, projectContext, snapshot)`
3. If non-null, build the AltitudePacket:
   - `workflow: 'proposal_generation'`
   - Pull `extracted_facts` from the proposal artifact's line items
   - `proposed_action: { type: 'draft_client_message', description: 'Draft CO for client review' }`
4. Run through `runPolicyGate` → get `DecisionPacket`
5. Emit `proposal.drafted` event with the artifact + the DecisionPacket as source_refs
6. Return the artifact in the POST response: `proposal_draft: <ProposalArtifact>` + `decision_packet: <DecisionPacket>`

**Error policy:** same as the rest of the scheduler — log + `play_error` field in response, don't 5xx. The captured + facts + drift + surfaced events are durable; the CO draft is best-effort.

**Tests (~5 HTTP-integration):**
1. Henderson POST emits 6 events (project.created + entry_captured + facts_extracted + drift_detected + relay_card.surfaced + proposal.drafted)
2. Clean on_track POST emits no proposal.drafted
3. Drift with schedule-behind-only (no money/scope) emits no proposal.drafted
4. proposal.drafted event passes validatePersistenceEvent
5. proposal.drafted's source_refs propagate from the source drift event

---

### D.1.4 — Relay-card detail surfaces the draft (~2-3h) — CURSOR

**Files:**
- `src/examples/v15-vertical-slice/pages/relay.ts` (modify — extend detail view)
- `src/examples/v15-vertical-slice/relay-feed-build.ts` (modify — feed includes proposal_id when present)
- `src/i18n/keys.ts`, `en.ts`, `es.ts` (add `rh.relay.detail.proposal_*` keys)
- `tests/v15-relay-surface.test.ts` (extend)

**Scope:**
- On the detail view at `/relay/<entry_id>`, IF the entry has a `proposal.drafted` event linked to it:
  - Render a "Draft Change Order" section ABOVE the existing fact table
  - Show: proposal_number, total_cents (formatted USD), line-item list with CSI division + description + price
  - Show the DecisionPacket's `safe_next_action` + `required_human_approval` flags
  - "View full CO →" link to `/decisions/<packet_id>` (existing surface)
- Voice canon STAYS BLOCKED — no "Right Hand says..." copy yet (D.2 wires that)
- The "Mark reviewed → actioned" button copy stays the same; what fires changes in D.1.5

**Tests (~5):**
1. Detail view renders proposal section when proposal.drafted exists for the entry
2. Detail view omits proposal section when no draft (skip-rule fired)
3. Total cents formatted as USD ($X,XXX.XX)
4. Line items render with CSI division + description + price
5. "View full CO →" link goes to /decisions/<packet_id>

---

### D.1.5 — Approval action wires to proposal.accepted (~2h)

**File:** `scripts/serve-v15-vertical-slice.ts` (modify `handleRelayCardReview`)

When the operator POSTs `/api/relay-cards/<id>/review` with `outcome: 'actioned'`:
- IF the source relay-card-surfaced event has a linked `proposal.drafted`:
  - Emit a `proposal.accepted` event for the draft
  - Use the same reviewer + reviewed_at as the relay_card.reviewed event
  - source_refs propagate from the proposal.drafted event
- Then emit the existing `relay_card.reviewed` event as today

Response shape gains: `proposal_accepted: <ProposalAcceptedEvent | null>`

**Outcomes that DON'T fire proposal.accepted:**
- `acknowledged` — operator saw the card but no action yet
- `dismissed` — operator rejected the draft (future: maybe emits `proposal.dismissed`?)

**Tests (~4):**
1. POST review actioned + proposal.drafted exists → proposal.accepted event written + returned
2. POST review actioned + no proposal.drafted → just relay_card.reviewed (no proposal.accepted)
3. POST review acknowledged → no proposal.accepted
4. POST review dismissed → no proposal.accepted

---

## 5. The acceptance demo for D.1

After all 5 sub-steps land + deploy:

> Kevin Cheeseman opens https://kerf-v15-internal.fly.dev/field on iPhone at the Henderson site. Voice-captures: *"Owner asked for a wine fridge cabinet retrofit while we're at it — say 20 by 24 by 36, beverage cooler with integrated handle. Also flag this as a CO."*
>
> 4 seconds later, Christian's laptop at the office hits `/relay`. The Henderson card surfaces with:
> - Facts table — `scope_change_flags: ['owner asked for a wine fridge cabinet retrofit']`, `client_decision_flags: ['flag this as a CO']`
> - Drift signal — severity `caution` (scope_change present)
> - **NEW — Draft Change Order section:** Proposal #GGR-2026-525 · $3,420 · 1 line item (CSI 11 30 00 Residential Equipment · Beverage cooler 20×24×36 · $3,420)
> - "Mark reviewed → actioned" button
>
> Christian clicks **Actioned**. Behind the scenes:
> - `relay_card.reviewed` event written
> - `proposal.accepted` event written (Step E wires the actual external send to client; D.1 stops at the accepted event)
>
> Audit trail one click deep: full chain visible from voice → facts → drift → surfacing → CO draft → Policy Gate decision → accepted.

**If we can demo that, D.1 is operational.**

---

## 6. Out of scope for D.1 (Sprint E.1+)

- **External sends** — actual SMS / email to client, e-sign link generation, carrier integration
- **CO PDF generation** — `src/proposal/render.ts` already renders HTML; PDF is a separate render path
- **Right Hand voice canon copy** — "Right Hand says: ..." on the relay card detail (queued for D.2)
- **Crew SMS** — "tell Kevin pull style B" pattern from wireframes
- **Tenant-actuals refresh from QBO** — the kb.ingested flow handles batches today; auto-refresh is V2.0
- **Multi-CSI division handling** — single phrase → multiple divisions is rare; deferred
- **LLM-driven scope-phrase categorization** — D.1 uses deterministic keyword table; Model Router work is May 16+ canon

---

## 7. Sequencing notes

- **D.1.1 (CO play)** + **D.1.2 (cost lookup)** are parallel-safe — independent files, no shared state
- **D.1.3 (scheduler wire-up)** needs D.1.1 + D.1.2 merged first
- **D.1.4 (relay UI)** needs D.1.3 merged first (UI reads events that D.1.3 writes)
- **D.1.5 (review wire-up)** parallel-safe with D.1.4 once D.1.3 is in

**Suggested execution:**
- Claude takes D.1.1 + D.1.2 + D.1.3 (substrate + scheduler wiring)
- Cursor takes D.1.4 (UI) once D.1.3 lands
- Claude takes D.1.5 (review wire-up) in parallel with Cursor's D.1.4

---

## 8. Reporting (required for each PR)

When each sub-step PR is ready, report in this exact shape:

- **Branch:** `feature/...`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `<commands + pass/fail counts>`
- **What could break:** `<honest list — even small risks>`

If the design needs to deviate from this brief, **STOP and report before coding**. PR #198's canon-drift audit showed how spec drift creates downstream tax.

---

## 9. The June 13 connection

Today (after first deploy): we can demo voice → facts → drift → office card.
After D.1: we can demo voice → facts → drift → **office card WITH draft CO + pricing + Policy Gate decision**.
After D.2: add the "Right Hand says..." voice canon copy + morning brief synthesis.
After E.1: add external send (SMS/email + e-sign).

**D.1 is the centerpiece of the June 13 acceptance test.** It's what makes Kerf feel like an *operations system* rather than a *capture tool*.
