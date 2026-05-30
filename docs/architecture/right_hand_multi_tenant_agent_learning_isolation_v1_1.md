# Right Hand Multi-Tenant Agent Learning and Isolation v1.1

**Status:** Architecture spec of record  
**Date:** 2026-05-30  
**Owner:** Christian Asdal / Right Hand  
**Depends on:** D-051 four-locality axis, Kerf Knowledge Graph Schema v0.2, onboarding protocol v0.1, Right Hand voice/front-door doctrine.

## 0. Operating Line

The operator speaks freely. Right Hand translates the conversation into typed, sourced, stateful business memory. Sub-agents act only through role-specific contracts. Their outputs, corrections, and outcomes become measurable training signals.

Rigor lives in the output contract, stored-fact envelope, promotion gates, and strict exit door. It does not live in a rigid user-facing form.

## 1. Universal Stored-Fact Envelope

Every load-bearing stored fact, extracted claim, memory record, candidate Play input, embedding, and training example must carry this envelope or map mechanically to it.

| Field | Required | Purpose |
|---|---:|---|
| `schema_version` | yes | Version of this stored-fact contract. |
| `contract_version` | yes | Version of the task-specific information contract that required the field. |
| `fact_id` | yes | Stable identifier for this fact or claim. |
| `tenant_id` | yes | Server-derived tenant scope. Never trusted from model output. |
| `org_group_id` | conditional | Required when locality is `org_shared`. |
| `business_unit_id` | optional | Business unit inside an organization. |
| `locality` | yes | One of D-051's locality values. |
| `field_path` | yes | Canonical dotted path such as `estimate.scope.rooms.primary_bath.waterproofing`. |
| `value` | yes | Typed value. May be null only when `state` permits unknown/missing. |
| `value_type` | yes | Primitive or structured type marker. |
| `state` | yes | `known`, `unknown`, `stale`, `conflicting`, `model_inferred`, `operator_confirmed`, or `needs_verification`. |
| `source_class` | yes | Canon source class / authority layer. |
| `source_refs` | yes | Non-empty source reference list unless the field is explicitly source-silent by contract. |
| `provenance` | yes | Evidence, claim, memory, model, and operator chain for audit. |
| `freshness` | yes | Freshness state and timestamps. |
| `visibility` | yes | Role and surface visibility. |
| `consequence_tier` | yes | Highest consequence this fact may support. |
| `training_eligibility` | yes | Whether this fact may train tenant-private adapters, platform structures, or nothing. |
| `promotion_status` | yes | Current promotion state. |
| `retention_policy_id` | yes | Retention/deletion policy pointer. |
| `deletion_scope` | yes | What must be deleted or crypto-shredded when this fact is removed. |
| `audit_ids` | yes | Audit event ids proving creation, correction, promotion, and deletion lifecycle. |
| `created_at` / `updated_at` | yes | Lifecycle timestamps. |

Machine schema: `docs/schemas/right-hand-stored-fact-envelope.schema.json`.

## 2. Four-Layer Memory Model

| Layer | Holds | Isolation pattern | Notes |
|---|---|---|---|
| 1. Tenant Evidence | Raw transcripts, audio, photos, LiDAR, estimates, invoices, emails, docs | Tenant-scoped object storage, per-tenant vector namespace, encryption, retention policy | Immutable source-of-truth. Embeddings inherit evidence sensitivity. |
| 2. Typed Business Memory | Labor rates, markup rules, proposal style, client preferences, vendor behavior, recurring exclusions | Tenant-scoped structured store, scoped queries plus RLS target, composite `(tenant_id, id)` target | Deterministic agent substrate. |
| 3. Learning Signals | Corrections, approvals, rejections, stale flags, outcome deltas, repeated mistakes | Tenant-private by default | Current code emits `learning_signal.drafted`; richer `memory_update.*` flow is a target, not current-state claim. |
| 4. Approved Memory / Plays | Promoted tenant memory and reusable procedures | Split by D-051 locality | Tenant memory remains private. Platform structural Plays may cross only after promotion gates. |

Blackboard is the working chain for a task. It is not the whole memory system. Useful Blackboard outputs become typed facts, audit entries, learning signals, or approved memory.

## 3. Locality Rules

D-051 is authoritative. Summary:

- `tenant_private`: raw tenant data, tenant facts, tenant-specific feel, tenant-trained adapters. Never crosses customers.
- `org_shared`: only inside one authenticated owner group.
- `platform_structural`: content-free Plays, schemas, validators, procedures. Safe to share after structure-only gate.
- `shared_corpus`: V2+ consent-gated de-identified examples or aggregates. Requires privacy controls, cohort/diversity checks, composition budget, and human approval.

## 4. Promotion Gate for Shared Plays

A candidate Play must pass all applicable gates before crossing a customer boundary.

### Structure-Only Gate

1. No client names, addresses, dates, project ids, dollar amounts, quotes, or verbatim traces.
2. Tenant-derived constants become named parameters.
3. The Play expresses procedure, schema, recognition logic, or validator behavior.
4. Independent scan by a non-builder or separate automated pass.

### Cohort and Aggregate Gate

Required only if tenant-derived statistics inform the Play.

1. Minimum distinct-tenant threshold on quasi-identifier combination, not row count.
2. Diversity check to prevent homogeneity leakage.
3. Outlier exclusion.
4. Differential privacy or stronger formal privacy control for numeric aggregate release.
5. Composition budget across the full Play library.

Right Hand's product default for shared-corpus aggregate release is `epsilon <= 1` unless a later security review approves otherwise. This is a conservative Right Hand policy, not a universal NIST threshold. NIST SP 800-226 requires meaningful evaluation of the privacy guarantee and identifies practical privacy hazards; it does not prescribe one epsilon for all use cases.

### Human Gate

1. Human approval before first cross-tenant publication.
2. Provenance, gate results, and recall/unpublish path recorded.
3. Contributor objections or leak findings can unpublish the Play and reclaim budget.

## 5. Hardening Walls

Isolation is enforced in code and infrastructure, never by prompt instruction.

1. Identity wall: resolve `tenant_id` from server-side session.
2. Authorization wall: downstream deterministic authorizer disposes every action.
3. Database wall: scoped queries plus RLS target plus composite `(tenant_id, id)` keys.
4. Cache/Blackboard wall: tenant-namespaced keys and identity-bound reads.
5. Vector/RAG wall: per-tenant namespaces or collections; filter-before-rank if any shared index exists.
6. Model-context wall: clear context between tenants; no cross-tenant prompt, prefix, or KV-cache sharing.
7. Tool wall: tools run under the user's tenant-scoped auth context.
8. Autonomy wall: irreversible actions require confirmation.
9. Memory wall: long-term memory and learned facts namespaced by tenant; background jobs do not batch-mix tenants.
10. Encryption wall: per-tenant envelope encryption where supported.
11. Logging/audit wall: immutable logs capture requester tenant and accessed tenant.
12. Observability/egress wall: logs, traces, error reports, analytics, support tools, browser storage, eval datasets, screenshots, and vendor telemetry obey the same locality and deletion rules as production data.

## 6. Retention and Deletion

Deletion is part of the stored-fact contract, not a support-process afterthought.

- `retention_policy_id` selects TTL, legal hold, exportability, and deletion behavior.
- `deletion_scope` names what must be removed: raw object, transcript, embedding, vector metadata, cache entry, Blackboard scratch, learning signal, derived memory, logs, traces, eval copy, and backup.
- Crypto-shred is allowed only where per-tenant envelope keys make it meaningful.
- Vector deletion must remove both vector and metadata from every namespace/collection.
- Tenant export must preserve source refs and audit chain without exporting other tenants' data.
- Learning-derived deletion must identify downstream MemoryRecords or Plays that used the deleted fact.

## 7. Learning Metrics

Right Hand must prove learning through measurable behavior, not vibes.

| Metric | What it shows |
|---|---|
| Repeated correction rate | Whether the same mistake repeats after correction. |
| First-pass acceptance rate | Whether drafts/documents require fewer edits over time. |
| Clarification rate | Whether the system asks fewer or better missing-info questions. |
| Source coverage | Whether load-bearing fields carry source refs. |
| Staleness caught rate | Whether stale facts are flagged before use. |
| Agent drift rate | Whether sub-agents emit fields outside their contract. |
| Outcome accuracy | Whether estimates, assumptions, and proposals match final job outcomes. |
| Promotion rejection rate | Whether candidate Plays are carrying content or weak generalization. |

## 8. Implementation Status Discipline

This document defines target architecture unless a section explicitly says current code. Known current-state anchors as of 2026-05-30:

- Current code includes `learning_signal.drafted`.
- Current code does not prove `memory_update.proposed` or `memory_update.confirmed` are implemented.
- RLS, composite database keys, vector namespaces, provider KV-cache attestation, and full V10 memory promotion remain implementation targets unless separately verified in code.

## 9. Cited Basis

| Claim | Source | Date | Confidence |
|---|---|---:|---|
| Differential privacy is a mathematical framework for quantifying privacy loss, but must be evaluated with implementation hazards in mind. | NIST SP 800-226, https://csrc.nist.gov/pubs/sp/800/226/final | 2025-03 | High |
| LLM/RAG vector and embedding layers are a named security risk class. | OWASP Top 10 for LLM Applications 2025, LLM08, https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf | 2025 | High |
| Pinecone recommends one namespace per tenant for secure multitenancy and notes metadata filtering as an alternative with different tradeoffs. | Pinecone multitenancy docs, https://docs.pinecone.io/guides/get-started/implement-multitenancy | accessed 2026-05-30 | High |
| OpenAI business/API data is not used for training by default unless opted in. | OpenAI enterprise privacy / API data usage policy, https://openai.com/policies/api-data-usage-policies/ | accessed 2026-05-30 | High |
| Kerf graph doctrine already defines source-or-silent, two-stage trust, and compounding memory. | `docs/architecture/kerf_knowledge_graph_schema_v0_2.md` | 2026-05-04 | High |
| Right Hand onboarding is conversational, not form-filling, and maps answers to typed memory after confirmation. | `docs/onboarding/protocol_v0_1.md` | current repo | High |
