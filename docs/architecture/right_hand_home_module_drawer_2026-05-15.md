# Right Hand Home + Module Drawer — Design

- **Date:** 2026-05-15
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Design canon. Promoted from `docs/wireframes/kerf_wireframes_mobile_v2.html` (operator-phone frame) + `docs/wireframes/kerf_views_master_v1_0.html` (module-drawer reference) to an authoritative architecture spec.
- **Audience:** Christian, Cursor SDK workers, downstream UI builders.

---

## 1. Why this exists

The current V1.5 vertical slice (`src/examples/v15-vertical-slice/shell.ts`) renders a flat top-nav with 7 routes (Dashboard / Field Capture / Transcript Review / Draft Review / Decisions / Audit / Blackboard). That structure was correct for proving the decision loop end-to-end, but it doesn't match how the operator actually opens the app.

The wireframe canon (`kerf_wireframes_mobile_v2.html` FRAME 1) has long pinned a different shape: **Right Hand home is the landing surface; modules live in a bottom drawer, not in the primary nav**. This design doc lifts that pattern from wireframe canon into authoritative architecture so V1.5 build work can target it consistently.

This is also the resolution to a real product question Christian raised on 2026-05-15: *"current V1.5 wireframes are very workflow-spine focused; they do not yet fully show how a user moves from the main Right Hand surface into the broader operating system. I would add the module drawer as a core navigation pattern."*

---

## 2. The pattern in one paragraph

The operator opens the app and lands on **Right Hand home**. The screen shows **The One Thing** (the single highest-priority decision Right Hand is asking for), followed by a short queue of next-up items. There is **no top-nav and no module picker on the landing**. The persistent **bottom bar** carries three controls: a voice button (always tap-to-record), a module drawer trigger (`⌘`), and a Standard/Graphical view toggle. Modules are **destinations the operator visits**, accessed by tapping `⌘` and choosing from the drawer — not entries in a primary nav. This keeps the home surface conversational and decision-focused while making the structured operating modules one tap away.

---

## 3. Right Hand home surface (the landing)

### 3.1 Top region
- **Brand line**: `KERF` mark + tagline (`MAKE MORE.` per current canon)
- **Operator avatar** (top right) — opens the Me panel
- No top nav. No tabs. No module picker on this surface.

### 3.2 The One Thing card
The single highest-priority item Right Hand has surfaced. Per canon (`kerf_wireframes_mobile_v2.html`):
- Title (one line)
- "Why" line (one short paragraph — what triggered this and why now)
- Confidence bar with percentage
- Two primary actions: `Approve & send` (or other primary verb) + `Open`
- The card is the visual focus of the home surface

The One Thing is **not a feed**. It is **one decision at a time**. If Right Hand has nothing high-priority to surface, the card shows a soft "Nothing pressing — here's what's next" state and the Queue section takes the visual lead.

### 3.3 Queue · N more
Below The One Thing, a short list (3–5 items) of next-up decisions, change orders, drift signals, proposals to follow up on, etc. Each row carries:
- Brand tag (GGR / Valle / HPG)
- Title
- Relative time ("2h", "yesterday")
- One-line "why" / context

The queue is the bridge between The One Thing and full module surfaces. Tapping a queue row opens the full item view (a decision card, a proposal, a relay card, etc.).

### 3.4 The Pulse (below queue)
The lowest tier. Counters and trend lines: "4 proposals · 4 invoices · 4 drift" plus a "be aware" set of widgets. Pulse is awareness, not action.

### 3.5 Persistent bottom bar (always visible across all home tabs)
Three controls, in order:
1. **Voice button** (`▸` icon) — tap-to-record. Persistent across every screen including module destinations. Voice is the universal capture mechanism.
2. **Module drawer trigger** (`⌘` icon) — opens the bottom drawer (see §4)
3. **View toggle** (`Std` / `Graph`) — flips between the dense standard view and the graphical view (post-V1.5)

---

## 4. The module drawer

### 4.1 What it is
A bottom-anchored drawer that slides up from the `⌘` button on the bottom bar. The operator's hand is already at the bottom of the screen (voice button + drawer trigger), so the drawer opens **toward** the thumb, not away from it.

### 4.2 What it carries (Phase 1 — V1.5 release)

The Phase 1 drawer items are the minimum set needed for the GGR/Valle internal release on 2026-06-13:

| Module | Route (when built) | Purpose |
|---|---|---|
| **Jobs** | `/jobs` (or `/projects`) | Project list, project drill-in. Existing persistence projection feeds this. |
| **Field Daily / Log** | `/field` or `/m/field` | Field Hand capture surface (mobile-first). See `field_daily_workflow_design_2026-05-15.md`. |
| **Materials** | `/materials` | Materials state per project: delivered / pending / missing / on-order. **Field Relay signal — not purchasing authority.** |
| **Decisions** | `/decisions` (existing) | Decision card queue + audit. |
| **Docs** | `/docs` | Project docs / proposals / contracts. |
| **Money** | `/money` | Project actuals + KB; no auto-pricing. |
| **Blackboard** | `/blackboard` | Five-rail Blackboard surface. |
| **Settings** | `/settings` | Tenant settings, branding, defaults. |

### 4.3 What it carries (Phase 2 — post-V1.5)

Reserved for later iterations; not built in V1.5:

- Schedule
- Crew
- Client (CRM-lite)
- Cost KB (browse + ingest)
- Reports
- Admin (multi-tenant, multi-user — post-2027 per D-025)

### 4.4 Drawer affordances
- Tapping a drawer item navigates to that module's route. The drawer closes.
- The drawer can be dismissed by tapping outside the drawer area, the `⌘` button again, or a small chevron at the drawer's top.
- The voice button **remains accessible** while the drawer is open — voice capture should never be gated by which surface the operator is on.
- The view toggle (`Std` / `Graph`) is **not** in the drawer — it stays on the bottom bar.

---

## 5. Field Hand bottom nav (the field-crew variant)

The Field Hand surface (`/field` or `/m/field`) does **not** use the module drawer. Field crew see a structured bottom nav with four tabs:

```
HOME  ·  JOB  ·  LOG  ·  ME
```

This is by design: field crew are operating on **one job at a time**, not navigating across an operator's module landscape. The Field Hand surface is task-focused, not module-focused.

The voice button is still persistent (left of the HOME tab), so field crew can tap-to-record from any tab.

Per-tab contents (full spec in `kerf_wireframes_mobile_v2.html` FRAMEs 2–5):

- **HOME** — Current job header · live clock status (see Field Daily clock-event spec) · today's task · this-week schedule · captures-today summary
- **JOB** — Sub-tabs: Scope / Docs / Crew / Materials. Materials shows three-way state + one-tap actions
- **LOG** — Auto-compiled timeline of the day; entries: clock_event / sms / task / photo / voice / blocker
- **ME** — Personal: hours this week + pay period, L0→L3 career ladder, Coach (RH's field-facing voice) nudges

---

## 6. The two surfaces relate, but don't share

| Right Hand home (operator) | Field Hand (field crew) |
|---|---|
| Mobile + web | Mobile-first |
| Decision-focused (The One Thing) | Task-focused (current job + clock) |
| Module drawer in bottom bar | Bottom nav: HOME / JOB / LOG / ME |
| One-at-a-time decisions | Timeline of the day |
| Operator authority (approve/edit/send) | Field reality (capture/clock/flag) — no business-authority commits |

The shared pattern is the **persistent voice button**. Capture is universal; nav is role-specific.

---

## 7. Architecture invariants the module drawer enforces

- **Modules are destinations, not the paradigm.** Right Hand home is the paradigm. Modules are where the operator goes to do structured work; they are not the front door.
- **The One Thing is conversational, not a feed.** Right Hand surfaces one decision at a time. If the operator wants to scan, they tap into Decisions module from the drawer.
- **Voice is universal.** Voice button is in the persistent bottom bar across every surface, including inside any module destination. No surface gates voice capture.
- **No autonomous side effects from the drawer.** Tapping a drawer item is pure navigation — it never triggers a write, a send, or a pricing action.
- **Field can't reach all modules.** Field Hand bottom nav (HOME/JOB/LOG/ME) is intentionally narrower than the operator drawer. Field crew don't get a Money module link, don't get a Settings link, don't get Cost KB access. The drawer pattern is operator-only.

---

## 8. Build implications for V1.5

The V1.5 vertical slice currently renders the operator-side as a flat top-nav. The 30-day release does not require a full Right Hand home build, but does require:

### 8.1 What MUST land before the June 13 internal release

1. The shell pattern: bottom-bar with voice + module drawer trigger on operator surfaces (not the field-capture iframe stub, but on `/dashboard` and any new operator routes)
2. At minimum, the drawer items in §4.2 must navigate to **something** — even if that "something" is a stub route that just renders the route name. Real modules ship incrementally; the drawer pattern ships once.
3. The One Thing card shape rendered on `/dashboard` (or a new `/` Right Hand home route). It can pull from the existing decisions queue for the V1.5 demo; the underlying intelligence layer that picks "the one thing" can be primitive (top-of-queue) at first.
4. Field Hand surface at `/field` or `/m/field` with HOME/JOB/LOG/ME bottom nav. Wire to existing field-capture surface for the HOME → "tap voice button" path; stub the other tabs for the demo.

### 8.2 What CAN defer to post-V1.5

- Module drawer animations / drag-up gesture (V1.5 can ship with tap-to-open / tap-to-close)
- Standard / Graphical toggle behavior (V1.5 can ship Std-only and leave the toggle dormant; flip to active when Graph view exists)
- L0→L3 ladder in Me tab (this is a separate talent-ladder feature; not blocking)
- Kerf Play authoring from Me (same — separate feature)
- Materials full module (Field Relay signal is in scope; full materials module isn't required for V1.5)

---

## 9. Decision needed

Two things before Step 6 (`/projects` UI / operator dashboard) build starts:

1. **Approve the home + drawer pattern as the V1.5 operator landing.** If approved, `/dashboard` becomes Right Hand home (One Thing + Queue + Pulse + bottom bar) rather than the current "what's in the kerf-v15-vertical-slice nav stack" overview page.
2. **Approve the drawer item list in §4.2.** Each item carries an implied (eventual) module surface. Phase 1 set is small; if Christian wants a different ordering or wants Money / Settings deferred to Phase 2, this is the place to say so.

Once these two are locked, the V1.5 shell refactor is unblocked and Field Hand surface build (Track C in the 30-day plan) can proceed against a known target.

---

## 10. Naming this doc anchors

- `Right Hand` / `Mano Derecha` — the operator-facing agent surface (Apr 26, 2026 rename canon)
- `Coach` — Right Hand's field-facing voice mode (used in Me tab nudges to crew)
- `Field Hand` / `Mano de Campo` — the field-crew agent surface
- `The One Thing` — the single highest-priority decision surfaced on Right Hand home. **Locked canon.**
- `On Deck` — the secondary queue below The One Thing
- `The Pulse` — counters and awareness widgets below the queue
- `Module Drawer` — the bottom drawer accessed via `⌘` carrying destinations like Jobs / Materials / Money / etc.
- `Standard / Graphical toggle` — view-mode flip persistent on the bottom bar
- `Std` / `Graph` — abbreviations used in the bottom bar
- `Persistent voice button` — the `▸` button on the bottom bar; tap-to-record across all surfaces

These anchors are the canonical vocabulary for any downstream build, brief, or wireframe iteration.
