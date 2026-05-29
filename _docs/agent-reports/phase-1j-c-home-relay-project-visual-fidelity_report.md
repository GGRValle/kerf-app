# Phase 1J · Agent C — Home + Relay + Project Visual Fidelity

**Branch:** `phase-1j-c-home-relay-project-visual-fidelity`
**Base:** `origin/main @ 2fe9a15` (latest after PR #245 — Agent B F-E1 visual fidelity)
**Date:** 2026-05-28

---

## Critical requirement — resolved

> At iPhone width, remove/replace the horizontal desktop web top-nav. No clipped
> "Kerf · Home · Capture…" strip on mobile. Use canon phone-app chrome: mobile
> bottom nav + Right Hand Speak affordance from Agent A.

**Before:** `Layout.astro` rendered the data-driven horizontal `.kerf-nav` pill strip
inside a sticky `.kerf-topbar` on **all** widths. At iPhone width this produced the
clipped, horizontally-scrolling "Kerf · Home · Capture · Transcripts · Drafts · Money…"
strip — plus a redundant `MobileBottomNav` underneath.

**After:**
- `.kerf-nav` is hidden below 900px (`@media (max-width: 899px)`). The desktop web nav
  is untouched at ≥900px.
- On mobile the `.kerf-topbar` is now canon phone-app chrome: a clean **brand header**
  (`Kerf`) with a **Right Hand avatar** (`RH`, canon gold) on the right that routes to
  field capture. The RH avatar is hidden on desktop (the horizontal nav covers it there).
- Navigation on mobile is carried entirely by Agent A's `MobileBottomNav` (now canon-styled)
  + the Right Hand `SpeakFAB`. No clipped strip remains.

Verified visually in-browser at **390×844 (iPhone 12/13/14)** and **1200×800 (desktop)**:
- Mobile `/`, `/relay`, `/projects`, `/projects/:id`, `/projects/:id/audit`,
  `/projects/:id/field` all render the canon top header + bottom tab bar with no clipped nav.
- Desktop still shows the full horizontal web nav with the RH avatar + bottom bar hidden.

---

## Scope of changes

### Shared mobile shell chrome
- **`src/app/layouts/Layout.astro`** — wrapped the brand in `.kerf-topbar-lead`; added the
  `.kerf-topbar-rh` Right Hand avatar affordance. Nav markup/contract unchanged.
- **`src/app/styles/shell.css`**
  - `.kerf-topbar` is a single-row flex header (brand · nav · RH avatar) with safe-area top padding.
  - Added `.kerf-topbar-rh` canon-gold avatar.
  - `@media (max-width: 899px) { .kerf-nav { display:none } }` — kills the clipped strip on phones.
  - `@media (min-width: 900px)` keeps the horizontal nav and hides the RH avatar.
  - Added missing canon token remaps so consuming components inherit the dark skin instead of
    light fallbacks: `--surface-2`, `--border-soft`, and `--on-accent` (dark ink for text on amber).
- **`src/app/components/MobileBottomNav.astro`** — raised from a flat text row to the canon
  phone tab bar: 5-column grid, monochrome silhouette SVG icons (Home / Capture / Relay /
  Projects) + the intentional 4-color `More` exception, icon-over-label, amber active state,
  safe-area bottom padding. Route set / i18n keys / `shellRoutes` contract untouched — icons
  are mapped by `href` inside the component.

### Home (`/`)
- **`src/app/components/HomeLoopGrid.astro`** — replaced the bare `<ul>` of links with canon
  operator-loop **cards** (section label + titled cards with detail line + amber arrow,
  2-up grid on desktop). All `HOME_OPERATOR_LOOPS` hrefs + i18n keys preserved.
- **`src/app/components/RhSummary.astro`** — Right Hand avatar now uses the canon `--right-hand`
  gold tint instead of a hardcoded light grey; softened card radius.

### Relay (`/relay`, `/relay/[id]`)
- **`relay/index.astro`** — severity left-stripes now use canon tokens (`--kerf-red/amber/blue`).
  Card markup + the `card.href = `/relay/…`` linking (asserted by tests) untouched.
- **`relay/[id].astro`** — detail buttons no longer hardcode white backgrounds (`#fff` →
  `--surface-2`); primary action uses dark `--on-accent` ink on amber; body panel uses the
  canon surface. **The review POST flow is byte-for-byte unchanged.**

### Projects (`/projects`, `/projects/[id]`, `/audit`, `/field`)
- **`ProjectTabStrip.astro`** — active tab tint switched from `color-mix(…, white)` (broke in
  dark mode) to a transparent amber wash that works in both themes.
- **`styles/lane23.css`** — `lane23-lowconf` / `lane23-followup` washes mix against
  `--surface` instead of literal `white`; primary buttons use `--on-accent` dark ink on amber.
  Audit panel + tab content structure untouched.

---

## Preserve checklist

| Item | Status | Note |
| --- | --- | --- |
| Relay review POST | ✅ unchanged | `relay/[id].astro` fetch to `/api/v1/relay-cards/:id/review` not touched |
| Project links | ✅ unchanged | scope/field/audit/work-order links intact (verified in-browser) |
| Audit rendering | ✅ unchanged | `ProjectAuditPanel` untouched; `phase1d-audit-projection` green |
| Preview labels | ✅ unchanged | `PreviewNotice` + `action.preview.badge` untouched |
| Event contracts | ✅ unchanged | no `src/api`, `src/persistence`, or event-shape edits |

---

## Verification (fresh worktree, `npm ci`)

```
npm run typecheck      → pass (tsc --noEmit, 0 errors)
npm run build:astro    → pass (server + client build complete)
node --import tsx --test \
  tests/phase1i-batch-b-projects-audit-relay.test.ts \
  tests/phase1d-audit-projection.test.ts \
  tests/route-shell-smoke.test.ts
  → 13 pass / 0 fail
```

All 27 route-shell smoke paths return non-5xx; relay link/review tests and audit projection
tests green.

---

## Canon anchors referenced
- `docs/wireframes/canon/F-A1_mobile_owner_home.html` — top-chrome (greeting + avatar, no nav
  strip), `.bottom-bar` 5-col tab grid, monochrome silhouette icon system + 4-color `More`.
- `docs/wireframes/canon/F-C1_mobile_field_hand_home.html` — same phone-app chrome family.
- `F-PR1/F-PR2/F-PR4` project files, `F-CO1a/F-CO1b` closeout — project surface skin.
- Token foundation lifted verbatim from `F-E1` `:root` (Agent A / Agent 0 shared skin).

## Notes / judgment calls
- Kept Agent A's `MOBILE_BOTTOM_NAV` route set (Home/Capture/Relay/Projects/More) and the
  separate `SpeakFAB` rather than re-deriving the F-A1 owner set (Home/Projects/Speak/Clients/
  More). The requirement said to *use* Agent A's bottom nav + Speak affordance; I raised their
  fidelity rather than redefining the shared contract.
- Visual fidelity was achieved by remapping/repairing canon tokens at the shell layer and
  removing light-mode-only literals (`#fff`, `white` color-mixes) — no per-surface bespoke
  repaint, consistent with the Agent 0 "every consuming component inherits the canon skin"
  posture.

## Merge posture
Stacks cleanly on `origin/main @ 2fe9a15`. Touches shared shell chrome (`Layout.astro`,
`shell.css`, `MobileBottomNav.astro`) — coordinate ordering with any other 1J lane that edits
the same shell files.

---

# Revision · Mobile Nav + Right Hand Speak Correction (2026-05-28 PM)

Follow-up correction against canon **F-A1 / F-C1**. Do-not-merge-yet revision applied
on the same branch.

## Mobile bottom nav — corrected to canon
- **Speak is now the CENTER slot** of the 5-slot bottom bar (a lifted amber mic FAB),
  using the simple canon mic glyph — not a heavy floating button.
- **No separate floating `SpeakFAB` on mobile.** `SpeakFAB.astro` is retained (it is the
  desktop Right Hand affordance and is asserted by `phase-1i-batch-d-shell.test.ts`) but is
  now `display:none` below 900px. Result: exactly one Speak affordance at every width — the
  center mic on mobile, the floating FAB on desktop. No duplicate, no extra floating mic at 390px.
- **Role-aware defaults** (`bottomNavForRole`, `shellRoutes.ts`):
  - Owner / PM / Admin: **Home · Projects · Speak · Clients · More**
  - Field hand / Sub: **Home · Log · Speak/Habla · Clock · More** (Log↔Projects, Clock↔Clients
    field swaps per F-C1; Speak label is "Habla" in Spanish via i18n).
  - `Layout.astro` passes `context.roleRoot` into `MobileBottomNav`.
- **More keeps the canon 4-color quad icon.** All other tabs use canon monochrome silhouettes
  (Home house, Projects folder, Clients person, Log notebook, Clock face).
- New i18n keys: `shell.nav.speak` (Speak/Habla), `shell.nav.log`, `shell.nav.clock`,
  `shell.nav.clients` (en + es). Legacy `MOBILE_BOTTOM_NAV` retained for back-compat.
- **Verified at 390px in-browser:** no clipped desktop top nav, center Speak mic, no floating
  mic, no duplicate Speak.
- **Field-nav route note (V1):** Log → `/field`, Clock → `/schedule` (nearest live surfaces;
  dedicated time-clock route is a later lane). Owner Clients → `/clients` (live).

## F-E1 destination framing — softened (no longer hard-bound to Wegrzyn)
The pre-capture "Capture goes to" block is now a **destination selector** (`/field-capture`):
- Options: **Active job · {client} (GPS-matched)** · Pick a different project · Pick a different
  client · New client / unassigned note. Defaults to the GPS/job-context-matched active job.
- The assignment card (client / project / location), the Daily-Log anchor line, the
  active-capture mode label, and the preflight meta all now read from the selected destination
  instead of a hardcoded "Wegrzyn" string.
- **Dogfood submit unchanged:** the active job still resolves to `proj_wegrzyn_kitchen`
  (`assignment.project_id` and `data-project-id={assignment.project_id}` preserved — both pinned
  by `phase1e-field-capture-submit.test.ts`). Non-active modes clear the project binding so the
  existing "Pick the project before submit" guard fires. The submit endpoint, event chain, and
  actor are untouched. No autonomous send/pay/approve introduced.

## Preserve checklist (revision)
| Item | Status |
| --- | --- |
| Existing F-E1 submit endpoint | ✅ unchanged (`/api/v1/projects/:id/daily-log/entries`) |
| Relay / project audit links | ✅ unchanged |
| Event contracts | ✅ no rewrites |
| Autonomous send/pay/approve | ✅ none added |

## Test update (authorized)
`tests/phase1g-relay-card-chrome.test.ts` now accepts either the canon tokenized borders
(`var(--kerf-red, #d92d20)` / `var(--kerf-amber, #f5b544)`) **or** the legacy literals.

## Verification (fresh worktree, revision)
```
npm run typecheck   → pass
npm run build:astro → pass
node --import tsx --test \
  tests/phase1i-batch-b-projects-audit-relay.test.ts \
  tests/phase1d-audit-projection.test.ts \
  tests/route-shell-smoke.test.ts \
  tests/phase1g-relay-card-chrome.test.ts \
  tests/phase1e-field-capture-submit.test.ts \
  tests/phase-1i-batch-d-shell.test.ts
  → 28 pass / 0 fail
```
