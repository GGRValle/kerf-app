# Kerf Knowledge Graph Schema v0.2 — kerf-app architecture spec

**Status:** DRAFT — engineering reference for `@kerf/core` v0.0.1+
**Date:** 2026-05-04
**Owner:** Christian Asdal · GGR
**Repo scope:** `kerf-app/` (Kerf side of the two-repo boundary, locked `2026-04-23.0`)
**Companion (canon-side):** `kerf-cos/Kerf_Knowledge_Graph_Schema_Spec_v0_2.md` · `KERF_Decision_System_Package_v0_1/` · Validator Spec v0.3 · Charter v1.0 + Patches 001/002 · Decision System Research Report v0.2.
**Supersedes:** v0.1 pricing-shaped graph (Apr 29) — re-oriented per D-020 to put the decision flow first and pricing memory underneath.
**Wireframe touchpoints:** `docs/wireframes/kerf_views_master_v1_0.html` · `docs/wireframes/notes.md` · `docs/wireframes/README.md`.

> This document is the kerf-app-side engineering reference. It does not alter Charter, Decision Packet Spec, or Validator Spec. It explains how the canonical chain expressed in those documents lives in `@kerf/core` types, Blackboard events, and projections — and where the boundary to the Platform sits.

---

## 1. Purpose / Thesis

**Kerf's graph is not a price book.** It is *persistent operating memory* for a service business. The graph connects six things, in order, with no shortcuts:

```
Evidence → Claim → Decision → Action → Artifact → Memory
```

Cost data is one important *substrate* the graph reads from when a pricing-bearing Decision is being prepared. The graph also carries source-backed claims, decisions, approved actions, generated artifacts, learning signals, and promoted tenant memory.

Three load-bearing properties follow from the thesis:

1. **Source-or-silent.** Every persisted datum that participates in pricing, scope, external sends, or authority routing carries a source class. No source, no claim, no decision, no action.
2. **Two-stage trust.** The model is not authoritative. An LLM-produced *AltitudePacket* (Stage 1, untrusted) is gated by validators into a *DecisionPacket* (Stage 2, authoritative). The Kerf side owns the Stage 2 shape; the model proposes, Kerf disposes.
3. **Compounding memory.** Every operator interaction with a Decision (approve / edit / reject / escalate / override) becomes a `LearningSignal`. Validated batches of signals can promote a `MemoryRecord` — but never automatically. V10 enforces operator approval before TENANT_MEMORY writes.

The graph is what makes the product *defensible against churn*. After 90 days of use, the cost of leaving Kerf isn't a contract — it's that the tenant's institutional memory lives here.

---

## 2. Canonical Spine

The chain has eight entities in two segments. Stage 1 (untrusted, LLM-side) flows into Stage 2 (authoritative, Kerf-side):

```
EvidenceObject ──► ExtractedClaim ──► AltitudePacket ╮
   (Stage 1 — LLM proposes)                          │  Policy Gate
                                                     │  (validators)
                                                     ▼
                                           ╭── DecisionPacket
                                           │   (Stage 2 — Kerf disposes)
                                           ▼
                                       ActionRecord ──► ArtifactRecord
                                           │
                                           ▼
                                       LearningSignal ──► MemoryRecord
                                           (V10-gated promotion)
```

Three integrity rules govern transitions. They are runtime-enforced by Validator Spec v0.3 and structurally enforced by this schema:

- **R1 — No Decision without basis.** A `DecisionPacket` cannot enter `READY_FOR_REVIEW` without `evidence_ids[]` non-empty (each ID resolving to a real `EvidenceObject`), OR a citation to an existing TENANT_MEMORY `MemoryRecord`, OR an applicable deterministic rule. V7 blocks otherwise.
- **R2 — No price on inference.** A pricing field cannot be marked confirmed when its strongest support is `MODEL_INFERENCE`. V1 blocks.
- **R3 — No memory auto-promotion.** Pricing memory, assemblies, exclusion patterns — none auto-promote. `LearningSignal.proposed_memory_change` is a *suggestion*. V10 enforces operator approval before any TENANT_MEMORY write.

These three rules are why the graph compounds without contaminating itself.

---

## 3. Core Entity Families

The eight entities, mapped from the canon-side spec into kerf-app terms. This section describes *intent and shape*; section 7 gives the proposed TypeScript mapping.

### 3.1 EvidenceObject

The raw input — whatever the contractor captured, in whatever form. One blob, one row.

- **Kinds:** `photo` · `voice_memo` · `voice_transcript` · `lidar_scan` · `plan_pdf` · `plan_dwg` · `email` · `sms` · `estimate_pdf` · `qbo_transaction` · `supplier_quote` · `field_note` · `external_intake_form`.
- **Capture context:** `captured_at` · `captured_by_user_id` · `captured_by_role` · optional GPS (`capture_lat` / `capture_lon` / `capture_geofence_id`) · capture surface (`slack` · `standard_ui` · `voice_intake` · `email_ingest` · `manual`).
- **Provenance:** `source_class ∈ {PROJECT_EVIDENCE, SUPPLIER_OR_SUB_QUOTE, TENANT_MEMORY}`. Most evidence is `PROJECT_EVIDENCE`.
- **Governance:** `read_visibility[]` · `data_class` · `retention_policy`.
- **Lifecycle:** `RAW → EXTRACTED → ARCHIVED → DELETED`.

The blob itself lives behind `uri` — Kerf does not store binary content in the graph. Dedup is an infra-layer concern (R2 / S3).

### 3.2 ExtractedClaim

Atomic facts pulled out of an `EvidenceObject` by Right Hand. One evidence object → 0..N claims.

- **Kinds:** `scope_observation` · `quantity_observation` · `condition_observation` · `price_observation` · `scope_inference` · `client_preference_observation` · `exclusion_observation` · `compliance_flag` · `risk_observation`.
- **Trust marking:** `inference_label ∈ {DIRECT_EVIDENCE, INFERRED, MODEL_GUESS, NEEDS_REVIEW}` · `confidence: 0..1` · `confidence_band ∈ {HIGH, MEDIUM, LOW}`.
- **Structured payload** (claim-kind dependent): `quantity_value` · `quantity_uom` · `cost_amount_cents` · `party_recorded` · `jurisdiction`.
- **Provenance:** `source_class ∈ {PROJECT_EVIDENCE, MODEL_INFERENCE}`.
- **Lifecycle:** `DRAFT → READY → USED → SUPERSEDED`.

A claim with `inference_label = INFERRED | MODEL_GUESS` cannot back a `system_final_*` field on a DecisionPacket without operator review. V8 enforces.

### 3.3 AltitudePacket — Stage 1 (untrusted, LLM-produced)

The LLM's *suggestion*. Carries `model_suggested_*` fields only — never `system_final_*` or `system_baseline_*`. If the model emits those, the Policy Gate ignores them.

- **Identity:** `packet_id` · `event_id` · `tenant_id` · `project_id?` · `workflow ∈ WorkflowKind`.
- **Classification:** intent · urgency · confidence · confidence_band.
- **Inputs:** `extracted_facts` (assembled from one or more `ExtractedClaim`) · `evidence_ids[]` · `claim_ids[]`.
- **Proposal:** `proposed_action` (type · description · reason) · `model_suggested_altitude` · `model_suggested_blackboard_rail` · `model_inference_label`.
- **Hot fields (when applicable):** `money_fields?` · `external_send?` · `recording_intent?` · `compliance_flags?` · `jurisdiction?`.
- **Audit:** `source_model` · `token_usage`.
- **Lifecycle:** `DRAFT → READY_FOR_GATE`.

The AltitudePacket is preserved in audit. Routing never reads it directly.

### 3.4 DecisionPacket — Stage 2 (authoritative, Policy-Gate-emitted)

The atomic V1 product object. Per D-020, every customer-facing flow surfaces decisions, never raw model outputs.

- **Carries forward** everything from AltitudePacket and adds Kerf-owned fields:
  - `system_baseline_altitude` · `system_final_altitude = max(baseline, escalation_floor)` · `system_final_blackboard_rail` · `system_source_status`.
  - `review_requirement ∈ {AUTONOMOUS, OPERATOR_REVIEW, OWNER_REVIEW, FRONTIER_REVIEW}`.
  - `role_visibility[]` · `artifact_effect?` · `memory_effect?`.
  - `decision_type` (16 enum values per Decision Packet Spec — SCOPE / PRICING / MARKUP / ALLOWANCE / EXCLUSION / RISK / CUSTOMER_CLARIFICATION / LEAD_QUALIFICATION / SCHEDULE / PROCUREMENT / SUBCONTRACTOR / CHANGE_ORDER / MEMORY_PROMOTION / SEND_PROPOSAL / OWNER_REVIEW / COMPLIANCE).
  - `question` · `recommendation` · `recommendation_reason` · `options[]` · `financial_impact?` · `risk_impact?`.
  - `policy_gate_result` (full attached `PolicyGateResult`).
- **Lifecycle:** `READY_FOR_REVIEW → APPROVED | REJECTED | EXPIRED | SUPERSEDED | BLOCKED_PENDING_SOURCE`.

The DecisionPacket is the row a UI surface renders and the row an operator approves. Everything downstream — actions, artifacts, memory effects — traces back to a single `decision_id`.

### 3.5 ActionRecord

The approved move resulting from a DecisionPacket. One Decision → 0..N Actions; most produce one.

- **Kinds:** `estimate_drafted` · `proposal_drafted` · `proposal_sent` · `invoice_drafted` · `invoice_sent` · `task_created` · `schedule_event_created` · `purchase_order_drafted` · `memory_record_promoted` · `subcontractor_message_drafted` · `client_message_drafted` · `client_message_sent` · `qbo_transaction_written` · `blackboard_event_emitted` · `iif_export_generated`.
- **Authority basis:** `operator_approval` · `owner_approval` · `delegated_rule` · `system_rule`.
- **External:** `external_destination?` (for sends), `delegated_rule_id?` (for delegated automation).
- **Audit linkage:** `audit_entry_id` (FK into the immutable audit log).
- **Lifecycle:** `PENDING → EXECUTED | FAILED | ROLLED_BACK`.

`*_sent` and `qbo_transaction_written` actions cross the two-repo boundary — see §5.

### 3.6 ArtifactRecord

Generated outputs — estimates, proposals, invoices, schedules, customer messages, COs, IIF exports.

- **Kinds:** `estimate` · `proposal` · `invoice` · `change_order` · `schedule_summary` · `client_message` · `subcontractor_message` · `purchase_order` · `iif_export` · `weekly_status_report` · `auditor_finding`.
- **Source chain:** `source_decisions[]` · `source_evidence[]` (audit-grade traceability).
- **Send state:** `DRAFT → QUEUED → SENT → DELIVERED | BOUNCED | WITHDRAWN`.
- **Governance:** `read_visibility[]` · `data_class ∈ {internal, confidential, client_visible}`.

Artifacts are renderings; they don't carry truth — their backing decisions and evidence do.

### 3.7 LearningSignal

Captures every operator interaction with a DecisionPacket. The substrate from which TENANT_MEMORY compounds.

- **Kinds:** `approval` · `approval_with_edits` · `rejection` · `rejection_with_reason` · `escalation_to_owner` · `escalation_to_frontier` · `field_correction` · `structural_correction` · `exclusion_added` · `exclusion_removed` · `markup_override` · `comment`.
- **Field-level corrections** (when applicable): `field_path` · `prior_value` · `new_value` · `edit_distance` (V12 audit completeness).
- **Operator context:** `operator_user_id` · `operator_role` · `reason_text?`.
- **Memory effect (suggestion only):** `proposed_memory_change?` with `target_entity ∈ {MarkupRule, Assembly, CostItem, TenantSelfPerformProfile, ProjectType, ExclusionPolicy}` and `suggestion_status ∈ {QUEUED_FOR_OPERATOR, APPROVED, REJECTED, EXPIRED}`.

LearningSignals never write memory. They queue suggestions.

### 3.8 MemoryRecord

A promoted tenant knowledge entry. The compounding-knowledge moat lives here.

- **Kinds:** `approved_assembly` · `approved_markup_rule` · `approved_cost_item` · `approved_exclusion_pattern` · `approved_subcontractor_relationship` · `approved_project_type_band` · `approved_self_perform_trade` · `voice_tour_capture` (V1.5).
- **Provenance:** `source_signal_ids[]` (FK → `LearningSignal[]` that produced the promotion) · `promoted_by_user_id` · `promoted_at`.
- **Source class:** always `TENANT_MEMORY` once promoted.
- **Versioning:** `superseded_by?` (chain of supersession; never delete).

V10 enforces: every MemoryRecord must trace to one or more LearningSignals. No direct writes.

### 3.9 Guided Onboarding Ingestion

The eight entities in §3.1–§3.8 describe *what's in the graph and how it relates*. This subsection describes *where the graph's first rows come from*: an onboarding-driven question flow rather than a configuration page. Per [`docs/ff_proposal_first_roadmap.md`](../ff_proposal_first_roadmap.md) §"Onboarding Is Ingestion, Not Setup", a new tenant's first 30–60 minutes with Kerf are a Right-Hand-led structured interview, not form-filling.

**The mapping rule:** every onboarding answer becomes typed graph rows that flow through the same Stage 1 → Stage 2 spine as runtime decisions. There is no "settings table" that bypasses the spine. Onboarding answers are first-class evidence with `source_class = TENANT_MEMORY` (or `PROJECT_EVIDENCE` when the answer cites a specific past project).

#### 3.9.1 Onboarding answer → graph entity mapping

| Onboarding capture | Becomes (Stage 1) | Stage 2 / promoted | Notes |
|---|---|---|---|
| Company identity (legal name, EIN, license #s, jurisdictions, brand) | `EvidenceObject` (kind=`external_intake_form`, `source_class=TENANT_MEMORY`) → `ExtractedClaim[]` (one per field) | `company_profile` row + `Tenant` metadata | Per D-031 Company / HR Operations Lane (DRAFT canon-side); margin-bearing fields gated to owner/MoO |
| Service areas | `EvidenceObject` → `ExtractedClaim` (kind=`scope_observation`) | `MemoryRecord` (kind=`approved_project_type_band`) per metro / jurisdiction | Used to flag drafts quoting work outside captured service area |
| Client types (homeowner / commercial / GC mix) | `EvidenceObject` → `ExtractedClaim` (kind=`client_preference_observation`) | `MemoryRecord` (kind=`approved_project_type_band` with client-type tag) | Tunes Right Hand's draft register |
| Labor rates (per role) | `EvidenceObject` (kind=`field_note`, source `external_intake_form`) → `ExtractedClaim` (kind=`price_observation`, `source_class=TENANT_MEMORY`) | `LaborResource` row(s) backing per-role `labor_rate` per §6.1 | Owner / MoO only; backs cost projections without per-project re-entry |
| Materials posture (preferred brands, "always vs never") | `EvidenceObject` → `ExtractedClaim` (kind=`scope_observation`) | `MemoryRecord` (kind=`approved_assembly` placeholder + `approved_exclusion_pattern` for "never" entries) | Drives layered Cost KB retrieval |
| Vendor / supplier costs | `EvidenceObject` (kind=`supplier_quote` or `external_intake_form`) → `ExtractedClaim` (kind=`price_observation`, `source_class=SUPPLIER_OR_SUB_QUOTE`) | `CostItem` rows + `current_pricing` view per D-030 | Freshness disclosure required on Decision Cards consuming these per D-030 |
| Crew roles | `EvidenceObject` → `ExtractedClaim` (kind=`scope_observation`) | `crew` rows + `role_assignment` rows per §6.1 | PM-readable; sensitive HR fields owner-only |
| Proposal style (tone, depth, attachments) | `EvidenceObject` (kind=`external_intake_form`) → `ExtractedClaim` (kind=`client_preference_observation`) | `MemoryRecord` (kind=`approved_assembly` for boilerplate; new memory subkind `approved_proposal_style` reserved for v0.3) | Used as draft scaffold by Right Hand; render-time only |
| Margin / risk guardrails | `EvidenceObject` → `ExtractedClaim` (kind=`scope_observation`) | `MemoryRecord` (kind=`approved_markup_rule`) + Policy Gate authority floor config | Owner / MoO only per V6 / Charter §VI.2 AT-004 |
| Approval rules | `EvidenceObject` → `ExtractedClaim` (kind=`scope_observation`) | `MemoryRecord` (kind=`approved_markup_rule` + `approved_self_perform_trade` for trade-by-trade authority) | Drives Policy Gate `system_baseline_altitude` per `decision_type` |
| Source documents (sample contracts, scope templates, warranty docs) | `EvidenceObject` (kind=`plan_pdf` / `estimate_pdf` / `field_note`) | Used as Right Hand draft scaffolding; promoted to `MemoryRecord` (kind=`approved_assembly` boilerplate) only via operator-approved LearningSignals | Source documents stay first-class evidence; the *reusable patterns* extracted from them are what promote |
| Past project examples | `EvidenceObject` (kind=`field_note` per project) + `EvidenceObject` (kind=`estimate_pdf` if attached) → `ExtractedClaim[]` (multiple per project) | `MemoryRecord` (per-project, kind=`approved_assembly`) once V10 promotes the per-project lessons | Each becomes a citable comparison anchor for future drafts ("this kitchen is similar to the Asdal close in October") |

#### 3.9.2 Promotion path

Onboarding answers do not auto-promote to `MemoryRecord`. They follow the same V10-gated promotion path as any LearningSignal: the operator confirms each captured answer; the confirmation emits a `LearningSignal` of kind `approval`; V10 promotes to `MemoryRecord` only on explicit operator action.

The onboarding *session itself* is the operator action — Right Hand drafts the captured answers as a batch; the operator approves the batch; V10 promotes the entire batch to `MemoryRecord` rows. This preserves the no-auto-promotion rule (R3, §2) without making the operator click 12 separate buttons.

#### 3.9.3 Proposal context retrieval

The downstream payoff: when Right Hand drafts a proposal follow-up later, the layered retrieval over the source-class taxonomy (§4) reads the new `TENANT_MEMORY` rows the same way it reads any other tenant memory:

1. **Tenant memory layer** (`source_class=TENANT_MEMORY`, ranked above `KERF_SEED`) returns onboarding-captured `LaborResource`, `MemoryRecord`, `MarkupRule`, `approved_assembly` rows specific to the tenant.
2. **Project evidence layer** (`source_class=PROJECT_EVIDENCE`) overlays the current project's specifics.
3. **Cost KB layer** (`source_class=KERF_SEED` ↓) provides bootstrap defaults only when tenant memory has no answer.
4. **Public reference layer** narrows further down per §4.

The drafted proposal cites the layered chain explicitly via the `Citation` rows (per V14 Pathway integrity). The F&F recipient sees, on the Decision Card audit panel, that the draft references *the operator's own rates and material posture* — not generic defaults — because onboarding produced typed memory the proposal surface reads.

#### 3.9.4 What's deferred — captured in graph, not yet UI-widened

The HR / Schedule / Documents / Comms lanes (D-031 / D-032 / D-033 / D-034) **all participate in the same onboarding capture pattern** — the entities they introduce (`employee`, `crew`, `certification`, `equipment`, `schedule_event`, `project_message`, `to_do_item`, etc.) are populated from onboarding answers the same way `LaborResource` and `MemoryRecord` are. The schema is ready; the capture flow ingests them.

**What's deferred is the UI-widening, not the graph capture.** The F&F demo and the W1 surface render proposal-loop entities only. Surfacing HR / Schedule / Documents / Comms as their own UI modules is W2+ work (and material scope per D-031 through D-034). The onboarding session can populate those lanes; the proposal-review surface doesn't yet show them.

This sequencing is intentional. The F&F pitch is "Kerf knows your company because you told it" — proven by the proposal review surface citing tenant memory. Adding HR / Schedule / Documents / Comms surfaces before that pitch lands risks turning the demo into a "yet another contractor SaaS" reading instead of a "decisions, not dashboards" reading.

---

## 4. Source Layers

Source-or-silent applies to every datum that participates in pricing, scope, external sends, or authority routing. The layers are *ranked by trust* and *must not collapse* into a single undifferentiated answer. Validator V14 (Pathway integrity) enforces the no-contamination rule at retrieval time.

| Rank | Layer | When to use | V1 status |
|---:|---|---|---|
| 1 | **PROJECT_ACTUAL** | Closed-job actuals from QBO post-reconciliation. Highest trust for tenant-comparable scope. | Read-only into the graph; Platform side owns writes. |
| 2 | **TENANT_MEMORY** | Approved assemblies, markup posture, exclusions, style. The compounding moat. | Promoted via `MemoryRecord`; V10-gated. |
| 2a | (project sub-layer) **PROJECT_EVIDENCE** | Scope, conditions, quantities, risks observed in the *current* project. | `EvidenceObject.source_class`. |
| 3 | **ESTIMATE_OVERRIDE** | Operator-final per-estimate overrides. Layer C. | `LearningSignal.signal_kind = field_correction \| markup_override`. |
| 4 | **SUPPLIER_OR_SUB_QUOTE** | Quote-backed pricing. High during quote validity; volatile after. | V3 (Quote expiration) enforces freshness. |
| 5 | **NETWORK_AGGREGATE** | Anonymized cross-tenant context. Requires EULA + consent. | Schema reserves the enum value; **no contributing rows in V1**. Deferred to V2.0α. |
| 6 | **KERF_SEED** | Bootstrap defaults. Medium trust if reviewed; low if placeholder. | `kerf_schema_v0_1/seed/` already ships 264 priced items + 55 productivity rates. |
| 7 | **PUBLIC_REFERENCE** | Narrow measured facts only. Three sub-classes: | |
| 7a | `PUBLIC_GOVERNMENT_REFERENCE` | BLS OEWS for wage and geography baseline. **V11 blocks BLS-as-pricing.** | |
| 7b | `INDUSTRY_BENCHMARK` | NAHB margin context, ENR cost indices. License-sensitive. | |
| 7c | `CLASSIFICATION_STANDARD` | CSI MasterFormat — concepts free, redistributed content license-sensitive. | |
| 8 | **MODEL_INFERENCE** | Lowest. Draft claims and suggestions only. **V8 forces inference labeling. V1 blocks model-only pricing.** | |

**No-contamination rule (V14):**

> Public reference, Kerf seed, tenant memory, network aggregate, estimate override, and project actuals must not collapse into one undifferentiated answer. Each must remain individually citable.

Implementation: every persisted datum that participates in routing, pricing, or sends carries a `source_class` field plus a `Citation` row (with `source_id`, `citation_chain[]`, `is_fresh`, `expires_at?`). The retrieval layer always returns the *layered* answer with each layer's contribution preserved.

---

## 5. System Boundaries

Five components, with hard contracts between them. Crossing a boundary is a wire-format operation, not a function call.

### 5.1 Blackboard — append-only working memory

**What it is:** the immutable event log of *what happened*, with role-scoped reads.
**Source of truth for:** the audit-of-truth, the order of events, the causal chain, the working memory of the system.
**Lives in:** `kerf-app/src/blackboard/` (this repo, Kerf side).
**Interface:** `EventLog` (append / byId / byEntity / byCorrelation / all / subscribe). In-memory in W1; durable store in W3.
**Invariant:** every `Event` is `Object.freeze`-d at append; never mutated. Corrections are new events with `correlationId` tying them to the original.

The Blackboard does not store the *current state* of any entity. UI surfaces read from *projections* (§8) over the event log.

### 5.2 Kerf Knowledge Base — durable business brain

**What it is:** the durable graph behind the Blackboard event stream — clients, projects, proposals, costs, labor rates, employees, materials, decisions, project memory.
**Source of truth for:** pricing memory (Cost KB, Assembly, MarkupRule, LaborResource, RegionModifier, ProjectType, PhaseCodeReconciliation, TenantSelfPerformProfile), TENANT_MEMORY, the 8 decision-flow entities (§3), governance entities (PolicyGateResult, ValidatorResult, AuditEntry), and the User / Tenant tables.
**V1 implementation:** schema declared in this repo as TypeScript types; SQL DDL lives in `kerf-cos/_docs/architecture/kerf_schema_v0_1.sql` and the future `kerf_schema_v0_2.sql` migration.
**V1 read path:** projections over `Event[]` (§8). V1.5+ may add a materialized read store.

The Knowledge Base *contains* the graph. The graph is what the Knowledge Base looks like when you draw the relations.

### 5.3 Right Hand — agentic operator

**What it is:** the LLM-backed agent that reads/retrieves/drafts against graph context.
**Outputs:** AltitudePackets (Stage 1) — never DecisionPackets directly.
**Inputs:** EvidenceObjects + ExtractedClaims + relevant TENANT_MEMORY + Cost KB context + active Blackboard rails.
**V1 model split:** Llama 70B (Groq) for the cheap/fast tier (latency-bound interactive surfaces); Claude via abstraction for the frontier tier (model-agnostic). Per `project_kerf_compute_posture.md`.
**Boundary:** Right Hand never marks `system_final_*` fields. Those are owned by the Policy Gate.

### 5.4 Policy Gate — authority/safety wall

**What it is:** the deterministic validator that turns AltitudePackets into DecisionPackets.
**V1 validators:** 18 deterministic checks (V1–V18) per Validator Spec v0.3. The wall a packet crosses to become authoritative.
**Outputs:** `PolicyGateResult` attached to every DecisionPacket — `passed` · `validator_results[]` · `safe_next_action` · `blocked_reasons[]` · `corrected_fields` · `required_human_approval`.
**Lives in:** `kerf-app/src/policy/` (proposed; not yet present in W1 code).

The Policy Gate does not call out to LLMs. It is purely deterministic. That is what makes V1 trust-defensible without needing model audits.

### 5.5 UI — projection layer, not source of truth

**What it is:** every screen the operator, PM, or client sees.
**Where it reads from:** projections over the Blackboard (§8). Never directly from the Knowledge Base; never from raw events without permission filtering.
**Wireframe canon:** `docs/wireframes/kerf_views_master_v1_0.html` (21 frames as of 2026-05-04). Voice-driven, mobile-dominant; desktop is a projection of the same data at higher density.
**Invariant:** the UI cannot bypass the Policy Gate. Every state-changing UI action either creates an EvidenceObject (raw) or approves/edits/rejects a DecisionPacket (gated).

The UI is plural. Every persona (Owner / MoO / PM / Field Super / Office / Sub / Client) sees a *different projection* over the same underlying graph. Permissions live at the projection boundary, not the surface.

### 5.6 Two-repo boundary (locked `2026-04-23.0`)

| Owns | Kerf side (`kerf-app/`) | Platform side (separate repo) |
|---|---|---|
| **UI surfaces** | All operator + admin + client surfaces | (none) |
| **Blackboard** | Append-only event log + projections | (none) |
| **Decision flow entities** | Evidence / Claim / AltitudePacket / DecisionPacket / ActionRecord (drafts) / LearningSignal | (none) |
| **Cost KB schema + projections** | Schema, projections, retrieval | (none) |
| **Policy Gate** | All 18 validators + PolicyGateResult emission | (none) |
| **Money writes** | (none — call contract) | All `money.approved`, `qbo_transaction_written`, IIF export |
| **Audit-of-record** | (none — call contract) | The legally-binding event copy |
| **External sends** | Drafted, gated, queued | All `*_sent` execution |
| **`locked` lifecycle** | (cannot write) | Only the Platform writes `locked` |

**Communication:** REST contracts in `src/contracts/platform/types.ts` versioned at `2026-04-23.0`. Bumping the contract version follows the wire-vs-internal rule (CLAUDE.md §3.9).

---

## 6. Company Admin / HR Lane

Per D-031 (Company / HR Operations Lane Schema, DRAFT) and the wireframe Flow C surfaces (F·10 / F·11 / F·12 in the Views Master). Company / HR data participates in the same graph but with stricter visibility.

### 6.1 Entities

- **`company_profile`** — tenant-level company metadata (legal name, EIN, license numbers, jurisdictions, primary trade, brand assets). Owner-only writes; PM read of non-sensitive fields.
- **`employee`** — person records, scoped to tenant. Carries `role` · `crews[]` · `start_date` · `tenure_months` · `phone` · `email` · `preferred_language` · `home_address` (sensitive) · `emergency_contact` (sensitive). Job-relevant fields render to PMs; sensitive PII is owner/MoO-only.
- **`role_assignment`** — junction connecting `employee` to `Role` (`owner` · `moo` · `pm` · `field_super` · `office` · `sub` · `client`). One employee may hold multiple roles (e.g., owner + pm).
- **`labor_rate`** — per-employee rate composition: `base_wage_cents_per_hour` · `burden_multiplier` · `loaded_rate_cents_per_hour` · `effective_from` · `effective_to?`. **Owner / MoO only.** Backs `LaborResource` for cost projections.
- **`certification`** — employee certifications (OSHA-30, OSHA-10, asbestos, lead, trade-specific). Carries `expires_at`. PM-visible (job-relevance), but full certificate file is HR-sensitive.
- **`hr_note`** — disciplinary notes, performance feedback, incidents. **Owner / MoO only.** Subject to `data_class = sensitive_pii` and `retention_policy = until_close+7y`.
- **`crew`** — named crew with `crew_lead_employee_id` and `member_employee_ids[]`. PM-readable.
- **`time_off`** — `employee_id` · `start_at` · `end_at` · `kind ∈ {pto, sick, jury, unpaid, leave}` · `approved_by`. PM sees scheduling-relevant entries; HR-sensitive details (FMLA, medical) are owner-only.
- **`policy`** — handbook entries, travel rules, expense rules. Tenant-readable; not HR-sensitive.
- **`equipment`** — tools, vehicles, equipment assigned to employees or crews. PM-readable; theft / damage incidents are owner/MoO.

### 6.2 Read lattices

Three projections over the same underlying rows:

| Lattice | Audience | Visible | Hidden |
|---|---|---|---|
| **Owner / MoO** | Christian, future MoO | All fields, all rows, including rates / incidents / hr_notes | (nothing) |
| **PM-safe staffing** | PMs (Mike) | Names · roles · current project · weekly availability · job-relevant certs · phone · email | Rates · hire-date · incidents · hr_notes · off-project assignments · disciplinary notes · home address |
| **Self** | Employees (V2.x) | Their own row, their cert expiry alerts, their time-off, their crew membership | Other employees' details · rates · hr_notes |

The PM-safe projection is *structural*, not visual. The PM's read query joins to `role_assignment` and *never selects* the rate / incident / hr_note tables. F·12 in the wireframe canon shows the absence: there is no "Rates" or "Incidents" sidebar item to hide — those nav entries simply do not exist for the PM. Permissions enforced at the projection layer per D-031.

### 6.3 Margin privacy

The `margin` resource is canonical and owner/MoO-only per `permissions/matrix.ts`. Any `cost_amount_cents` · `markup_pct` · `markup_rule_id` field on a CostItem, MarkupRule, LaborResource, Assembly, ArtifactRecord, or DecisionPacket is filtered at projection time. The UI cannot bypass — see §5.5.

This is enforced *three* ways:

1. **Schema** — `read_visibility[]` on every margin-bearing entity persists with `⊆ {owner, admin}` (per Charter §VI.2 AT-004).
2. **RLS Pattern B** — PostgreSQL row-level security at the persistence layer (§10).
3. **Permission matrix** — `permissions/matrix.ts` rejects margin reads from non-owner/MoO roles before any projection runs.

Hard prohibition (CLAUDE.md §6): margin never appears in any client-facing render path — proposals, change orders, signed documents, client-share portal, exports, anything the client touches.

---

## 7. Proposed TypeScript Mapping

Outline only. **Do not implement in this PR.** This section sketches the proposed shape so engineering can scope the W2/W3 PRs.

The existing types in `src/blackboard/types.ts` already cover most of the *event* layer. What's missing is the persistent *entity* layer for the decision flow (§3) and HR lane (§6).

### 7.1 New EventKind values to add

The W0 increment 1 already added `data_class` · `retention_policy` · `privilege_class` · `WorkflowKind` · `ActionClass` · `DecisionAuthority` · `DecisionAltitude`. The decision-flow chain needs these *additional* event kinds:

```ts
// to be appended to EventKind in src/blackboard/types.ts
type EventKind =
  // ...existing 50+ kinds...

  // Stage 1 — LLM proposes
  | 'evidence.captured'
  | 'evidence.archived'
  | 'claim.extracted'
  | 'claim.superseded'
  | 'altitude.drafted'
  | 'altitude.ready_for_gate'

  // Stage 2 — Kerf disposes
  | 'policy_gate.evaluated'
  | 'decision_packet.surfaced'      // alias / replaces decision.surfaced for full-spec packets
  | 'decision_packet.approved'
  | 'decision_packet.rejected'
  | 'decision_packet.expired'
  | 'decision_packet.superseded'
  | 'decision_packet.blocked_pending_source'

  // Downstream
  | 'action.executed'
  | 'action.failed'
  | 'action.rolled_back'
  | 'artifact.rendered'
  | 'artifact.sent'
  | 'artifact.delivered'
  | 'artifact.bounced'
  | 'artifact.withdrawn'

  // Compounding
  | 'learning_signal.captured'
  | 'memory.promoted'
  | 'memory.superseded'
  | 'memory.retired'

  // HR lane
  | 'employee.hired'
  | 'employee.role_changed'
  | 'employee.terminated'
  | 'labor_rate.updated'
  | 'certification.recorded'
  | 'certification.expiring'
  | 'time_off.requested'
  | 'time_off.approved'
  | 'time_off.denied'
  | 'hr_note.recorded';
```

### 7.2 Entity payload interfaces (sketch)

Co-located with existing payloads in `src/blackboard/types.ts`:

```ts
// === §3.1 EvidenceObject ===
export type EvidenceKind =
  | 'photo' | 'voice_memo' | 'voice_transcript' | 'lidar_scan'
  | 'plan_pdf' | 'plan_dwg' | 'email' | 'sms' | 'estimate_pdf'
  | 'qbo_transaction' | 'supplier_quote' | 'field_note' | 'external_intake_form';

export type EvidenceSourceClass =
  | 'PROJECT_EVIDENCE' | 'SUPPLIER_OR_SUB_QUOTE' | 'TENANT_MEMORY';

export interface EvidenceCapturedPayload {
  evidenceId: EntityId;
  evidenceKind: EvidenceKind;
  uri: string;
  mimeType?: string;
  bytes?: number;
  capturedAt: ISO8601;
  capturedByUserId?: ActorId;
  capturedByRole?: Role;
  capturedViaSurface?: 'slack' | 'standard_ui' | 'voice_intake' | 'email_ingest' | 'manual';
  captureLat?: number;
  captureLon?: number;
  captureGeofenceId?: EntityId;
  sourceClass: EvidenceSourceClass;
  // governance fields (data_class, retention_policy) ride on Event itself
}

// === §3.2 ExtractedClaim ===
export type ClaimKind =
  | 'scope_observation' | 'quantity_observation' | 'condition_observation'
  | 'price_observation' | 'scope_inference' | 'client_preference_observation'
  | 'exclusion_observation' | 'compliance_flag' | 'risk_observation';

export type InferenceLabel =
  | 'DIRECT_EVIDENCE' | 'INFERRED' | 'MODEL_GUESS' | 'NEEDS_REVIEW';

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ClaimExtractedPayload {
  claimId: EntityId;
  evidenceId: EntityId;
  claimKind: ClaimKind;
  text: string;
  inferenceLabel: InferenceLabel;
  confidence: number;            // 0..1
  confidenceBand: ConfidenceBand;
  structured?: {
    quantityValue?: number;
    quantityUom?: string;        // sf | lf | ea | hr
    costAmountCents?: Cents;
    partyRecorded?: string;
    jurisdiction?: string;       // ISO 3166-2
  };
  sourceClass: 'PROJECT_EVIDENCE' | 'MODEL_INFERENCE';
  createdByModel: string;        // e.g. 'llama-4-scout-groq'
}

// === §3.3 / §3.4 Altitude + Decision Packets ===
// Schema reference: kerf-cos Validator Spec v0.3 §2.1.1 / §2.1.2
// To be implemented in src/decision/types.ts (proposed new module).
//
// Shape sketch only — full field list is owned by Validator Spec; Kerf-side
// types must match exactly so the Policy Gate's TypeScript can typecheck.

export type AuthorityLevel =
  | 'AUTONOMOUS' | 'OPERATOR_REVIEW' | 'OWNER_REVIEW' | 'FRONTIER_REVIEW';

export type DecisionType =
  | 'SCOPE_DECISION' | 'PRICING_DECISION' | 'MARKUP_DECISION'
  | 'ALLOWANCE_DECISION' | 'EXCLUSION_DECISION' | 'RISK_DECISION'
  | 'CUSTOMER_CLARIFICATION_DECISION' | 'LEAD_QUALIFICATION_DECISION'
  | 'SCHEDULE_DECISION' | 'PROCUREMENT_DECISION' | 'SUBCONTRACTOR_DECISION'
  | 'CHANGE_ORDER_DECISION' | 'MEMORY_PROMOTION_DECISION'
  | 'SEND_PROPOSAL_DECISION' | 'OWNER_REVIEW_DECISION' | 'COMPLIANCE_DECISION';

export type DecisionPacketStatus =
  | 'READY_FOR_REVIEW' | 'APPROVED' | 'REJECTED'
  | 'EXPIRED' | 'SUPERSEDED' | 'BLOCKED_PENDING_SOURCE';

// AltitudePacket and DecisionPacket interfaces are defined in detail in
// kerf-cos Kerf_Knowledge_Graph_Schema_Spec_v0_2.md §4.3 / §4.4. Mirroring
// them here when the W2 PR lands.

// === §3.5 ActionRecord ===
export type ActionKind =
  | 'estimate_drafted' | 'proposal_drafted' | 'proposal_sent'
  | 'invoice_drafted' | 'invoice_sent' | 'task_created'
  | 'schedule_event_created' | 'purchase_order_drafted'
  | 'memory_record_promoted' | 'subcontractor_message_drafted'
  | 'client_message_drafted' | 'client_message_sent'
  | 'qbo_transaction_written' | 'blackboard_event_emitted' | 'iif_export_generated';

export type ActionAuthorityBasis =
  | 'operator_approval' | 'owner_approval' | 'delegated_rule' | 'system_rule';

export type ActionStatus =
  | 'PENDING' | 'EXECUTED' | 'FAILED' | 'ROLLED_BACK';

// === §3.7 LearningSignal ===
export type LearningSignalKind =
  | 'approval' | 'approval_with_edits' | 'rejection' | 'rejection_with_reason'
  | 'escalation_to_owner' | 'escalation_to_frontier'
  | 'field_correction' | 'structural_correction'
  | 'exclusion_added' | 'exclusion_removed' | 'markup_override' | 'comment';

export type MemoryTargetEntity =
  | 'MarkupRule' | 'Assembly' | 'CostItem'
  | 'TenantSelfPerformProfile' | 'ProjectType' | 'ExclusionPolicy';

export type MemorySuggestionStatus =
  | 'QUEUED_FOR_OPERATOR' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

// === §6 HR lane ===
export type EmployeeRole = Role;  // re-uses existing Role union

export interface EmployeeRecordPayload {
  employeeId: EntityId;
  displayName: string;
  preferredLanguage: 'en' | 'es';
  primaryRole: EmployeeRole;
  startDate: ISO8601;
  // PM-safe job-relevant fields
  phone?: string;
  email?: string;
  // owner/MoO-only PII (data_class = 'sensitive_pii' on Event)
  homeAddress?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
}

export interface LaborRateRecordPayload {
  laborRateId: EntityId;
  employeeId: EntityId;
  baseWageCentsPerHour: Cents;
  burdenMultiplier: number;        // typically 1.40
  loadedRateCentsPerHour: Cents;   // computed; persisted for query speed
  effectiveFrom: ISO8601;
  effectiveTo?: ISO8601;
  // privilege_class on Event = 'hr' | 'margin' (LLM bypass)
}

// HR Note, Time Off, Certification, Crew, Equipment, Policy payloads
// follow the same pattern. data_class + retention_policy + privilege_class
// ride on the Event envelope; payload carries the entity shape only.
```

### 7.3 Boundary on TS implementation

- **Keep types.** Add the new entity payloads to `src/blackboard/types.ts` (or a sibling `src/decision/types.ts` if `types.ts` exceeds 800 LOC).
- **Mirror Validator Spec.** AltitudePacket and DecisionPacket interfaces must match Validator Spec v0.3 §2.1 field-for-field. Drift is a typecheck failure.
- **No money math here.** Money fields appear on payloads as `Cents` — the actual money writes go through Platform contracts (`src/contracts/platform/types.ts`).
- **Lifecycle on event, entity on payload.** The 4-state lifecycle (`draft → recommended → approved → locked`) lives on `Event`, not the entity payload. Payload carries the row's *content*; Event carries the *state transition*.

---

## 8. Projection Plan

The graph is a *projection* over the Blackboard, not a separate store. V1 ships projection shapes; V1.5 adds materialization for read performance.

### 8.1 Existing projections (W1)

| Projection | File | Inputs | Use |
|---|---|---|---|
| **Decisions** | `src/projections/decisions.ts` | `decision.surfaced` · `decision.resolved` events | Decision Queue, F·03 |
| **System State** | `src/projections/systemState.ts` | `entity.created` · `entity.lifecycle_changed` · `approval.*` · `money.*` | KPI tiles, F·06 |
| **Live Memory** | `src/projections/liveMemory.ts` | `memory.noted` events | Memory rail |
| **Graph (V1.5+)** | `src/projections/graph.ts` | `entity.created` · `entity.lifecycle_changed` · `relation.created` | Lineage strip · explorer view |

### 8.2 Required new projections (W2 / W3)

| Projection | Derives from | Powers (wireframe frame) |
|---|---|---|
| **Evidence stream** | `evidence.captured` events filtered by project · time window | F·07b project channel feed |
| **Claim ledger** | `claim.extracted` chained to `evidence.captured` via `evidenceId` | Audit drill-in: "what claims came out of this photo?" |
| **Decision Packet projection** | Stage 2 events: `policy_gate.evaluated` + `decision_packet.surfaced` + lifecycle | F·14 drift card · F·03 queue · F·15 punch close-out gating |
| **Action ledger** | `action.executed` chained to `decision_packet.approved` via `decisionId` | Audit drill-in: "what actually got done?" |
| **Artifact library** | `artifact.rendered` + `artifact.sent` + `artifact.delivered` per project | F·17 desktop documents library · F·16 mobile retrieval |
| **Learning signal stream** | `learning_signal.captured` per tenant, ranked by `field_path` frequency | Auditor cadence (V12) · memory promotion suggestions |
| **Memory promotion queue** | `learning_signal.*` with `proposed_memory_change.suggestion_status = QUEUED_FOR_OPERATOR` | Pending promotions surface (V1.5) |
| **HR lane projections** | Employee + role_assignment + labor_rate + certification + time_off events, role-filtered | F·10 / F·11 / F·12 (Owner / MoO / PM lattices) |
| **Causal graph** | All events, walking `causedBy` and `correlationId` links | F·07 movement rail · explorer view (V1.5) |

### 8.3 Source-ref-driven retrieval

Right Hand's retrieval contract (per Llama-70B Retrieval Contract v0.1) requires the projection layer to return *layered* answers, not collapsed answers. A pricing question for `(trade=cabinetry, region=US-CA-92064, line=base_cabinet_lf)` returns:

```
{
  layers: [
    { source_class: "TENANT_MEMORY", value_cents: …, citations: […], freshness: … },
    { source_class: "ESTIMATE_OVERRIDE", value_cents: …, citations: […], freshness: … },
    { source_class: "PROJECT_ACTUAL", value_cents: …, citations: […], freshness: … },
    { source_class: "KERF_SEED", value_cents: …, citations: […], freshness: … },
    { source_class: "PUBLIC_REFERENCE", value_cents: …, citations: […], freshness: … },
  ],
  recommended: { source_class: "TENANT_MEMORY", value_cents: …, reason: "…" }
}
```

The model sees all layers with their citations. The recommendation is a deterministic projection over the layers (V14-validated). The model never collapses layers itself.

### 8.4 Causal links and the Decision Packet graph

Causal links (`Event.causedBy`) are the spine of the post-hoc graph projection (V1.5). Walking `causedBy` from a `decision_packet.approved` event yields the chain:

```
decision_packet.approved
  ↑ causedBy
policy_gate.evaluated
  ↑ causedBy
altitude.ready_for_gate
  ↑ causedBy
claim.extracted (×N)
  ↑ causedBy
evidence.captured
```

Every approved decision is auditable back to its evidence — and forward to its actions, artifacts, and learning signals. `correlationId` ties events from a single user interaction (e.g., one capture session producing voice + photo + LiDAR + multiple claims).

---

## 9. Access / Privacy

### 9.1 Visibility lattices

| Lattice | Purpose | Field on entity |
|---|---|---|
| **Read** | Who can SEE this row | `read_visibility: ReadRole[]` |
| **Authority** | Who can DECIDE on this row | `authority_required: AuthorityLevel` (on AltitudePacket / DecisionPacket only) |
| **Altitude** | What altitude class is this decision | `system_baseline_altitude` + `system_final_altitude` (on DecisionPacket only) |

The three lattices are **orthogonal**. A row may be PM-readable but Owner-decidable. A decision may be at altitude L0 but require frontier review (L4 escalation_floor). All three are evaluated per request.

### 9.2 Boundaries

- **Clients never see raw graph internals.** Client-facing surfaces (proposals, change orders, client portal, e-sig view) read from a *client-share projection* that strips margin, source-class chains, validator results, and any internal field. The client sees the *artifact*, not the artifact's provenance graph.
- **PMs see staffing-safe projections only.** Per §6.2 — PM read lattice excludes rates, incidents, hr_notes, off-project assignments, hire-date / tenure. The projection layer does the filtering, not the UI.
- **HR / margin / labor-rate data needs stricter visibility.** `read_visibility ⊆ {owner, admin}` on every margin- or HR-bearing row. RLS Pattern B enforces at the persistence layer (§10).
- **Audit details are internal.** PolicyGateResult, ValidatorResult, AuditEntry, model_token_usage, and source-citation chains are owner / MoO / system roles only. No client sees a validator outcome.
- **Privileged rows bypass LLMs.** `Event.privilege_class ∈ {'attorney_client', 'hr', 'capital', 'margin'}` events are filtered from any LLM payload at the gateway. `isPrivilegedEvent` is the canonical check (`src/blackboard/privilege.ts`).

### 9.3 Spanish-native parity

Every render-to-user string must have an `I18nKey` with both EN and ES values. TypeScript fails compile on EN/ES drift (intentional). User-entered data (decision titles, memory body, scope descriptions, evidence text, learning_signal reason_text) is **not** i18n — it's stored canonically in the language it was authored in.

This applies to every entity in §3 and §6 with display strings — `display_name` always pairs with `display_name_es`, and they must both be present.

---

## 10. Acceptance Tests / Implementation PR Sequence

After this doc lands, propose six PRs. Each is small, reviewable, and lands behind the existing W0 increments.

| PR | Scope | Author | Reviewer | Tests |
|---:|---|---|---|---|
| **KG-1** | EvidenceObject + ExtractedClaim event kinds + payloads. Add to `src/blackboard/types.ts` + a fixture in `src/test-fixtures/`. | Codex | Claude | Unit: payload shape · `data_class` propagation · `evidence.captured → claim.extracted` chain via correlationId. |
| **KG-2** | Decision Packet integration: align `decision.surfaced` payload with Decision Packet Spec field list. Promote existing projection's `Decision` type to `DecisionPacket`. | Claude | Codex | Update `tests/blackboard-schema.test.ts` to assert all 17 fields on a sample DecisionPacket. |
| **KG-3** | Source taxonomy enum + `SourceRef` extension. Add the 10 source classes to a shared union; require `source_class` on events that participate in pricing / sends / authority routing. | Codex | Claude | Schema test: every event with `workflow ∈ {invoice_followup, proposal_followup, drift_detection}` carries `source_class`. |
| **KG-4** | LearningSignal + MemoryRecord event kinds. Wire `decision_packet.approved` + `*.rejected` to emit a LearningSignal. V10 stub (suggestion-only). | Claude | Codex | Test: every approval/rejection emits a LearningSignal; no MemoryRecord write without operator promotion. |
| **KG-5** | HR lane entities: Employee, Role assignment, LaborRate, Certification, TimeOff, HRNote, Crew. Add `privilege_class = 'hr'` enforcement. PM-safe projection. | Codex | Claude | Permission matrix test: PM cannot read rate / hr_note / incidents. F·12 staffing fixture renders without those fields. |
| **KG-6** | Causal graph projection (V1.5 prep): walk `causedBy` chains; emit GraphNode + GraphEdge for the decision-flow chain. Hook into existing `src/projections/graph.ts`. | Claude | Codex | Test: from `decision_packet.approved`, walking `causedBy` resolves the full Evidence→Claim→Altitude→Decision chain. |

Acceptance test mapping (each AT in Charter §VI / Validator Spec v0.3 maps to a PR):

| AT | Validator | Touches | Lands in |
|---|---|---|---|
| AT-001 | V7 Source basis required | DecisionPacket.evidence_ids + ExtractedClaim + MemoryRecord | KG-2 + KG-4 |
| AT-002 | V1 Pricing source class | CostItem.source_class + Source | KG-3 |
| AT-003 | V8 Inference labeling | ExtractedClaim.inference_label | KG-1 |
| AT-004 | V6 Role redaction | Margin-bearing read_visibility + permission matrix | KG-5 |
| AT-005 | V2 External send approval | DecisionPacket.review_requirement + ActionRecord.action_kind | KG-2 + KG-4 |
| AT-006 | V9 Learning signal creation | LearningSignal | KG-4 |
| AT-007 | V10 Memory promotion gate | LearningSignal + MemoryRecord | KG-4 |
| AT-009 | V5 Blackboard rail mapping | DecisionPacket.system_final_blackboard_rail | KG-2 |
| AT-013 | V12 Audit completeness | AuditEntry per packet_id | KG-6 |
| AT-016 | V14 Pathway integrity | All entities with source_id | KG-3 |
| AT-017 | V15 i18n parity | All `display_name_es` | KG-5 (HR) + spot-checks elsewhere |

The remaining ATs (AT-010 BLS, AT-011 quote freshness, AT-012 CA recording consent, AT-014 frontier escalation, AT-018 Sentry override, AT-019 token budget, AT-020 altitude assignment) land in V1.5+ infrastructure PRs not scoped here.

---

## 11. Non-goals

This document and the PRs it proposes do **not** include:

1. **Full graph database in this PR.** Graph is a projection over the Blackboard. No new store. No Neo4j, no Dgraph, no embedded triple store.
2. **Vector store implementation.** Retrieval is source-class-layered, not vector-similarity-ranked, in V1. Vector indexing is a V1.5+ retrieval optimization at most.
3. **Platform writes.** Money writes, audit-of-record `locked` transitions, and external sends remain on the Platform side per the two-repo boundary (locked `2026-04-23.0`). Kerf side stops at the contract call.
4. **Network calls from Kerf side.** Right Hand's LLM calls go through the Platform's gateway. The Kerf side receives AltitudePackets; it does not call Groq or Anthropic directly.
5. **Replacing the Blackboard.** The Blackboard is the source of truth for *what happened*. The graph is what the Blackboard looks like when projected. There is no "graph store" replacing the event log.
6. **Model-invented facts.** `MODEL_INFERENCE` is the lowest source class for a reason. V1 blocks any pricing / send / committed action whose strongest support is `MODEL_INFERENCE`. The model proposes; Kerf disposes.
7. **UI redesign.** The wireframe canon (`docs/wireframes/kerf_views_master_v1_0.html` v1.0 + the +8 substrate frames on `docs/views-master-v1_0`) is the surface contract. This doc does not propose changes to it.
8. **Customer-facing copy.** No marketing changes to "headless agentic" / "agentic OS" or any customer-facing positioning. Per `kerf-app/CLAUDE.md` §6.

The 12 founder open-questions in `kerf-cos/Kerf_Knowledge_Graph_Schema_Spec_v0_2.md` §12 (subcategory hierarchy depth · region anchor granularity · phase code aliases shape · etc.) are out of scope for this kerf-app-side doc — they're answered in the kerf-cos canon repo and surface here only as the SQL DDL lands.

---

## 12. Cross-references

- **Canon-side spec:** `kerf-cos/Kerf_Knowledge_Graph_Schema_Spec_v0_2.md` — the full field-level definitions, RLS patterns, SQL migration plan, and founder open-questions.
- **Decision Packet Spec:** `kerf-cos/KERF_Decision_System_Package_v0_1/Kerf_Decision_Packet_Spec_v0_1.md` — the 17-field atomic V1 product object.
- **Validator Spec:** `kerf-cos/Kerf_Deterministic_Validator_Spec_v0_3.md` — runtime that enforces this schema's integrity rules.
- **Evidence-Claim-Decision Schema:** `kerf-cos/KERF_Decision_System_Package_v0_1/Kerf_Evidence_Claim_Decision_Schema_v0_1.md` — origin of the chain.
- **Source Defensibility Matrix:** `kerf-cos/KERF_Decision_System_Package_v0_1/Kerf_Source_Defensibility_Matrix_v0_1.md` — 10 source classes with trust hierarchy.
- **Llama 70B Retrieval Contract:** `kerf-cos/KERF_Decision_System_Package_v0_1/Kerf_Llama_70B_Retrieval_Contract_v0_1.md` — required retrieval order the projection layer must support.
- **Decision System Research Report v0.2:** `kerf-cos/Kerf_Decision_System_Research_Report_v0_2.md` — architectural justification for v0.2 over v0.1.
- **D-020:** `kerf-cos/KERF_Decision_System_Package_v0_1/D-020_Kerf_Decision_First_Blackboard_Right_Hand.md` — locks the canonical chain.
- **D-022:** Decision Packet schema lock.
- **D-031 / D-032 / D-033 / D-034:** Company-HR, Schedule, In-house comms, and Project Documents lane schemas (DRAFT).
- **Wireframe canon:** `docs/wireframes/kerf_views_master_v1_0.html` · `docs/wireframes/notes.md` · `docs/wireframes/README.md`.
- **kerf-app architecture invariants:** `CLAUDE.md` §3 (money is integer cents · margin is permission-gated · lifecycle is sequential · events are append-only · every claim has SourceRef · i18n parity is enforced · permission matrix is canonical · two-repo boundary · contract version bumps · per-consumer adapter pattern).
- **Blackboard implementation:** `src/blackboard/types.ts` · `src/blackboard/eventLog.ts` · `src/blackboard/privilege.ts`.
- **Existing projections:** `src/projections/decisions.ts` · `src/projections/systemState.ts` · `src/projections/liveMemory.ts` · `src/projections/graph.ts` · `src/projections/types.ts`.
- **Boundary contract:** `src/contracts/platform/types.ts` (versioned `2026-04-23.0`).

---

*The graph is not a price book. It is persistent operating memory. The model proposes via AltitudePacket. Kerf disposes via DecisionPacket. The schema makes both states inspectable, auditable, and reversible.*

*— `@kerf/core` v0.0.1+ · 2026-05-04*
