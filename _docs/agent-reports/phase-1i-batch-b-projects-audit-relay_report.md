# Phase 1I Batch B — Projects, Audit, Relay

**Branch:** `phase-1i-batch-b-projects-audit-relay` @ `d9aa46e`  
**Base:** `origin/main` @ `d06815a`  
**Agent:** B  
**Scope:** Relay, Project List/Detail, project tabs, Status, Closeout, Work Orders, audit deep links  
**Do not merge** (dispatch instruction)

## Goal

Captured/drafted work is visible in the project world. The operator never wonders where field capture went.

## Should future branches stack on this branch?

**No — prefer `origin/main` after Batch B merges.**

| Lane | Stack on Batch B? | Reason |
|------|-------------------|--------|
| Batch A (capture/draft) | No | Parallel lane; merge to `main` independently. Capture already routes to relay/draft without B’s tree. |
| Batch C (money/proposal/client) | **No** | Hard boundary — money surfaces not owned here. |
| Batch D (shell/nav/schedule) | **No** | Global layout/nav; must not ride on project branch. |
| Post-1I integration | Only if testing **before** B lands on `main` | Temporary; rebase integration branches onto updated `main` once B merges. |

**Merge order recommendation:** Land Batch B on `main` (with A/C/D in any order that respects boundaries), then stack follow-on work on `main` — not on this feature branch long-term.

## Shared dependency exports (for other batches)

If another lane needs project-world wiring **before** B is on `main`, import these — do not fork copies:

| Export | Path | Use |
|--------|------|-----|
| `auditEntryLink()` | `src/app/lib/projectAuditLinks.ts` | Audit row → relay / draft / proposal / transcript hrefs |
| `ProjectTabContent` | `src/app/components/project/ProjectTabContent.astro` | Per-tab project panels (audit/field/budget/…) |
| `PreviewNotice` | `src/app/components/project/PreviewNotice.astro` | Preview chip + honest defer copy |

Relay API additions (`GET /field-daily/relay-feed` enrichment, `POST /relay-cards/:id/review`) live in `src/api/routes/relay.ts` — Batch A/C should not duplicate.

## Hard boundary compliance

- **No money/client surface edits** — diff vs `origin/main` is project/relay/i18n/relay API only.
- **No global nav/layout** — `nav.ts`, `Layout.astro`, shell components untouched.

## Clean-worktree proof (2026-05-28)

Run from repo root on branch `phase-1i-batch-b-projects-audit-relay`, `git status` clean (after `npm ci`):

```bash
npm run typecheck
npm run build:astro
node --import tsx --test tests/phase1i-batch-b-projects-audit-relay.test.ts tests/phase1d-audit-projection.test.ts
```

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run build:astro` | Pass |
| Focused tests (above) | **12/12** pass |

## Surface status

| Surface | Status | Notes |
|---------|--------|-------|
| Relay list | **Ready** | Cards `<a href="/relay/{entry_id}">` + CTA |
| Relay detail | **Ready** | Feed-backed; project / audit anchor / draft links; **Mark reviewed** → review API |
| Relay API feed | **Ready** | `project_name`, `surfaced_event_id`, `reviewed`, `reviewed_outcome` |
| Relay review API | **Ready** | `POST /relay-cards/:relayCardId/review` (event-sourced) |
| Project list | **Ready** | Fixture list; rows → detail |
| Project detail (scope) | **Ready** | Quick links → field, relay, audit |
| Project tabs — audit | **Ready** | SSR `ProjectAuditPanel` + projection |
| Project tabs — field | **Ready** | Capture / relay / field-detail; WO → detail |
| Project tabs — budget | **Preview** | Fixture cents + Preview notice |
| Project tabs — schedule | **Partial** | Status link + Preview notice |
| Project tabs — comms | **Partial** | Transcript + relay links + Preview |
| Project tabs — media / todo / files | **Preview** | Panel copy + Preview notice |
| Project tabs — scope | **Ready** | `/scope` redirects to project index |
| Project status | **Ready** | Phase/activity + scope/audit/relay links |
| Project closeout | **Preview** | Read-only steps; no fake completion; audit link |
| Work orders | **Ready** | WO detail from field tab |
| Audit deep links | **Ready** | `auditEntryLink()`; `id="audit-{event_id}"` |
| Project export | **Ready** | ActionsStrip → export API + status line |

## Button-to-loop

| Control | Routes to |
|---------|-----------|
| Relay card | `/relay/{entry_id}` |
| Relay detail → project | `/projects/{project_id}` |
| Relay detail → audit | `/projects/{project_id}/audit#audit-{event_id}` |
| Relay detail → draft | `/draft-review` |
| Mark reviewed | `relay_card.reviewed` event |
| Audit row link | relay / draft-review / proposal / transcript-review |
| Field tab | `/field-capture`, `/relay`, `/field-detail` |
| Closeout | audit only (no complete toggle) |
| Preview tabs | **Preview** chip + defer copy |

## Files changed (vs `origin/main`)

- `src/api/routes/relay.ts`
- `src/app/lib/projectAuditLinks.ts`
- `src/app/components/project/PreviewNotice.astro`, `ProjectTabContent.astro`
- `src/app/components/ProjectAuditPanel.astro`
- `src/app/pages/relay/index.astro`, `relay/[id].astro`
- `src/app/pages/projects/[id]/index.astro`, `[tab].astro`, `status.astro`, `closeout.astro`
- `src/i18n/keys.ts`, `en.ts`, `es.ts`
- `tests/phase1i-batch-b-projects-audit-relay.test.ts`

## Out of scope / defer

- Gantt, media library, todo routing, files vault (Preview)
- Closeout completion toggle (irreversible — Preview)
- `field-capture.astro` (Batch A)
