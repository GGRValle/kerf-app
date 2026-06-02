# Build Brief · Adversarial Tenant-Isolation CI Suite · 2026-05-30

**Owner:** Cursor (build) · gate run by a non-builder (a builder cannot certify its own isolation — D-045)
**Goal:** a CI-gated, adversarial cross-tenant test suite that **re-proves tenant isolation on every deploy.** Each test is falsifiable, fails closed, and asserts a specific hardening wall. This operationalizes the architecture spec (`RightHand_Storage_Learning_Isolation_Canon_v1`) §5 and absorbs the Week-4 "3-tenant boundary verification" — make it adversarial and CI-gated, not one-time.

**Doctrine:** isolation is *architecturally difficult to violate*, not *procedurally required*. Every test below must pass with three real tenants (`tenant_ggr`, `tenant_valle`, `tenant_hpg` as BUs of one org → use a fourth, unrelated `tenant_other`, as the hard-wall control). Where the env doesn't yet support a wall, the test is written and marked `pending` with a TODO — never skipped silently.

---

## How these run
- One suite, tagged `@isolation`, gated on every PR and every deploy (block merge on red).
- Tests authenticate as *different* tenants — never as a dev superuser (the dev-superuser-sees-everything trap is the #1 false pass).
- Seed: `tenant_ggr`, `tenant_valle`, `tenant_hpg` (one org), `tenant_other` (separate customer). Cross-customer assertions use `tenant_ggr` vs `tenant_other`.

---

## Test cases (given · when · then)

### A. Database wall — RLS + composite `(tenant_id, id)` keys
- **A1 cross-tenant row read** — *given* a row owned by `tenant_other`; *when* a `tenant_ggr` session selects it by id; *then* zero rows. (RLS active.)
- **A2 forged claim** — *when* a client presents a JWT with a self-set `tenant_id` in user-modifiable claims; *then* the server uses the server-set claim only; cross-tenant read returns zero.
- **A3 service-role containment** — *assert* the `service_role`/BYPASSRLS key is never reachable from any request-handling path (static check + runtime assert).
- **A4 join leak** — *when* a query JOINs a tenant table to a second table; *then* both tables enforce RLS; a row from `tenant_other`'s joined table never appears.
- **A5 missing-RLS guard** — *CI static check:* every table with a `tenant_id` column has RLS enabled; fail the build on any table without it.
- **A6 view/secdef guard** — *CI static check:* every view is `security_invoker=true`; flag every `SECURITY DEFINER` function touching a tenant table.

### B. Cache / Blackboard wall — namespacing + identity-bound reads
- **B1 key collision** — *given* `tenant_ggr` and `tenant_other` requests that would compute the same logical cache key; *then* keys are namespaced `tenant:{id}:…` and `tenant_other` never reads `tenant_ggr`'s value.
- **B2 identity-bind on read** — *when* any cache/Blackboard read returns an object; *then* the handler asserts the object's `tenant_id` == requester's before use (the Mar-2023 ChatGPT/Redis fix). Inject a deliberately mis-keyed object → read must reject, not serve.
- **B3 connection-pool race** — *when* concurrent multi-tenant requests share a connection pool; *then* no response carries another tenant's data (stress/concurrency test).

### C. Vector / RAG retrieval wall — per-tenant namespace + filter-before-rank
- **C1 semantic-target attack** — *given* `tenant_other` has a doc "confidential merger plan / unusual margin posture"; *when* `tenant_ggr` runs a semantic search engineered to surface it; *then* every result's `tenant_id == tenant_ggr` (zero `tenant_other`).
- **C2 missing-filter fail-closed** — *when* the tenant filter is absent/empty on a retrieval call; *then* the result is **empty**, never match-all. (Assert default-deny, not default-all.)
- **C3 namespace boundary** — *assert* tenants are in separate collections/namespaces, not a shared index with a metadata filter as the only boundary; bulk list/export scoped to one tenant cannot enumerate another's vector IDs.
- **C4 filter precedes rank** — *assert* the tenant filter executes before similarity ranking (not a post-hoc ACL check on the top-k).

### D. Model-context / inference wall — no context or KV-cache bleed
- **D1 context reset** — *when* request N for `tenant_other` follows request N-1 for `tenant_ggr` on the same worker; *then* no `tenant_ggr` content appears in `tenant_other`'s prompt/context.
- **D2 no shared-model tenant fine-tune** — *CI static/config check:* no training job fine-tunes a shared base on tenant-private data; tenant learning lives in per-tenant adapters, never merged into the shared base.
- **D3 KV/prefix-cache attestation** — *this wall is invisible to app tests.* Require a written/config attestation that cross-tenant prompt/prefix/KV-cache sharing is OFF (or per-tenant-partitioned) on both inference tiers (Groq cheap, frontier). Test = a CI check that the attestation artifact exists and the serving config matches; flag if absent (NDSS-2025 side channel).

### E. Authorization / agency wall
- **E1 cross-tenant endpoint** — *when* `admin@tenant_ggr` calls a `tenant_other` endpoint; *then* 403, across CRUD.
- **E2 IDOR / enumeration** — *when* a caller increments/tampers ids or `tenant_id` params; *then* denied; no existence oracle.
- **E3 downstream mediation** — *assert* high-impact actions are authorized in the downstream system, not by the LLM; the agent cannot self-authorize a money write or send.
- **E4 least-privilege identity** — *assert* tools run in the user's/tenant's scoped identity, not a god service-account that can read all tenants.

### F. Deletion / crypto-shred / retention
- **F1 crypto-shred** — *when* a tenant is deleted; *then* their data key is destroyed and at-rest data (incl. backups under that key) is unrecoverable.
- **F2 vector deletion** — *when* a tenant's records are deleted; *then* their **embeddings + index entries** are deleted too (no orphaned reconstructable vectors).
- **F3 telemetry purge** — *when* a tenant is deleted; *then* tenant-identifiable logs/traces/eval data are purged or anonymized within the stated TTL.
- **F4 learning-derived deletion** — *when* a tenant is deleted; *then* their `tenant_local_only` adapter/profile is destroyed; `platform_structural` Plays (content-free) are unaffected.

### G. Observability / egress wall (leaks before the DB does)
- **G1 no tenant content in logs/traces** — *scan* app logs, traces, and error payloads (Sentry-class) under a multi-tenant run; *then* no raw transcripts, PII, prices, or embeddings appear.
- **G2 no client-side persistence** — *assert* no tenant data persists in browser/local storage beyond the session.
- **G3 eval-set tagging** — *assert* any eval/analytics dataset is tenant-tagged and consent-gated; no raw tenant content in shared eval corpora.
- **G4 support-tool access** — *assert* support/admin tooling access is least-privilege and logged (`requester ≠ accessed` is auditable).

### H. Embeddings-are-sensitive (hard rule)
- **H1** — *assert* embeddings are encrypted at rest, tenant-scoped, never written to logs, and never bulk-exported across a tenant boundary. Treat any test that finds a plaintext embedding in a log/export as a hard fail.

---

## Audit-log monitor (continuous, not just CI)
- Standing query: `accessed_tenant_id != requester_tenant_id` must always return **empty.** Any non-empty result is a sev-1. Immutable log of `requester_tenant_id` vs `accessed_tenant_id` on every data access is the substrate for this and the SOC 2 evidence trail.

## Acceptance
- [ ] `@isolation` suite gates every PR + deploy; red blocks merge.
- [ ] Tests authenticate as distinct tenants (no dev-superuser pass).
- [ ] All A–H families present; env-unsupported walls written + marked `pending` with TODO, never silently skipped.
- [ ] D3 attestation artifact exists for Groq + frontier tiers.
- [ ] Continuous `requester ≠ accessed` monitor wired.
- [ ] Suite output is the standing SOC-2 isolation evidence artifact (D-045).

## What this is NOT
- NOT a substitute for the independent pen test (D-045) — the suite is necessary; the non-builder pen test is what an auditor/buyer credits.
- NOT prompt-level isolation — every wall is enforced in code/infra, never in the prompt.

---

*Build brief 2026-05-30. Operationalizes the storage/isolation canon §5–§6. Absorbs and hardens the Week-4 3-tenant boundary verification.*
