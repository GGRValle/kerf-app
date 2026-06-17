# Right Hand Wireframe Implementation Release Plan

This plan converts the closed wireframe map into the next implementation train.
Use it after PR #388 lands. The generated source of truth remains:

- `docs/wireframes/wireframe-flow-map.html`
- `docs/wireframes/wireframe-system-build-backlog.md`
- `docs/wireframes/wireframe-system-lane-dispatches.md`
- `docs/wireframes/wireframe-system-gap-register.md`

## Current Map State

- Canon faces mapped: 154
- Missing Canon face records: 0
- Transition gaps that still open a gap screen: 0
- External duplicate-ID conflicts: 2
- Implementation cards: 17

The map is closed, but the app is not. A face being `canon_present` means the
Canon HTML exists and the click path is known. It does not mean the live route
already matches the face.

## Merge Order

1. Merge the camera crash hotfix PR first if it is still open.
   - PR: #389
   - Reason: production-facing one-line crash fix, independent of the map.
2. Merge the map PR.
   - PR: #388
   - Reason: this gives every lane the same route, face, gate, and click-path
     contract.
3. Rebase every implementation lane on the new `main`.
4. Do not merge a surface PR unless the phone/browser gate below passes before
   merge. Auto-deploy means a merged failure is already live.

## Gate For Every Surface PR

Before merge:

1. Open the source face in `docs/wireframes/wireframe-flow-map.html`.
2. Click every listed source transition for that implementation card.
3. Open the matching live app route on a phone viewport or real phone.
4. Verify the live route matches the F-* face and the operable prototype for:
   - flow
   - visible structure
   - bottom/global chrome
   - route ownership
   - named gate
   - mobile/desktop device lane
5. Confirm the source click does not land on a gap page, dead route, old holding
   page, or route that owns the wrong artifact.
6. Run the relevant tests plus `npm run typecheck` and `npm run build:astro`.
7. Record the served commit from `/health` after deploy.

The app is not considered wired when it merely links somewhere. It is wired only
when the click lands on the correct Canon face, with the correct gate, on the
correct owning route.

## P0 Train

### 1. Camera Hotfix

- PR: #389
- Route: `/camera`
- Gate: capture route confirmation
- Phone proof:
  - Camera opens without a JavaScript init crash.
  - Route options include existing job, new client/lead, new project, and review.
  - Confirm/file gives a visible success or visible failure, never a silent noop.

### 2. Map Baseline

- PR: #388
- Routes: map/docs plus `WIREFRAME_SPINE_MAP`
- Gate: no production behavior expected
- Proof:
  - `wireframe-system-gap-register.md` says 0 missing face records and 0 transition gaps.
  - PR verify is green.

### 3. Chrome/Home/Right Hand Bubble

- Lane: Codex + Claude chrome
- Suggested branch: `sprint2/chrome-home-rh-wireframes`
- Faces:
  - `F-A1b_mobile_owner_home_v5_pulse.html`
  - `F-RH7_bubble_transitions.html`
- Owning routes:
  - `/`
  - global Right Hand overlay
- Gates:
  - `attention_queue`
  - `right_hand_route_only`
- Phone proof:
  - Home has no visible back button.
  - Home shows One Thing, On Deck, and The Pulse in F-A1b grammar.
  - Red appears as chip/dot state only, not as row rails.
  - Bottom bar is Home, Start/Create, center mic silhouette, Camera, More.
  - One mic owns voice entry.
  - Right Hand grows from bottom mic, can collapse to the side "Tap to talk" pill,
    and composer is attach, type, mic.

### 4. Daily Log

- Lane: Cursor A capture/log
- Suggested branch: `sprint2/capture-log-wireframes`
- Face: `F-DL1_mobile_daily_log.html`
- Owning route: `/projects/:id/daily-log`
- Gate: `capture_route_confirm`
- Phone proof:
  - Camera and Field Capture file to a flat Daily Log surface.
  - No nested surface-in-surface layout.
  - Media file gate is visible before durable filing.

## P1 Train

### 5. Estimate And Change Order

- Lane: Cursor B estimate/CO
- Suggested branch: `sprint2/estimate-co-wireframes`
- Faces:
  - `F-EST1_mobile_estimate_builder.html`
  - `F-CHG1_mobile_change_order_builder.html`
- Owning routes:
  - `/estimate/:projectId`
  - `/change-orders/new`
- Gates:
  - estimate publish/proposal: `operator_confirm`
  - change order: `operator_confirm then F-B1 decision`
- Phone proof:
  - Start, Sales, Proposal, and Design clicks reach the estimate builder.
  - "Now give me the proposal" preserves estimate context and line IDs.
  - Change Order uses the builder, then routes to F-B1 Decision Card.
  - No generic dead "draft" state.

### 6. Per-Job Invoice And Money

- Lane: Cursor C money
- Suggested branch: `sprint2/money-invoice-wireframes`
- Faces:
  - `F-INV1a_mobile_per_job_invoice_list.html`
  - `F-INV2a_mobile_per_job_invoice_detail.html`
  - `F-INV1b_desktop_per_job_invoice_list.html`
  - `F-INV2b_desktop_per_job_invoice_detail.html`
- Owning routes:
  - `/estimate/:projectId/invoice`
  - `/projects/:id/money/invoices`
  - `/money/invoices/:id`
- Gate: `money_guard`
- Phone/desktop proof:
  - Invoice is a per-job list: deposit, progress, final.
  - Detail drill shows the selected invoice only.
  - Issue/record payment actions stay behind money guard.
  - Money can find the same invoice across jobs.

## P2 Train

### 7. Intake, Project Setup, Design

- Lane: Cursor D intake/sales
- Suggested branch: `sprint2/intake-sales-wireframes`
- Faces:
  - `F-CL0a_mobile_client_create.html`
  - `F-CL0b_desktop_client_create.html`
  - `F-PR0a_mobile_project_setup.html`
  - `F-PR0b_desktop_project_setup.html`
  - `F-DES1a_mobile_design_workspace.html`
  - `F-DS1_desktop_design_workspace.html`
- Owning routes:
  - `/clients/new`
  - `/projects/new`
  - `/design/:projectId`
- Gates:
  - create client/project: `operator_confirm`
  - design workspace: `review_gate`
- Phone/desktop proof:
  - Camera can route a capture to new lead, new project, or review, not job-only.
  - Client and project creation are explicit graph writes, not silent side effects.
  - Design workspace bridges deal detail to estimate without skipping review.

## P3 Train

### 8. Utility Surfaces

- Lane: Codex utility
- Suggested branch: `sprint2/utility-wireframes`
- Faces:
  - `F-UTIL1a_mobile_connections_kb_blackboard.html`
  - `F-UTIL1b_desktop_connections_kb_blackboard.html`
- Owning routes:
  - `/connections`
  - `/kb-ingestion`
  - `/blackboard`
- Gate: `admin_gate / review_gate`
- Phone/desktop proof:
  - More -> Blackboard opens a read-only utility face.
  - More -> Cost KB opens review-only knowledge ingestion.
  - Settings -> Connections opens admin-gated connections.
  - No hidden OAuth, no hidden cost promotion, no hidden memory write.

## Definition Of Done

A surface is done only when all are true:

- The map source click lands on the live routed surface.
- The live surface matches the mapped F-* face on its device lane.
- The live surface preserves the named gate and artifact owner.
- The app build and tests are green.
- The deployed `/health` commit matches the merged PR commit.
- The founder/conductor can verify the surface on the phone without needing repo
  context to understand what should happen next.

