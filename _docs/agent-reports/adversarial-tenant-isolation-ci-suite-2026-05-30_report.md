# Adversarial tenant-isolation CI suite · agent report

**Date:** 2026-05-30  
**Repo:** `kerf-app`  
**Brief:** Adversarial Tenant-Isolation CI Suite (D-045 / isolation canon §5–§6)

## Delivered

| Item | Location |
|------|----------|
| `@isolation` test harness | `tests/isolation/_harness.ts` |
| Families A–H + audit monitor | `tests/isolation/*.test.ts` |
| CI gate | `npm run test:isolation` · `.github/workflows/ci.yml` |
| Control tenant | `tenant_other` on `PersistenceTenantId` |
| Server-bound tenant resolution | `src/tenant/resolveRequestTenant.ts` |
| Cache namespace + identity bind | `src/tenant/cacheNamespace.ts` |
| Vector/RAG contract stub | `src/isolation/vectorRetrievalContract.ts` |
| Continuous audit substrate | `src/tenant/tenantAccessAudit.ts` |
| D3 attestation | `docs/security/inference-kv-cache-attestation-*` |

## Executable now

- **A1** cross-tenant scoped read (zero rows)
- **A2** forged body `tenant_id` ignored (query/header wins)
- **A3** static scan: no `service_role` / `BYPASSRLS` in `src/` + `scripts/`
- **B1–B2** cache key namespace + identity-bind reject
- **C1–C4** vector contract (in-memory per-tenant store)
- **D2–D3** fine-tune scan + KV attestation files
- **E1–E4** API list/IDOR, money/send gate static checks
- **G1–G2** log/localStorage static guards
- **H1** no embedding console logs in API tree
- **Audit monitor** violation detection + clean scoped-read path

## Pending (explicit `skip`, not silent)

- **A4–A6** Postgres RLS / views (no DB layer in V1 JSONL path)
- **B3** connection-pool stress
- **D1** worker context reset
- **F1–F4** crypto-shred, vector purge, telemetry, adapters
- **G3–G4** eval tagging, support tooling
- **H1** at-rest embedding encryption (storage not wired)

## Hardening bundled

- `GET /projects/:id` requires tenant (no default cross-tenant lookup)
- `fieldDaily` + field capture use query/header tenant (A2)
- `tenantScopedReads` writes audit records for monitor

## Verification

```bash
npm run test:isolation
npm run typecheck
```

## Launch blockers if left unfinished

Paid multi-tenant beta still requires: Postgres RLS (A4–A6), production cache stress (B3), vector store with encryption (C/H), deletion walls (F), independent pen test (D-045 — not replaced by this suite).
