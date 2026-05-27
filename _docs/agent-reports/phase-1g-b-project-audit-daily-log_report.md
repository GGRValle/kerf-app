# Agent report · `phase-1g-b-project-audit-daily-log`

**Date:** 2026-05-27  
**Repo:** `GGRValle/kerf-app`  
**Base:** `origin/main @ af80203` (includes PR #235 F-E1 capture clarity)  
**Head:** `a5d619c` — `feat(audit): Phase 1G-B project audit shows F-E1 capture chain.`  
**Brief:** `cursor_dispatch_briefs_2026-05-27/02_Phase_1G_B_Project_Audit_Daily_Log_Visibility_Brief.md`  
**PR:** Not opened (per dispatch · gate/Christian to open)

---

## Summary

Extended the existing Phase 1D project audit projection so a fresh F-E1 submit under `proj_wegrzyn_kitchen` appears on `/projects/proj_wegrzyn_kitchen/audit`, not only in Relay.

**Read-side wiring was insufficient** — `loadProjectAuditTrail` filtered to proposal/send-gate/export events only. Daily Log + relay events were already persisted with the correct `correlation_id`.

---

## Changes (6 files)

| File | Change |
|------|--------|
| `src/project/projectAuditProjection.ts` | Map `daily_log.entry_captured`, `daily_log.facts_extracted`, `daily_log.drift_detected`, `relay_card.surfaced` into `ProjectAuditEntry` |
| `src/app/components/ProjectAuditPanel.astro` | Render bodies for the four new entry kinds |
| `src/i18n/keys.ts`, `en.ts`, `es.ts` | Plain-English primary labels (not raw enum names) |
| `tests/phase1d-audit-projection.test.ts` | Henderson chain + endpoint + label tests |

**No event contract changes.** No audit mutations. Tenant-scoped reads unchanged.

---

## Audit labels (operator-facing)

| Event type | Primary label (EN) |
|------------|-------------------|
| `daily_log.entry_captured` | Field capture saved |
| `daily_log.facts_extracted` | Right Hand extracted job facts |
| `daily_log.drift_detected` | Drift flagged |
| `relay_card.surfaced` | Relay card surfaced |

Drift severity chips: Info · Caution · Watch · **Needs office review** (block).

---

## Verification

```bash
npm run typecheck                                                          # PASS
npm run build:astro                                                        # PASS
node --import tsx --test tests/phase1d-audit-projection.test.ts \
  tests/phase1e-field-capture-submit.test.ts tests/route-shell-smoke.test.ts  # 13/13 PASS
```

**Local smoke (API):** After Henderson submit → audit kinds (newest first):

`relay_card.surfaced` · `daily_log.facts_extracted` · `daily_log.drift_detected` · `daily_log.entry_captured`

---

## Manual smoke (Fly / iPhone)

Not run in this agent session. Recommended after merge:

1. `/field-capture` → Henderson typed submit  
2. `/relay` → block card  
3. `/projects/proj_wegrzyn_kitchen/audit` → four-row capture chain  

---

## Remaining gaps

- **Media-only** submits: audit may show capture row only (no facts/drift/relay) — expected; 01A handles operator copy.  
- **`relay_card.reviewed`** not projected — out of brief scope.  
- Dedicated Daily Log surface — deferred; audit visibility is the Phase 1G-B deliverable.

---

## Sequencing

Merge after **01A** (PR #235) · before or parallel with **01** transcribe/media and **03** chrome. Independent of **1G-C** mobile chrome lane (keep on separate branch).
