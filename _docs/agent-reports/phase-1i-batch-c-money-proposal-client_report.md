# Agent report · `phase-1i-batch-c-money-proposal-client` · 2026-05-28

**Repo:** `GGRValle/kerf-app`  
**Branch:** `phase-1i-batch-c-money-proposal-client`  
**Agent:** Cursor · Phase 1I Batch C (Money · Proposal · Clients)

---

## Dispatch

`cursor_dispatch_briefs_2026-05-27/07_Phase_1I_100_Wireframes_Button_To_Loop_Batch_Dispatch.md` — **not found** in kerf-cos or kerf-app at verification time.

---

## Base · independent or stacked

**Stacked on Batch D** — `origin/phase-1i-batch-d-schedule-reports-settings-shell` @ **`578769c`**, then Batch C feature + i18n union merge.

---

## Scope delivered

Money (`/money/*`), proposal preview export, clients + `/projects/new`, gated send unchanged. No project tab edits. Nav: `nav.money` only.

---

## Shared files touched · collision risk

| File | Risk |
|---|---|
| `src/i18n/keys.ts`, `en.ts`, `es.ts` | **HIGH** — merged union: all D/B + all C money/client/proposal keys |
| `src/app/lib/nav.ts` | **MEDIUM** |
| `tests/route-shell-smoke.test.ts` | **MEDIUM** |
| `src/api/router.ts`, `routes/projects.ts` | **MEDIUM** |

---

## i18n parity confirmed

**583** union keys · **583** EN · **583** ES · **0 missing**. Terminator on `kb.ingestion.preview.link_projects` only. `rh.relay.detail.reviewed` + `rh.relay.detail.reviewed_status` both present.

---

## Safety rules

Pass — Preview payments · export audit-only · gated send · no money mutation.

---

## Clean-worktree proof

```bash
git fetch origin phase-1i-batch-c-money-proposal-client
git worktree add -f /tmp/kerf-batch-c-stacked-verify origin/phase-1i-batch-c-money-proposal-client
cd /tmp/kerf-batch-c-stacked-verify && npm ci
npm run typecheck && npm run build:astro
node --import tsx --test tests/phase1i-batch-c-money-proposal-client.test.ts tests/route-shell-smoke.test.ts
```

**2026-05-28 fresh worktree @ `696b3cd`:**

```text
npm run typecheck → exit 0
npm run build:astro → exit 0
phase1i-batch-c + route-shell-smoke → 5/5 pass
merge-base with D @ 578769c ✓
```

---

## Merge posture

**Do not merge** until Phase 1I gate signs off stacked D → C order.
