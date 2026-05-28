# Phase 1I Batch B — Projects, Audit, Relay

**Branch:** `phase-1i-batch-b-projects-audit-relay` @ `3c7063b`  
**Agent:** B  
**Scope:** Project operating surfaces and after-capture work queue  
**Do not merge** (dispatch instruction)

## Goal

Make captured/drafted work visible in the project world so the operator does not wonder where field capture went.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `npm run build:astro` | Pass |
| Focused tests | `tests/phase1i-batch-b-projects-audit-relay.test.ts`, `tests/phase1d-audit-projection.test.ts` — pass |
| Full `npm test` | **1456/1456** pass (relay API + audit projection touched) |

## Surface status

| Surface | Status | Notes |
|---------|--------|-------|
| Relay list | **Ready** | Cards are `<a href="/relay/{entry_id}">` with CTA label |
| Relay detail | **Ready** | Feed-backed detail; links to project, audit anchor, draft review; **Mark reviewed** → `POST /api/v1/relay-cards/:id/review` |
| Relay API feed | **Ready** | Enriched items: `project_name`, `surfaced_event_id`, `reviewed`, `reviewed_outcome` |
| Relay review API | **Ready** | `POST /relay-cards/:relayCardId/review` on shell router (event-sourced) |
| Project list | **Ready** | Unchanged fixture list; rows link to detail |
| Project detail (scope) | **Ready** | Quick links → field tab, relay, audit |
| Project tabs — audit | **Ready** | SSR `ProjectAuditPanel` + fixture/event projection |
| Project tabs — field | **Ready** | Capture / relay / field-detail links; work orders link to WO detail |
| Project tabs — budget | **Preview** | Fixture cents + Preview notice |
| Project tabs — schedule | **Partial** | Link to status + Preview notice |
| Project tabs — comms | **Partial** | Transcript + relay links + Preview notice |
| Project tabs — media / todo / files | **Preview** | Panel copy + Preview notice |
| Project tabs — scope | **Ready** | Redirects to project index (scope lives on index) |
| Project status | **Ready** | Phase/activity + links to scope, audit, relay |
| Project closeout | **Preview** | Read-only steps; Preview chip; no fake toggle; audit link |
| Work orders | **Ready** | Existing WO detail route from field tab |
| Audit deep links | **Ready** | `auditEntryLink()` per event kind; row `id="audit-{event_id}"` |
| Project export (print/PDF) | **Ready** | Tab page wires ActionsStrip → export API + status line |

## Button-to-loop (Batch B)

| Control | Routes to |
|---------|-----------|
| Relay card | `/relay/{entry_id}` |
| Relay detail → project | `/projects/{project_id}` |
| Relay detail → audit | `/projects/{project_id}/audit#audit-{event_id}` |
| Relay detail → draft | `/draft-review` |
| Mark reviewed | API → `relay_card.reviewed` event |
| Audit row link | relay / draft-review / proposal / transcript-review |
| Field tab links | `/field-capture`, `/relay`, `/field-detail` |
| Scope/status quick links | field tab, relay, audit |
| Closeout | audit trail (no complete toggle) |
| Preview tabs | Labeled **Preview** chip + honest copy |

## Files touched

- `src/api/routes/relay.ts` — feed enrichment + review POST
- `src/app/lib/projectAuditLinks.ts` — new
- `src/app/components/project/ProjectTabContent.astro`, `PreviewNotice.astro` — new
- `src/app/components/ProjectAuditPanel.astro`
- `src/app/pages/relay/index.astro`, `relay/[id].astro`
- `src/app/pages/projects/[id]/index.astro`, `[tab].astro`, `status.astro`, `closeout.astro`
- `src/i18n/keys.ts`, `en.ts`, `es.ts`
- `tests/phase1i-batch-b-projects-audit-relay.test.ts`

## Out of scope / defer

- Schedule Gantt, media library, todo routing, files vault (Preview only)
- Closeout step completion (irreversible — gated Preview)
- `field-capture.astro` (not edited)
