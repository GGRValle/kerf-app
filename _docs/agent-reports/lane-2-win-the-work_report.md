# Lane 2 · Win the Work — report-back

**Branch:** `lane-2-win-the-work` · **Served sha:** `ab85510` · `/health` → `{"commit":"ab8551073271cf111fa6df25347f2e8fff3a0d6f","dirty":false,"source":"git"}`

**Substrate:** `GGRValle/kerf-app` (Astro shell), branched from `origin/main` **after** #287 (the seven shell contracts are merged). The folded-in lane-3 slice (`da76090`) and my lane-2 spine (`d2b4e86`) sit on top; the Win-the-Work fix-queue + seam is `ab85510`.

---

## 1 · The path I drove (device + route)

Desktop, against the live shell on `:8020` (`npm run serve:shell`, API at `/api/v1`):

**Price it →** open lead `/sales` → `/sales/:id` → **Enter Design** `/design/:projectId` → *Pull from Library* (Selections tab) → approve → Project Selection instance → `/estimate/:projectId` (integer cents, markup folded/hidden, totals reconcile) → **proposal draft**.

**Win it →** proposal draft → `publishProposalToPortal` creates a pending **client portal approval** at the **client-facing total only** → client opens their door `/portal/s/:token` → confirms → propagates a Project Selection (`lifecycle: approved`) **and** a schedule assignment ref. Operator sees it on the **GC preview** `/projects/:id/portal-preview`, which resolves the client *from the project*.

Live proof (curl):

| Step | Result |
|---|---|
| `GET /portal/preview?...&project_id=proj_wegrzyn_kitchen` | `200` · `client_id=client_wegrzyn` · 2 approvals · **no cost/margin leak** |
| same with `&client_id=client_dunne` (mismatch) | `403` `project_client_binding_mismatch` |
| same with unbound `project_id=proj_nope` | `404` `project_not_bound_to_client` |
| `POST /portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_quartz/confirm` `{confirmed:true}` | `200` · `lifecycle=approved` · `sched_proj_wegrzyn_kitchen_appr_wegrzyn_quartz` |
| wegrzyn token confirms **dunne's** approval | `403` (cross-CLIENT isolation) |

---

## 2 · What I self-healed

- **Folded lane-3 onto the merged contract base.** Cherry-picked `da76090` (clients/portal/success/warranty) + my lane-2 feat onto `origin/main`; resolved `projects.ts` (kept Lane 1's `buildStampPayload` health route) and `router.ts` (mount both `clientPortalRoutes` + `salesDesignKbRoutes`); dropped lane-3's now-superseded `buildStamp.ts`.
- **Conformed to #287's Selection contract.** `library_item_id → library_ref`; replaced my private lifecycle table with the shared `SELECTION_LIFECYCLE_ORDER`; route markup through `assertSelectionClientVisibility` at the pull boundary.
- **Fix-queue · real project↔client binding.** `/portal/preview` no longer trusts a `client_id` query and the preview page no longer hardcodes `client_wegrzyn`. The client is resolved **from the project** via `PROJECT_CLIENT_BINDING`; mismatch → `403`, unbound → `404` + honest "no client bound" state.
- **Fix-queue · distinct `client_approval.confirmed` event.** Added it additively to the shared persistence event union (+ interface + validator + runtime guard). The portal confirm handler **stopped reusing operator `decision.approved`** — the client is the actor and only the client-facing total is recorded (no cost/margin on the event).
- **Fix-queue · post-#287 conformance.** Registered `clients/:id`, `clients/:id/warranty`, `projects/:id/portal-preview`, `client-success`, `client-success/:clientId` with mandatory `backTo` (no query strings); kept the client-facing portal door out of the operator registry. Built **approval-needed** (`needs_you`) and **warranty-expiring** (`risk_changed`) AttentionCards via the shared emitter, agent-free copy.
- **Cross-CLIENT isolation.** Asserted beyond wrong-project: a client can't read or confirm another client's data (preview mismatch, session scope, and `publishProposalToPortal` refuses a project not bound to the client).
- **Design 5 tabs / KB 5 collections** remain wired-or-honestly-stubbed from the spine lane (Selections + Selections/Assemblies/Templates functional; the rest labelled "not built yet").

**Tests:** 11 new (`tests/lane-2-win-the-work.test.ts`) + existing lane-2/lane-3 green. Full suite **1618/1621**; the 3 failures are the **retired v15 vertical slice** smoke tests (need a live `:8010` server + `app.bundle.js`; I touched none of `src/examples/v15-*`). Typecheck + Astro build clean.

---

## 3 · Residual risk / what's rough or faked (fix queue, honest)

- **Two project-id namespaces.** Lane-2 deals (`proj_dunne`, `proj_reyes`) and lane-3 portal fixtures (`proj_dunne_bath`, `proj_wegrzyn_kitchen`) don't yet share ids, so the *fully automatic* proposal→portal hop only lands when the project is bound + sessioned. The seam (`publishProposalToPortal`) is real and tested; **unifying the project id space is the next stitch.**
- **In-memory fixtures.** Clients/approvals/warranties/sessions and the sales store are module-global, not durable. State persists only within a server run; portal `approvalState` mutates process-wide (tests isolate the event store, not the fixture map).
- **Portal login is fixture lookup** (email substring → seeded session). No real auth on the client door yet; opaque token is seeded, not minted/expiring.
- **Warranty entity** is frame-1 only (term, coverage, claims_open, `expires_on`, expiring-window helper). No claim workflow.
- **AttentionCards are built + emitted** conformantly but Home/On-Me/Pulse rendering is another lane's surface — I produce the artifacts, I don't own where they paint.

---

## 4 · What needs human judgment

- **Shared event union edit.** I added `client_approval.confirmed` to `src/persistence/events.ts` (the file invites additive types at the end). It's a shared/Lane-1-adjacent contract — please confirm this is the right home vs. a lane-scoped event, since other lanes also depend on that union.
- **Markup model.** Default markup bps live on catalog items and fold into the client price; the *policy* for default margins per line type is a business call, not a code one.
- **Lane seams to ratify:** → Lane 3 (approved selection → project), ↔ Lane 4 (estimate → money lines; warranty *entity* ↔ warranty *tracking*; proposal **send** must run through Lane 4's delivery gate — I draft + publish-for-approval only, never send).

---

## 5 · Served sha

`/health` → `commit: ab8551073271cf111fa6df25347f2e8fff3a0d6f`, `dirty: false`, `source: git`. Branch `lane-2-win-the-work` pushed to `origin`. I cannot gate my own work — ready for independent review + merge.
