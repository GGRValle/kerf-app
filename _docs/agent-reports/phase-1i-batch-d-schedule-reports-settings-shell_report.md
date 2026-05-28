# Phase 1I · Agent D — Schedule, Reports, Settings & Shell

**Branch:** `phase-1i-batch-d-schedule-reports-settings-shell`  
**Head commits:** `ca5a479` (shell) + fix on branch  
**Agent:** D (Batch D)  
**Date:** 2026-05-28  
**Merge:** Do not merge (gate branch only)

## Goal

Make the operator shell coherent: home loops, mobile nav, schedule/reports/settings surfaces, Speak FAB, and export/print affordances route honestly (live or Preview). No dead primary buttons; no debug language in chrome.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `npm run build:astro` | Pass |
| `node --import tsx --test tests/phase-1i-batch-d-shell.test.ts` | **10/10** pass |
| `npm test` (full) | **1466/1466** pass |

## Surface status

| Surface | Status | Notes |
|---------|--------|-------|
| Home / dashboard (`/`) | **Ready** | `HomeLoopGrid` links Capture, Relay, Projects, Draft review |
| Mobile bottom nav | **Ready** | Fixed bar: Home · Capture · Relay · Jobs · More; hidden ≥900px |
| More (`/more`) | **Ready** | Preview card + link list to schedule, reports, settings, and secondary tools |
| Schedule (`/schedule`) | **Preview** | `route_shell` card; no calendar API |
| Reports (`/reports`) | **Preview** | `route_shell` card; audit domain in nav |
| Settings (`/settings`) | **Ready** (shell) | Preview body; route exists for all role roots |
| Role-root routing (`/role-routing`) | **Ready** | Existing F-RR1 matrix unchanged |
| Primary top nav | **Ready** | `nav.ts` adds schedule / reports / settings with domain + role filters |
| Speak FAB | **Ready** | `<a href="/field-capture">` — F-E1 capture entry; title "Opens field capture" |
| Export / print | **Partial** | `ExportPrintBar` wired on project detail when `projectId` + `tenantId`; else preview notice |
| Blackboard / Decisions / KB ingestion | **Preview** | Batch D normalized to `route_shell` eyebrow + domain preview copy |
| Project detail export | **Ready** (fixture) | `ActionsStrip` → `ExportPrintBar` with `wired` + POST export API |

## Button / affordance matrix

| Control | Target | Mode |
|---------|--------|------|
| Home loop: Field capture | `/field-capture` | Live |
| Home loop: Relay | `/relay` | Live |
| Home loop: Projects | `/projects` | Live |
| Home loop: Draft review | `/draft-review` | Live |
| Mobile nav (5) | `/`, `/field-capture`, `/relay`, `/projects`, `/more` | Live |
| More → Schedule / Reports / Settings | respective routes | Preview shells |
| Top nav Schedule / Reports / Settings | same | Preview (role/domain filtered) |
| Speak FAB | `/field-capture` | Live (capture, not voice session) |
| Export Print / PDF (project detail) | `POST /api/v1/projects/:id/export` | Live when wired |
| Export elsewhere | — | Preview notice via `shell.export.preview_notice` |

## Files (Batch D commit + follow-up)

**New:** `src/app/lib/shellRoutes.ts`, `HomeLoopGrid.astro`, `MobileBottomNav.astro`, `ExportPrintBar.astro`, `more.astro`, `schedule.astro`, `reports.astro`, `settings.astro`, `tests/phase-1i-batch-d-shell.test.ts`, `_scripts/apply_batch_d.py`

**Updated:** `Layout.astro`, `SpeakFAB.astro`, `ActionsStrip.astro`, `index.astro`, `nav.ts`, `shell.css`, project `[id]/index.astro` & `[tab].astro`, `en.ts` / `es.ts` / `keys.ts`, preview pages (blackboard, decisions, kb-ingestion)

**Follow-up (uncommitted):** `more.astro` uses `route_shell.body` (removed orphan `shell.more.body` key); `nav.ts` settings visible to all role roots; schedule nav limited to roles with `schedule` domain.

## Limitations / deferrals

- Schedule, reports, and global settings are **preview shells** only — no Gantt, ledger, or tenant prefs API.
- Home grid always shows Draft review (not filtered per role on the grid; top nav still role-filters).
- Speak FAB opens **field capture**, not a dedicated voice/E1 modal (honest per wireframe phase).
- Spanish Batch D strings use `__pending_review__` where not yet translated.
- Unrelated working-tree edits (relay API, project audit panels) are **out of scope** for this branch commit.

## i18n keys added (Batch D)

`nav.schedule`, `nav.reports`, `nav.settings`, `home.*`, `shell.nav.*`, `shell.mobile_nav.aria`, `shell.more.title`, `shell.export.preview_notice`, `schedule.title`, `reports.title`, `settings.title`, `layout.speak_fab.title` → "Opens field capture" (EN).

---
*Gate: branch pushed when Christian adds to Phase 1I merge set. Do not merge to main without 1I sign-off.*
