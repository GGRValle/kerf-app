# Wireframe Spine Map

Last updated: 2026-06-16

This document explains how the app spine is mapped to the Canon wireframe faces.
The enforceable source of truth is:

- `src/app/lib/wireframeSpineMap.ts`
- `tests/wireframe-spine-map.test.ts`

The human rule is simple:

1. Every app route has one owning surface.
2. Every owning surface has an appropriate Canon face.
3. Every button/link that changes surface must point to the next route and next face.
4. Missing/future faces are named explicitly. They do not silently fall back to stale UI.

## What changed

Before this map, the repo had:

- `docs/wireframes/canon`: 113 Canon `F-*` HTML faces.
- `src/app/pages`: 82 Astro page routes.
- `src/shell/surfaceCatalog.ts`: a role/route/backTo registry.
- `docs/SURFACE_GRAMMAR.md`: shared Canon grammar, but scoped to surfaces that opt in.
- `tests/surface-parity.test.ts`: a grammar gate that arms only after a route uses `data-grammar="canon"`.

That meant the app could pass tests while a route still had no hard visual/flow contract.
This map closes that gap at the route/face level.

## Enforcement

The new test locks four things:

- Every Astro page route is represented in `WIREFRAME_SPINE_MAP`.
- Every registered shell route from `surfaceCatalog.ts` and `src/sales/surfaces.ts` is represented.
- Every Canon `F-*` file in `docs/wireframes/canon` is accounted for by a live route map or a future/unrouted reference.
- External conductor/user references that are not in the repo, such as `F-RH7`, `F-EST1`, `F-CHG1`, and `F-DL1`, stay named explicitly until they are imported.

If a new app page, shell route, or Canon wireframe appears without a map entry, the suite fails.

## Current Status Summary

### Canon-wired now

These routes currently opt into the Canon grammar layer or are wired to the new shared Canon surface work:

| Route | Canon face | Notes |
|---|---|---|
| `/camera` | `F-CAM1_mobile_camera.html` | Capture-first camera. Phone gate still owns actual tap/viewport verification. |
| `/field-capture` | `F-E1_mobile_field_capture.html` | Capture-first field note with route preflight. |
| `/right-hand` | `F-RH1_mobile_right_hand_voice_overlay.html`, `F-RH3_mobile_right_hand_conversation_lifecycle.html` | Fallback route for Right Hand. F-RH7 bubble is external/missing from repo canon. |

### Mapped but still pending rebuild

These routes now have a face contract, but the live UI is not guaranteed to match yet:

| Route group | Canon faces |
|---|---|
| Home / role homes | `F-A1`, `F-A2`, `F-P1/P2`, `F-AO1/AO2`, `F-TO1/TO2`, `F-SH1/SH2`, `F-ES1/ES2`, `F-C1`, `F-FL1`, `F-SU1/SU2` |
| Projects | `F-PR1/PR3`, `F-PR2/PR4`, `F-PS1`, `F-CO1a/b`, `F-W1` |
| Sales / estimate / proposal | `F-SL1/2`, `F-SL3/4`, `F-PV1/2`; `F-EST1` is external/missing |
| Money | `F-MN1/2`, `F-MN3/4`, `F-MN5a/b`, `F-MN6a/b`, `F-MN7a/b`, `F-BK1a/b`, `F-BK2` |
| Clients | `F-CL1/3`, `F-CL2/4`, `F-CL5/6`, `F-WW1a/b`, `F-CS1/2` |
| Ops/Admin | `F-D1`, `F-SC1/2`, `F-SB1/2`, `F-CR1/2`, `F-RP1/2`, `F-SP1`, `F-SP1a`, `F-RR1`, `F-H1` |

### Missing or external faces

These are referenced by the conductor/user flow, but they are not currently present
under `docs/wireframes/canon`:

| Missing/external face | Intended route |
|---|---|
| `F-A1b_mobile_owner_home_v5_pulse.html` | `/` |
| `F-RH7_bubble_transitions.html` | global Right Hand overlay |
| `F-EST1_mobile_estimate_builder.html` | `/estimate/:projectId` |
| `F-CHG1_mobile_change_order_builder.html` | `/change-orders/new` |
| `F-DL1_mobile_daily_log.html` | `/projects/:id/daily-log` |
| `RightHand_Fix_Review_2026-06-14.html` | integrated reference across spine surfaces |

These should be imported into the canon folder or replaced by the new superseding
wireframes when the next full face pack lands.

## Primary Phone Spine

The bottom bar must remain stable:

| Button | Route | Face |
|---|---|---|
| Home | `/` | `F-A1_mobile_owner_home.html` |
| Start | `/create` | `F-S1_mobile_start_action_sheet.html` |
| Speak | `/right-hand` / overlay | `F-RH1`, `F-RH3`, external `F-RH7` |
| Camera | `/camera` | `F-CAM1_mobile_camera.html` |
| More | `/more` | `F-D1_mobile_more_sidebar.html` |

## Primary Transition Map

### Home

| Trigger | Route | Next face |
|---|---|---|
| One Thing card | `attention.href` | Route-specific face |
| On Deck item | `attention.href` | Route-specific face |
| Pulse item | `attention.href` | Route-specific face |
| Bottom Start | `/create` | `F-S1` |
| Bottom Speak | `/right-hand` / overlay | `F-RH1/F-RH3/F-RH7` |
| Bottom Camera | `/camera` | `F-CAM1` |
| Bottom More | `/more` | `F-D1` |

Known leak: `/home/owner` still renders a visible `NavBack href="/"`. The root
route hides the audit back seam, but the role route does not. That is shell
leakage, not Canon home behavior.

### Start Sheet

| Trigger | Current route | Next face |
|---|---|---|
| New estimate | `/projects/new?src=create` | Currently project setup; should eventually land estimate path once `F-EST1` is imported |
| Daily log note | `/field-capture?src=create` | `F-E1` |
| Change order | intended `/change-orders/new?src=create` | external `F-CHG1`, then `F-B1`; current main still routes through draft review |
| Invoice | `/money?src=create` | `F-MN1`; per-job invoice face missing |
| Room scan / LiDAR | `/room-capture?src=create` | `F-RC1` |
| Ask Right Hand | `/right-hand` | `F-RH1/F-RH3/F-RH7` |

### Camera

| Trigger | Route | Next face |
|---|---|---|
| Close X | `return_to` or `/` | Previous face |
| Room scan | `/room-capture?src=camera&mode=start` | `F-RC1` |
| Search jobs | `/projects?src=camera` | `F-PR1` |
| Confirm and file | `/projects/:id?src=camera` | `F-PR2`, with Daily Log handoff |

Canon rule: Camera opens to capture first. Destination selection happens after capture.

### Field Capture

| Trigger | Route | Next face |
|---|---|---|
| Photo | `/camera?src=field-capture` | `F-CAM1` |
| Done / file note | project route or relay route | Project/Daily Log or review face |
| Open office review | `/relay` | `F-FU1` |
| Transcript review | `/transcript-review` | `F-F1` |
| Draft preview | `/draft-review/:draft_id` | `F-G1` |
| Field detail | `/field-detail` | `F-FD1/F-FD2` |

### Project

| Trigger | Route | Next face |
|---|---|---|
| Project row | `/projects/:id` | `F-PR2/F-PR4` |
| Daily Log | `/projects/:id/daily-log` | external `F-DL1` |
| Status | `/projects/:id/status` | `F-PS1` |
| Portal preview | `/projects/:id/portal-preview` | currently folded into `F-CS1/F-CS2` |
| Work order | `/projects/:id/work-orders/:wid` | `F-W1` |
| Closeout | `/projects/:id/closeout` | `F-CO1a/b` |

Canon rule: Project remains the canonical home. Documents and money can deep-link
from it, but they do not become orphan artifacts.

### Estimate -> Proposal -> Invoice -> Money

| Trigger | Route | Next face |
|---|---|---|
| Deal detail: Design | `/design/:projectId` | Deal/detail face; dedicated design face missing |
| Design: Build estimate | `/estimate/:projectId` | external `F-EST1` |
| Estimate: Generate proposal | `/estimate/:projectId/proposal` | `F-PV1/F-PV2` |
| Proposal: Create down-payment invoice | `/estimate/:projectId/invoice` | per-job invoice face missing |
| Proposal: Open Money | `/estimate/:projectId/money` | `F-MN1/F-MN2` |
| Invoice: Open Money | `/estimate/:projectId/money` | `F-MN1/F-MN2` |
| Money: AR/AP/Allowances/Bookkeeping/Margin | `/money/*` | relevant `F-MN*` / `F-BK*` face |

Known gap: the repo has `F-PV1/F-PV2` for proposal and `F-MN*` for money, but
not the dedicated estimate builder face or per-job invoice list face the current
Canon conversation expects.

### Decisions / Change Order

| Trigger | Route | Next face |
|---|---|---|
| Decision card | `/decisions/:id` | `F-B1/F-B2` |
| Edit | `/decisions/:id?mode=edit` | `F-B1b` |
| Client preview | `/proposals/:id/send` | `F-B1c` |
| Approve change order | same route/API consequence | `F-B1`, then adjusted contract |

Known gap: external `F-CHG1` builder is not in this repo canon folder. The Cursor
change-order branch adds the builder route; this map keeps the missing face named.

### Money

| Trigger | Route | Next face |
|---|---|---|
| Money home | `/money` | `F-MN1/F-MN2` |
| AR | `/money/ar` | `F-MN6a/b` |
| AP | `/money/ap` | `F-MN7a/b` |
| Allowances | `/money/allowances` | `F-MN5a/b` |
| Bookkeeping | `/money/bookkeeping` | `F-BK1a/b` |
| QB export | `/money/qb-export` | `F-BK2` |
| Margin | `/money/margin` | `F-MN3/F-MN4` |

Money rule: no money write happens from a client-side hint. Consequential reads
and writes stay tenant-scoped and gated server-side.

### Clients

| Trigger | Route | Next face |
|---|---|---|
| Client row | `/clients/:id` | `F-CL2/F-CL4` and `F-CL5/F-CL6` |
| New client | `/clients/new` | no dedicated face; folded into clients list |
| New project for client | `/projects/new?client_id=:id` | project setup; no dedicated face |
| Warranty | `/clients/:id/warranty` | `F-WW1a/b` |
| Client success | `/client-success/:clientId` | `F-CS1/F-CS2` |
| Project row | `/projects/:id` | `F-PR2/F-PR4` |

## Future/Unrouted Canon Faces

These Canon files are accounted for, but not currently live as distinct routes:

- Admin landing: `F-AD1`, `F-AD2`
- Bar customization: `F-BC1`
- Client archive: `F-CA1a`, `F-CA1b`
- Time tracking / employee docs: `F-HR1a`, `F-HR1b`, `F-HR2`
- Lost deals: `F-LD1a`, `F-LD1b`
- Marketing: `F-MK1` through `F-MK10`
- Project media: `F-ML1`, `F-ML2`
- Project archive: `F-PA1a`, `F-PA1b`
- Purchasing/vendor: `F-PU1a`, `F-PU1b`, `F-PU2`
- Spend card framing: `F-VC1`

The map does not say these are unimportant. It says they are not currently live
operator routes and must not be mistaken for completed app surfaces.

## Build Rule Going Forward

For any surface rebuild:

1. Find the route in `WIREFRAME_SPINE_MAP`.
2. Confirm the owning Canon face.
3. Confirm every button/link edge lands on the mapped next face.
4. Add or update the route entry if the flow changes.
5. Add `data-grammar="canon"` only when the route has actually been rebuilt.
6. Let `tests/surface-parity.test.ts` enforce grammar.
7. Let `tests/wireframe-spine-map.test.ts` enforce route/face coverage.
8. Phone-gate the deployed build for tap/viewport behavior.

No new surface should merge with only "looks closer" as the proof.

