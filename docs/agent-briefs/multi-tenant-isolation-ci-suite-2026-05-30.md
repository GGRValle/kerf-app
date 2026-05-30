# Agent Brief - Multi-Tenant Isolation CI Suite

**Date:** 2026-05-30  
**Owner:** Right Hand / Codex gate  
**Branch:** create a fresh branch from latest `origin/main`  
**Purpose:** Turn D-051 and the multi-tenant learning architecture into falsifiable CI tests.

## Background

Right Hand's paid multi-tenant launch requires provable tenant isolation. Prompt-level isolation is not a control. The system must enforce isolation through request context, authorization, database/query shape, cache keys, vector namespace, model-context hygiene, memory locality, observability, retention, and audit evidence.

Read first:

- `docs/architecture/decisions/D-051-four-locality-agent-memory-axis.md`
- `docs/architecture/right_hand_multi_tenant_agent_learning_isolation_v1_1.md`
- `docs/schemas/right-hand-stored-fact-envelope.schema.json`
- `docs/architecture/kerf_knowledge_graph_schema_v0_2.md`

## Non-Negotiables

- Do not weaken existing validator, event, money, send, or tenant guardrails.
- Do not add a fake green test that only greps prose.
- Tests must fail against at least one plausible cross-tenant bug.
- Current code may not yet have RLS/vector infra. Where infrastructure does not exist, add executable contract tests around the current abstraction plus TODO markers naming the missing implementation wall.
- Never rely on model output or prompt instruction to enforce tenant isolation.

## Test Families

### A. Request Context and Tenant Source

Assert that tenant context is server-derived and not accepted from model output or arbitrary client body where a session context is available.

Required adversarial cases:

- Tenant A actor sends Tenant B id in body/query.
- Model output includes a different tenant id.
- Same user id exists in Tenant A and Tenant B.

Expected: request resolves from server context; cross-tenant access is denied or ignored.

### B. Scoped Reads and Composite Identity

Exercise every tenant-scoped read helper currently in the repo.

Required adversarial cases:

- Fetch object by id that exists in another tenant.
- Join or projection path attempts to read an object without tenant id.
- Tenant B uses a valid Tenant A event id.

Expected: zero rows or 404/403; no partial object body is returned.

### C. Cache / Blackboard Identity Binding

Add tests for any cache, Blackboard, projection, or sessionStorage handoff that names project, event, draft, relay card, or decision ids.

Required adversarial cases:

- Same cache key suffix under two tenants.
- Cache hit whose stored `tenant_id` differs from requester.
- Blackboard scratch from Tenant A is requested by Tenant B.

Expected: miss or denial. A cache hit must still verify ownership.

### D. Vector / RAG Boundary Contract

If vector store is not implemented yet, create the contract test and a stub adapter that proves desired behavior.

Required adversarial cases:

- Shared-index query with missing tenant filter.
- Tenant B semantic query engineered to match Tenant A document.
- Post-retrieval ACL check after top-k ranking.

Expected: missing filter returns empty or throws; filter-before-rank is enforced; per-tenant namespace/collection is the preferred implementation.

### E. Stored-Fact Envelope

Validate examples against `docs/schemas/right-hand-stored-fact-envelope.schema.json`.

Required adversarial cases:

- Missing `tenant_id`.
- `shared_corpus_candidate` with `locality=tenant_private`.
- Known value with no `source_refs`.
- `org_shared` with no `org_group_id`.
- Training-eligible field with no `retention_policy_id` or `deletion_scope`.

Expected: schema rejects.

### F. Learning and Promotion Locality

Test that learning signals and candidate Plays stay private until promoted.

Required adversarial cases:

- Raw tenant correction marked `platform_structural`.
- Candidate Play containing dollar amount, address, client name, project id, date, or verbatim quote.
- Tenant-private adapter loaded under another tenant.

Expected: promotion gate rejects. If adapter infra is absent, test the gateway contract/stub.

### G. Retention, Deletion, and Egress

Add contract tests for deletion scope and telemetry/egress boundaries.

Required adversarial cases:

- Delete source fact but leave vector metadata eligible for retrieval.
- Export or log includes tenant-private raw transcript without audit entry.
- Error trace captures `value` for owner-private or finance-privileged fields.

Expected: delete propagates through declared `deletion_scope`; egress is audit-logged; privileged values are redacted.

### H. Provider and Serving-Layer Attestation

This cannot be fully proven by app tests. Add a checked artifact requirement:

- provider name
- model / endpoint
- whether cross-tenant prompt, prefix, or KV-cache sharing is disabled or partitioned
- date of attestation
- owner who accepted the risk

Expected: CI fails if the attestation artifact is missing or stale once external paid tenants are enabled.

## Deliverables

1. Tests under `tests/` with clear names.
2. Any test fixtures needed for three tenants.
3. Minimal helper types/adapters if current abstractions need seams.
4. A short report under `_docs/agent-reports/` with:
   - branch and commit
   - test families implemented
   - tests that are executable now
   - implementation walls still stubbed/contract-only
   - what would break paid multi-tenant launch if left unfinished

## Verification

Run:

```bash
npm run typecheck
npm run build:astro
npm test
```

Known current baseline may include unrelated v15 bundle/server failures. Do not hide new tenant-isolation failures behind that baseline.

## Acceptance Criteria

- A cross-tenant data access bug can be represented as a failing test.
- Stored-fact envelope examples validate and adversarial examples reject.
- The suite covers cache, read, vector/RAG, learning promotion, deletion, observability/egress, and provider attestation.
- No test relies on prompt instruction as the isolation mechanism.
