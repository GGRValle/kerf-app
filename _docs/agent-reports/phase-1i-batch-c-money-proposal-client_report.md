# Agent report · `phase-1i-batch-c-money-proposal-client` · 2026-05-28

**Repo:** `GGRValle/kerf-app`  
**Branch:** `phase-1i-batch-c-money-proposal-client`  
**Agent:** Cursor · Phase 1I Batch C (Money · Proposal · Clients)

---

## Dispatch

`cursor_dispatch_briefs_2026-05-27/07_Phase_1I_100_Wireframes_Button_To_Loop_Batch_Dispatch.md` — **not found** in kerf-cos or kerf-app at verification time.

---

## Base · independent or stacked

**Stacked on Batch D** — `origin/phase-1i-batch-d-schedule-reports-settings-shell` @ **`578769c`**, then Batch C commits replayed.

Merge-base with `origin/main`: `d06815a` (Batch D already includes Batch B relay/project-tab work).

---

## Scope delivered

| Area | Routes |
|---|---|
| Money Home | `/money` |
| Margin / AR / AP / Allowances / Bookkeeping / QB Export | `/money/*` |
| Proposal Preview | `/proposals/:id/preview` (export strip) |
| Proposal Send Gate | `/proposals/:id/send` — **unchanged** |
| Clients + project create | `/clients`, `/clients/:id`, `/clients/new`, `/projects/new` |

**Hard boundary:** no project tab components edited. Nav: **`nav.money` only** (no Batch D shell rewrites).

---

## Shared files touched · collision risk

| File | Risk |
|---|---|
| `src/i18n/keys.ts`, `en.ts`, `es.ts` | **HIGH** — union merge kept **all D/B keys + all C money/client/proposal keys** |
| `src/app/lib/nav.ts` | **MEDIUM** — `+nav.money` only |
| `tests/route-shell-smoke.test.ts` | **MEDIUM** |
| `src/api/router.ts`, `routes/projects.ts` | **MEDIUM** |

---

## i18n parity confirmed

Post-rebase automated check: **583** keys in union · **583** EN · **583** ES · **0 missing** · terminator only on `kb.ingestion.preview.link_projects`. Both `rh.relay.detail.reviewed` and `rh.relay.detail.reviewed_status` retained.

---

## Safety rules

All pass — Preview+disabled payment CTAs · `export.requested` only · gated send unchanged · `project.created` wired.

---

## Clean-worktree proof

Fresh worktree @ pushed tip after stack (see CI log in commit message / gate runner).

```bash
git fetch origin phase-1i-batch-c-money-proposal-client
git worktree add -f /tmp/kerf-batch-c-stacked-verify origin/phase-1i-batch-c-money-proposal-client
cd /tmp/kerf-batch-c-stacked-verify && npm ci
npm run typecheck
npm run build:astro
node --import tsx --test tests/phase1i-batch-c-money-proposal-client.test.ts tests/route-shell-smoke.test.ts
```

---

## Merge posture

**Do not merge** until Phase 1I integration gate approves stacked order (D → C).
