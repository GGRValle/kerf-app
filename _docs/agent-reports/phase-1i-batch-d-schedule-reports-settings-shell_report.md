# Phase 1I · Agent D — Schedule, Reports, Settings & Shell

**Agent:** D (Batch D)  
**Branch:** `phase-1i-batch-d-schedule-reports-settings-shell`  
**Head commit:** `9594febdba29cdd1a12e88ed9563c373c9a966ea`  
**Date:** 2026-05-28  
**Merge:** Do not merge (gate branch only)

---

## Branch posture

| Field | Value |
|-------|--------|
| **Mode** | **Stacked** (not independent on `origin/main`) |
| **Stack base** | `phase-1i-batch-b-projects-audit-relay` @ `d5d9f13` (`3c7063b` — project tabs + relay) |
| **Why stacked** | `src/app/pages/projects/[id]/[tab].astro` imports `ProjectTabContent.astro` from Batch B. That component does not exist on `origin/main`; an independent Batch D branch would fail build/typecheck. |

Codex default is latest `origin/main` unless stacking is required — **stacking is required** for this batch.

### Dependencies on other branches

| Branch | Commit (merge-base) | What Batch D needs |
|--------|---------------------|-------------------|
| `phase-1i-batch-b-projects-audit-relay` | `d5d9f13` | `src/app/components/project/ProjectTabContent.astro`, `PreviewNotice.astro`, `projectAuditLinks.ts`, Batch B project/i18n strings, relay/audit page wiring |

No dependency on Batch A (capture/draft) or Batch C (money) for shell surfaces.

### Shared files touched (overlap risk)

Batch D **also modifies** these Batch B files (coordinate at merge):

- `src/app/pages/projects/[id]/index.astro` — `ActionsStrip` → wired `ExportPrintBar`
- `src/app/pages/projects/[id]/[tab].astro` — same export bar; keeps `ProjectTabContent` import
- `src/i18n/en.ts`, `src/i18n/es.ts`, `src/i18n/keys.ts` — Batch D keys appended; Batch B project/relay strings preserved

Batch D–owned paths (safe for other agents to avoid):

- `src/app/lib/shellRoutes.ts`, `src/app/lib/nav.ts` (schedule/reports/settings items)
- `src/app/components/{HomeLoopGrid,MobileBottomNav,ExportPrintBar}.astro`, `SpeakFAB.astro`, `ActionsStrip.astro`
- `src/app/layouts/Layout.astro`, `src/app/styles/shell.css`
- `src/app/pages/{index,more,schedule,reports,settings}.astro`
- `src/app/pages/{blackboard,decisions,kb-ingestion}/**` (preview shell normalization only)
- `tests/phase-1i-batch-d-shell.test.ts`

---

## Goal

Shell feels like an app, not a sitemap: global actions route cleanly or Preview honestly.

- No dead primary buttons  
- Mobile nav routes cleanly  
- Home → useful loops (Capture, Relay, Projects, Draft review)  
- Schedule / Reports / Settings → Preview shells  
- Speak FAB → F-E1 field capture (`/field-capture`)  
- No debug language in operator chrome  

---

## Clean-worktree proof (required — fresh checkout)

Verification was **not** taken from the agent’s dirty workspace. A **fresh git worktree** was created at the pushed remote tip:

```bash
git fetch origin phase-1i-batch-d-schedule-reports-settings-shell
git worktree add /private/tmp/kerf-1i-d-clean-verify \
  origin/phase-1i-batch-d-schedule-reports-settings-shell
cd /private/tmp/kerf-1i-d-clean-verify
npm ci --ignore-scripts
```

| Field | Value |
|-------|--------|
| Worktree path | `/private/tmp/kerf-1i-d-clean-verify` |
| `HEAD` | `9594febdba29cdd1a12e88ed9563c373c9a966ea` |
| Matches `origin/phase-1i-batch-d-schedule-reports-settings-shell` | Yes |
| Proof UTC | `2026-05-28T16:09:16Z` |

```text
$ git status --porcelain
?? node_modules/
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run build:astro
> [build] Complete!
(exit 0)

$ node --import tsx --test tests/phase-1i-batch-d-shell.test.ts
ℹ tests 10
ℹ pass 10
ℹ fail 0
(exit 0)
```

Full log: `/private/tmp/kerf-1i-d-clean-proof.txt` on gate machine.

**Batch B dependency check (clean tree):** `src/app/components/project/ProjectTabContent.astro` present at `9594feb`.

---

## Surface status

| Surface | Status | Notes |
|---------|--------|-------|
| Home / dashboard (`/`) | **Ready** | `HomeLoopGrid` → Capture, Relay, Projects, Draft review |
| Mobile bottom nav | **Ready** | Home · Capture · Relay · Jobs · More; fixed bar, hidden ≥900px |
| More (`/more`) | **Ready** | Link hub via `MORE_NAV_LINKS` |
| Schedule (`/schedule`) | **Preview** | `route_shell` card |
| Reports (`/reports`) | **Preview** | `route_shell` card |
| Settings (`/settings`) | **Preview** | `route_shell` card; nav link all role roots |
| Role-root routing (`/role-routing`) | **Ready** | F-RR1 matrix (unchanged) |
| Primary top nav | **Ready** | Schedule / Reports / Settings + role/domain filter |
| Speak FAB | **Ready** | `<a href="/field-capture">`; title "Opens field capture" |
| Export / print | **Partial** | Wired on project detail when `projectId` + `tenantId`; else preview notice |
| Blackboard / Decisions / KB | **Preview** | `route_shell` eyebrow + honest preview copy |

---

## Button / affordance matrix

| Control | Target | Mode |
|---------|--------|------|
| Home loops | `/field-capture`, `/relay`, `/projects`, `/draft-review` | Live |
| Mobile nav (5) | `/`, `/field-capture`, `/relay`, `/projects`, `/more` | Live |
| More menu links | schedule, reports, settings, secondary tools | Live links → Preview pages where noted |
| Top nav Schedule / Reports / Settings | same routes | Preview shells |
| Speak FAB | `/field-capture` | Live (F-E1 entry) |
| Export (project detail) | `POST /api/v1/projects/:id/export` | Live when `wired` |
| Export elsewhere | — | `shell.export.preview_notice` |

---

## Commits on branch (tip → stack base)

| SHA | Summary |
|-----|---------|
| `9594feb` | docs: report head SHA (gate tip at clean verify) |
| `eb3b09f` | docs: stacked posture, deps, proof |
| `7239033` | docs: report head SHA |
| `5b75d4a` | docs: stacked-on-B note |
| `0914f65` | fix: i18n parity after rebase |
| `cd925ae` | docs: verification SHAs |
| `38c1f6c` | fix: Batch D i18n keys + preview copy |
| `10ae5e3` | fix: schedule/settings nav role gates |
| `ae2d420` | fix: more.astro + report |
| `6171e44` | feat: Batch D shell (core) |
| `d5d9f13` | Batch B stack base |
| `3c7063b` | Batch B: `ProjectTabContent`, relay, audit |

---

## Limitations

- Schedule / Reports / Settings are preview shells only.  
- Speak FAB opens field capture, not a dedicated voice modal.  
- Home loop grid does not filter Draft review by role (top nav does).  
- Spanish: `__pending_review__` on some Batch D strings.  

---

## Remote

`origin/phase-1i-batch-d-schedule-reports-settings-shell` — pushed; do not merge to `main` without Phase 1I sign-off.
