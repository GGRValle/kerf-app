# Kerf Wireframe Knowledge Catalog

**Built from rendered canon HTML**, not assumed. The 109 canon source files are vendored alongside this
catalog at `docs/wireframes/canon/F-*.html` (true source: open in any browser for the live wireframe).
Method: headless Chrome render → visual review → distilled spec. One entry per surface.
Regenerate any render: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1500,2800 --screenshot=out.png "file://<abs-path-to-F-*.html>"`

---

## Design System (observed across surfaces, authoritative = F-E1 :root)

### Token palette (verbatim from F-E1 canon `:root`)
- `--kerf-bg #0A0D11` · `--kerf-bg-2 #14181F` · `--kerf-surface #1A1F28` · `--kerf-surface-2 #232936`
- `--kerf-border #2A3140` · `--kerf-border-soft #1F2530`
- `--kerf-text #E8ECF1` · `--kerf-text-dim #98A1B3` · `--kerf-text-mute #6A7282`
- `--kerf-amber #F5B544` · `--kerf-green #4ADE80` · `--kerf-red #F87171` · `--kerf-blue #7BA8FF` · `--kerf-violet #A78BFA` · `--kerf-magenta #E879A8`
- `--field-green #38C977` · `--right-hand #C9A961`
- Light mode overrides bg/surface/border/text ONLY (all accents constant across themes).

### Theme behavior (LOCKED — Christian, 2026-05-28)
- **Default follows the OS** via `prefers-color-scheme` — app opens dark on a dark system, light on a light system. No hardcoded default theme.
- **The ONLY manual switch lives in user Settings** (F-SP1a account editor, beside UI language). It overrides the system default; nothing else flips the theme. "System" state = no override.
- Implementation = three-tier cascade in the SHARED canon layer (not per-page):
  ```css
  :root { /* canon DARK tokens — base */ }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme]) { /* light bg/surface/border/text — only when user hasn't chosen */ }
  }
  :root[data-theme="light"] { /* light overrides — explicit choice wins over system */ }
  :root[data-theme="dark"]  { /* dark overrides — explicit choice wins over system */ }
  ```
- Settings toggle writes `data-theme="light|dark"` to `<html>` (persisted to user prefs); selecting "System" removes the attribute. Accents never change with theme.

### Role theming (CRITICAL — confirmed from A1 vs C1)
- **Owner / Right Hand surfaces → AMBER** (`--kerf-amber` / `--right-hand`). Approval, consequence, "the one thing."
- **Field / field-hand surfaces → GREEN** (`--field-green`). Capture, check-in, "passed/good."
- **Field hand role is Spanish-first** (C1 = "Buenos días, Carlos / Mano de Campo"); owner is English ("Good morning, Christian").
- Status: green = passed/good, amber = needs review/action, red = block/fail.

### Recurring chrome
- **Phone frame**: rounded dark device with status bar (time / signal / battery) at top.
- **Bottom nav**: icon row with a **central circular FAB** = the Right Hand / voice-speak affordance (amber for owner, green-tinted for field).
- **Topbar**: back-link / title / dismiss (X) pattern on detail surfaces.
- **Card**: `--kerf-surface` fill, `--kerf-border` hairline, generous padding, rounded.
- **Action card (hero)**: colored left border / glow (amber for approval), primary CTA filled in role color.

---

## Surface Catalog

### F-E1 · Mobile Field Capture (VIEWED)
- 3 states shown: (1) pre-capture "What are you capturing?" — assignment card + Daily Log anchor + **large round green record button with glow ring** + Photo/Video quick actions + two amber CTAs; (2) active "Recording… accumulating evidence" — timer, captured media rows, green "Done capturing"; (3) "Ready to send?" preflight readout + green "Submit to Daily Log".
- Primary color: **green** (field surface). Record button is the hero — circular, glowing, ~88px.
- Live app delta: tokens hand-approximated (`#070b0f` vs `#0A0D11`), incomplete set, no shared file.

### F-A1 · Mobile Owner Home (VIEWED)
- "Good morning, Christian" greeting → **hero Right Hand approval card** (amber border): "Hernandez CO-003 · pantry scope expansion · $14,820 · Open Review →" (amber CTA) → **stat grid** (margin / project tiles, green & amber figures) → bottom nav with **central amber FAB**.
- The owner home leads with the single approval needing attention (the "one thing"), then ambient stats.

### F-C1 · Mobile Field Hand Home (VIEWED)
- "Buenos días, Carlos" / "Mano de Campo" (Spanish) → **green** assignment card "Hernandez - Framing day 3" with green "Check in" + dark "Check out" → "Today's work" task rows → media card (photo "north wall solar conflict", voice note 0:43) → bottom nav.
- Role-distinct: green primary, Spanish-first, check-in/out posture (vs owner's approve posture).

### F-B1 · Mobile Decision Card (VIEWED)
- Topbar "Decision" (back / title / X) → decision card "CO-002 · Pantry scope expansion · Hernandez" → **amber model-explanation block** ("Here's the change order I built from the photos… priced against your past pantry conversions. Front check passed. View full →") → source/evidence refs → green "Front check passed" → large amber **Approve →** + secondary Edit / Add note / decline.
- This is the D-049 draft-review surface: model draft + evidence + operator approve. Variants: B1b (edit), B1c (client preview), B2 (desktop).

### F-AO2 · Desktop Admin/Ops Home (VIEWED)
- "Good morning, Pat" (admin/ops persona). **DESKTOP pattern: left sidebar nav rail** (Home, Money, Team & Ops, Marketing, Settings + project list) + **multi-column board** (Right Hand / On Deck / On Focus) + right rail (Compliance status, Today's queue: payroll/bank recon/AP release/referral payout).
- Admin/ops accents lean **magenta/violet** (`--kerf-magenta #E879A8` / `--kerf-violet #A78BFA`) — distinct from owner-amber and field-green.

### F-F1 · Desktop Transcript Review (VIEWED)
- DESKTOP: sidebar + **two-column diff** — "Original transcript" (read-only) vs "Current version" (editable, highlighted changes). Header "Maria Wegryn - kitchen cabinetry walk". Key-summary block with Christian / Right Hand attribution. Bottom: Cancel / Save draft / amber **Confirm transcript**.
- Maps to live `/transcript-review`. Human corrects raw transcription before it feeds synthesis.

### F-G1 · Desktop Draft Review (VIEWED) — disciplined send gate
- DESKTOP: sidebar + a model-synthesized **"Change Order Proposal · Wegryn kitchen · v3 · $14,820"** document — scope line items with prices (Pantry/cabinetry $8,760, Floating shelves $3,240, Electrical $2,820), notes.
- Right column: **"Source-by-source provenance"** — every scope line tied to its evidence (transcript / photo / measurement). Visual form of the D-049 `source_ref` guard.
- Bottom action bar: "Send back to draft" / "Save & continue editing" / amber **Approve & send**.
- Maps to live `/draft-review` + the Phase 1H synthesis path (`synthesize.ts`) + send gate.

### Persona theming (confirmed A1/C1/AO2)
| Persona | Example name | Accent | Language | Nav |
|---|---|---|---|---|
| Owner | Christian | amber `#F5B544` | English | mobile bottom nav + amber FAB |
| Field hand | Carlos | field-green `#38C977` | Spanish-first | mobile bottom nav + green FAB |
| Admin/Ops | Pat | magenta/violet | English | desktop sidebar rail |
| Right Hand (AI) | — | right-hand gold `#C9A961` | — | the central FAB / approval cards |

### Layout language
- **Mobile**: single column inside phone chrome, status bar top, bottom nav with central circular FAB.
- **Desktop**: left sidebar nav rail + multi-column content board + optional right rail.

### F-MN1 · Mobile Money Home (VIEWED) — "action queue, not bank statement"
- Owner-private (amber). State 1: cash-position summary (amber figure, green/red deltas) + receivables action rows (invoices due, Right-Hand allowance alert, Santos/Hernandez invoice rows). State 2: **per-job margin-posture grid** — project tiles (Wegryn/Hernandez/Ash/Santos/Moore/Glen) with margin % color-coded green/amber/red.
- Money sub-surfaces (MN2 desktop home, MN3/4 margin posture, MN5a/b allowance exceptions, MN6a/b AR aging, MN7a/b AP scheduling) — each mobile+desktop. Maps to live `/money/*`.

### F-PV1 · Mobile Proposal View (VIEWED) — client-facing artifact
- The polished **client-facing** proposal/contract document: branded "GGR Design + Remodeling" header, scope sections, line items, totals. Clean and professional (vs G1 internal draft with provenance). Send is gated. PV2 = desktop variant / send gate.
- NOTE: actual filenames are `F-PV1_mobile_proposal_view` / `F-PV2_desktop_proposal_view` (brief wrongly calls them `proposal_preview`/`send_gate`).

### F-PR2 · Mobile Project Detail (VIEWED) — "one job, nine lenses"
- Project header ("Pantry conversion") + amber Right Hand alert + **tabbed interface (nine lenses)** over one job (overview/money/schedule/audit/field/…). Maps to live `/projects/[id]`. PR1 list, PR3 desktop list, PR4 desktop detail.

### F-RH3 / F-CAM1 · Current Canon Pins (VIEWED) — literal build targets
- `canon/F-RH3_mobile_right_hand_conversation_lifecycle.html` is the **current** Right Hand conversation target from KERF Canon v1, not the historical master extract. It defines one persistent blurred surface, same mic, growing composer with typed/pasted input, consequence-only confirmation, and "filed" only after the durable write returns.
- `canon/F-CAM1_mobile_camera.html` is the **current** camera target from KERF Canon v1. It defines the full-bleed in-app camera, job-first routing gate, Walkthru/Photo/Scan modes, dominant centered shutter, compact bottom controls, and LiDAR room scan as a separate flow.
- These files are pinned by `tests/wireframe-canon-pinned.test.ts`; a green pin test proves the files exist, but completion still requires rendered screenshot comparison against the built surface.

### F-RC1 · Mobile Room Capture (VIEWED)
- Spatial capture: "Hernandez - pantry", **camera viewfinder + room-scan overlay guides** (Apple RoomPlan-style), measurement rows, green-themed. Maps to live `/room-capture`.

### F-CO1a · Mobile Closeout (VIEWED) — to-do → punch list
- "Wegryn kitchen Closeout", green **Convert to-dos → punch list** action + sign-off checklist (walkthrough, CO/lien release, client sign-off, warranty, final invoice, NPS). Post-conversion state shows audit trail + amber pending items. CO1b = desktop.

### Clients (CL1-6) — list / detail / record, mobile+desktop
- CL1 mobile list, CL2 mobile detail, CL3 desktop list, CL4 desktop detail, CL5 mobile client record, CL6 desktop client record. Maps to live `/clients`, `/clients/[id]`, `/clients/new`.

---

## NAVIGATION MODEL (authoritative — from F-RR1 routing matrix + F-D1 + F-S1)

### The 5-slot mobile bar contract (F-D1)
- Every role's mobile bottom bar has **exactly 5 slots**; **slot 3 = central FAB = "Speak" / "Habla"** (Right Hand voice). Slots 1,2,4 are role-specific; **slot 5 = "More" by default, swappable to a pinned "Start"**.
- **More** opens a right-slide sidebar overlay (~68% width, 280ms, backdrop dims to 70% + 2px blur, bar stays visible). Lists overflow business-graph domains + **System (Settings · Audit)** + a **Tier-C "Other business units →" multi-business hook** (dashed magenta border, disabled at SMB tier — visible to signal future packaging).
- Three-layer projection: **Layer A** = same nav grammar for all; **Layer B** = role filters which domains appear; **Layer C** = locale translates labels. Same primitive, different projections.

### Role-root routing matrix (F-RR1 — 7 role-roots, prevents routing drift)
| Role-root | Home | Sidebar domains | Mobile bar (slot3=Speak) | Hidden |
|---|---|---|---|---|
| **Owner** | A1/A2 | Home·Start·Sales·Projects·Schedule·Money·Team+Ops·Marketing·Settings·Audit | Home·Projects·**Speak**·Clients·More | nothing at domain level |
| **PM** | P1/P2 | Home·Start·Projects·Schedule·Money(budget)·Team+Ops·Settings | Home·Projects·**Speak**·Schedule·More | Sales, Margin, Marketing |
| **Foreman/Superintendent** | SU1/SU2 | Home·Start·Projects·Schedule·Money(budget)·Team+Ops·Settings | Home·Projects·**Speak**·Schedule·More | Sales, Marketing; Clients partial via Team+Ops |
| **Field Hand** | C1 | Home·Log·Clock·Messages·Profile·Settings | Home·Log·**Speak**·Clock·More | Sales, Money, Marketing, portfolio Projects |
| **Admin/Ops** | AO1/AO2 (planned) | Home·Start·Projects·Schedule·Money·Team+Ops·Settings·Audit | Home·Money·**Speak**·Schedule·More | Margin; Sales partial; Marketing limited |
| **Estimator** | ES1/ES2 | Home·Start·Sales·Schedule·Team+Ops>Clients·Settings | Home·Pipeline·**Speak**·Schedule·More | Projects, Money, Marketing (most filtered) |
| **Sub** | SH1/SH2 (planned) | Home·Assignments·Messages·Pay status·Settings | Home·Assignments·**Speak**·Messages·More | portfolio Sales/Projects/Money/Marketing |
- Surface canon **4-question rule**: macro/comparison/detail? · list/grid/both? · operator cognitive job? · what stays hidden until drill-down?

### Start action sheet (F-S1) — intent-first, NOT a launcher grid
- Bottom sheet, two sections. **"Start work"** (amber accent = actions you take): field walk · change order · estimate/proposal · client intake · takeoff. **"Start a sweep"** (violet accent = system does it for you): clarify · lookahead · drift check.
- **Verb-not-agent rule**: labels are plain-English work ("Start clarify", never "Start clarification agent"). Kerf chooses the medium on the next step. Refuses to be a Houzz-Pro "pick a file type / pick a tool" grid.

### Bilingual-by-design (F-D1 — platform commitment, Architecture Phase 1)
- **Not field-only.** Tenant-level locale picks UI language; EN tenant → English labels, ES tenant → Spanish (owners/PMs/admins included). Agent identity carries both languages as a constant cue: **Right Hand ↔ Mano Derecha**, **Speak ↔ Habla**, **Settings ↔ Configuración**. Ships V2.1 Paid Beta.
- **3-color status discipline**: green/amber/red mean status ONLY. Amber (owner / "actions you take") and violet ("system does for you") used elsewhere are role/category accents, not status.

### F-FD1 · Mobile Field Detail (VIEWED) — single capture event drill-down
- "Back to Field" nav → voice-note card (Carlos · Wegryn kitchen · May 20 10:42a) → transcript text → **"Extracted entities"** → action rows (scope flag, cost line item, decision, added to project notes, flagged for foreman). The drill-down from Field/Daily Log into one captured event + its synthesis. FD2 = desktop. Follows dark-surface + field grammar.

---

## REMAINING SURFACE FAMILIES (content-extracted from canon HTML)

### Role-root homes (beyond A1/C1/AO2 already viewed)
- **F-P1/P2 · PM Home** — first PM role-root. Same Blackboard substrate, PM-lens projection; rails explicit (vs Owner's brain-questions). Accent inherits owner-ish; no Sales/Margin/Marketing.
- **F-SU1/SU2 · Superintendent Home** (6th role-root, locked 2026-05-18) — operates between PM (strategic) and Field Hand (task). Job: resolve jobsite drift before it hits PM, deploy crews tactically.
- **F-FL1 · Foreman/Lead Home** — **field-green** accent. Crew under lead, quality gates, daily-log approvals. Bar: Home·Schedule·**Speak**·Crew·More. No Money/Marketing/Sales.
- **F-ES1/ES2 · Estimator/Sales-Consultant Home** (internally F-ES3, refreshed) — **VIOLET role accent**, Owner-Home macro structure (One Thing → On Deck → The Pulse), Sales-lens. Bar swaps Projects→Sales.
- **F-SH1/SH2 · Sub Home** — **sub-FACING portal, NOT operator Kerf.** Plain language: work orders, payments to them, documents. No sidebar, no margin, no portfolio. V1 single-operator.

### Sales domain (Estimator/Owner)
- **F-SL1/SL2 · Sales Pipeline** — primary Sales operating view (deal stages). **F-SL3/SL4 · Deal Detail** (Patel ADU) — per-deal lens, tabs-as-lenses. **F-LD1a/b · Lost Deals** — lost-deal analysis (90d, reasons, competitors, $ lost). Convert-to-deal → SL1.
- **F-MK9/MK10 · Leads** — prequal pipeline (Inquiry→Discovery→Qualified→Handed to Sales→Disqualified) BEFORE Sales handoff.

### Money domain (beyond MN1, owner-private)
- **F-BK1a/b · Bookkeeping Recon** + **F-BK2 · QB Export** — unreconciled items; "**dollars in UI · integer cents in storage**"; fillable by Owner/delegate/external MCP.
- **F-VC1 · Spend Card / Transaction Framing** — **explicitly NOT a V1 surface**; a V1.5+ partner-integration design stake; fintech rails out of V1 scope.

### Team & Ops domain
- **F-TO1/TO2 · Team & Ops Home** — domain home for the Team+Ops branch (summary cards, not a comparison list).
- **F-CR1/CR2 · Crew** — canonical people records: Team (W2 internal) + Subs (1099 external). Time tracking inline. People-axis (vs Schedule's time-axis).
- **F-SB1/SB2 · Subs List** — 1099 subcontractor roster, distinct from Crew (W2).
- **F-HR1a/b · Time Tracking** — peer time-entry approval (week rollup, flagged/overtime first). **F-HR2 · Employee Docs** — lifecycle (complete/expiring/missing), professional HR tone.
- **F-PU1a/b · Purchasing** — PO lifecycle (issued→fulfilled→delivered→invoiced→matched). **F-PU2 · Vendor Detail** — per-vendor depth.
- **F-RP1/RP2 · Reports Center** — under Team & Ops (D-046 C6); "run/print/export the report I need now."
- **F-AD1/AD2 · Admin Landing** — Tier-2 admin entry inside Team & Ops (More → Team & Ops → Admin).

### Marketing domain (owner; RH drafts · operator sends · NEVER auto-sends)
- **F-MK1/MK2 · Marketing Home** — 4 pillars: Leads · Lead Sources · Outreach · Reviews & Referrals.
- **F-MK3/MK4 · Reviews & Referrals** — RH drafts, operator sends, no auto-outbound.
- **F-MK5/MK6 · Outreach Queue** — stalled bids/cold leads/partner check-ins; **every send requires operator approval**.
- **F-MK7/MK8 · Lead Sources** (filename `_attribution`/`_lead_sources` mismatch — note for port) — first-party channel comparison (leads/win-rate/CAC), no imputed sources.

### Projects / Field / Schedule / Clients (beyond PR2/RC1/E1/FD1/CO1a/CL*)
- **F-PR1/PR3 · Projects List**, **F-PR4 · Desktop Project Detail**, **F-PA1a/b · Project Archive** (closed work, red chip-tier), **F-PS1 · Project Status**.
- **F-ML1/ML2 · Project Media Library** — per-project media lens; photos/videos/logs from F-E1 write here = single source of truth.
- **F-W1 · Work Order** — Field Hand surface from C1 "Today's work"; "tell the crew what to do today, where, how long, what to capture."
- **F-SC1/SC2 · Schedule Home** — portfolio schedule, attention-sorted (Today · This week · 2-wk lookahead · Conflicts · Payment milestones).
- **F-CA1a/b · Client Archive** (lapsed/closed/year rollups), **F-CS1/CS2 · Client Success** (post-close relationship lens), **F-WW1a/b · Warranty** (claims, check-ins).

### Audit / Settings / System (Tier-3, under More → Settings)
- **F-AV1a/b · Audit Portfolio** — "trust comparison, not forensics console." Escalated first · auto-resolved compressed · reversed empty. Red chip-tier only.
- **F-H1 · Audit Detail** — the substrate destination via "View audit detail" from Decision Card. **Canon vocabulary IS expected here** (AltitudePacket / DecisionPacket / validator IDs / cohort) — the one surface where the internal model is exposed.
- **F-SP1 · Settings** (Audit lives here, NOT top nav) → **F-SP1a · Account Editor** (every save writes an audit-trail entry; voice editing). 
- **F-BC1 · Bar Customization** — operator picks 2 swappable bottom-bar slots; **Home · Speak · More stay locked** (confirms 5-slot contract).
- **F-D1 · More Sidebar**, **F-S1 · Start Action Sheet**, **F-RR1 · Routing Matrix** — see NAVIGATION MODEL section above.

### Persona accent (UPDATED — full set)
| Persona | Home | Accent |
|---|---|---|
| Owner | A1/A2 | amber `#F5B544` |
| PM | P1/P2 | neutral/owner-ish (no distinct accent) |
| Superintendent | SU1/SU2 | (execution-tier) |
| Foreman | FL1 | **field-green `#38C977`** |
| Field Hand | C1 | field-green, Spanish-first |
| Estimator | ES1/ES2 | **violet `#A78BFA`** |
| Admin/Ops | AO1/AO2 | magenta/violet |
| Sub | SH1/SH2 | sub-facing portal (own plain theme) |
| Right Hand (AI) | — | gold `#C9A961` (the Speak FAB + approval cards) |

---

## LIVE APP → CANON MAP + FIDELITY DELTA (Task 7)

### Root cause of the fidelity gap (DEFINITIVE)
- **The built app uses a generic design system, not canon.** `src/app/styles/shell.css :root` defines `--bg #f4f6f8` (LIGHT), `--surface #ffffff`, `--text #1a2332`, `--accent #0f766e` (**teal**), `--chip-red/amber/green/cyan/neutral`. The shared `_kit/` components (card, chip, rh-summary, speak-fab, phase-strip) all consume THIS vocabulary.
- **Canon `--kerf-*` tokens appear in only ONE file**: `field-capture.astro` (25 `--kerf-*` + 11 `--field-green`/`--right-hand` uses) — and even there `--kerf-bg` is wrong (`#070b0f` vs canon `#0A0D11`) and the set is incomplete (`--kerf-surface-2` used but undefined).
- **Therefore the fidelity delta is uniform**: structure/primitives are close (kit matches canon: card, chip, rh-summary, Speak FAB), but the **skin is wrong everywhere** — generic light/teal instead of canon dark `#0A0D11` + persona accents (amber/green/violet/magenta/gold).
- **Phase 1J fix shape**: (1) put the full 17-token canon `:root` (dark base) + the three-tier theme cascade (see "Theme behavior" in Design System) into the SHARED layer (shell.css / Layout.astro), remapping `--bg/--surface/--text/--border/--accent/--chip-*` onto `--kerf-*`; (2) add persona-accent theming; (3) delete the wrong hand-rolled `:root` from field-capture.astro so it inherits the shared canon; (4) wire the Settings light/dark/System toggle to write `data-theme` on `<html>` — default follows OS `prefers-color-scheme`, the Settings toggle is the sole override (per Christian 2026-05-28).

### Route → canon mapping
| Live route | Canon surface | Notes |
|---|---|---|
| `field-capture.astro` | **F-E1** | only canon-themed page; wrong bg value |
| `field.astro` / `field-detail.astro` | Field domain / **F-FD1/FD2** | |
| `room-capture.astro` | **F-RC1** | |
| `transcript-review.astro` | **F-F1** | |
| `draft-review.astro` + `/[draft_id]` | **F-G1** | synthesis send gate |
| `decisions/index` + `/[id]` | **F-B1/B2** | decision card |
| `proposals/[id]/preview` | **F-PV1/PV2** | client-facing |
| `proposals/[id]/send` | **PV2 send gate** | |
| `clients/index` · `/[id]` · `/new` | **F-CL1/3 · CL2/4 · CL5/6** | |
| `projects/index` | **F-PR1/PR3** | |
| `projects/[id]/index` + `/[tab]` | **F-PR2/PR4** | nine lenses |
| `projects/[id]/closeout` | **F-CO1a/CO1b** | |
| `projects/[id]/status` | **F-PS1** | |
| `projects/[id]/work-orders/[wid]` | **F-W1** | |
| `money/index` | **F-MN1/MN2** | |
| `money/margin` | **F-MN3/MN4** | |
| `money/allowances` | **F-MN5a/b** | |
| `money/ar` | **F-MN6a/b** | |
| `money/ap` | **F-MN7a/b** | |
| `money/bookkeeping` | **F-BK1a/b** | |
| `money/qb-export` | **F-BK2** | |
| `audit/[packetId]` | **F-H1** | detail; AV1a/b portfolio not yet built |
| `reports.astro` | **F-RP1/RP2** | |
| `schedule.astro` | **F-SC1/SC2** | |
| `settings.astro` | **F-SP1** (+ SP1a, BC1 drill) | |
| `more.astro` | **F-D1** (+ S1 start sheet) | |
| `role-routing.astro` | **F-RR1** | routing matrix |
| `index` / `dashboard` | role-root home (**A1/A2** etc.) | persona-dependent |
| `blackboard.astro` | — (internal substrate) | no canon F-* |
| `relay/index` + `/[id]` | — (RH relay queue) | no direct canon |
| `kb-ingestion/index` + `/[id]` | — (onboarding/memory) | internal |

### Canon surfaces with NO live route yet (build gaps, post-1J)
- **Marketing** (MK1-10), **Sales** (SL1-4 pipeline/deal, MK9 leads, LD lost deals)
- **Team & Ops** (TO home, CR crew, SB subs, HR time/docs, PU purchasing, AD admin)
- **Client/Project lenses** (CS success, CA/PA archives, ML media, WW warranty)
- **Role homes** (P1 PM, SU superintendent, FL foreman, ES estimator, SH sub-portal)
- **Audit portfolio** (AV1a/b — only detail H1 exists), **BC1** bar customization
- **VC1 spend card** — explicitly NOT a V1 surface (skip)
