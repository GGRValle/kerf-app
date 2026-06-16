# Surface Grammar — the shared vocabulary (Goal 0)

**Source of truth:** the operable canon prototype —
`CODEX - Files/operable-wireframes/kerf_system_operable_canon_wireframe.html`.
Every surface's look + layout is built from THIS grammar, not hand-rolled CSS.
That's what makes "matches the prototype" mechanical instead of a per-surface
re-skin (the drift we keep hitting).

**Adopt it:** put `data-grammar="canon"` on a surface root, then use the `kg-`
classes / canon tokens from `src/app/styles/surface-grammar.css`. Existing
surfaces are untouched until they opt in (the layer is scoped — zero blast radius).

---

## 1. Token reconciliation (the #1 reason "the look" never matched)

The prototype and the app shipped **different palettes.** Canon = the
prototype's values. Accents are theme-constant; only bg/panel/ink/line/`*-soft`/
shadow flip.

| Canon token | Light | Dark | App token it supersedes |
|---|---|---|---|
| `--bg` | `#f4f5f7` | `#0c1117` | `--kerf-bg` |
| `--panel` | `#ffffff` | `#151b23` | `--kerf-surface` |
| `--ink` | `#111722` | `#eef2f7` | `--kerf-text` |
| `--muted` | `#667281` | `#9aa6b2` | `--kerf-text-mute` |
| `--line` | `#dfe3e8` | `#28313b` | `--kerf-border` |
| `--gold` | `#e7aa3b` | `#e7aa3b` | `--right-hand` (`#C9A961`) / `--kerf-amber` |
| `--blue` | `#2f6df0` | `#2f6df0` | `--kerf-blue` |
| `--green` | `#22784a` | `#22784a` | `--field-green` |
| `--red` | `#b73838` | `#b73838` | `--kerf-red` |
| `--amber` | `#aa6719` | `#aa6719` | — |
| `--radius` | `8px` | `8px` | — |

> **The gold mismatch is the visible one:** canon gold is `#e7aa3b` (warmer);
> the app shipped `--right-hand #C9A961`. Rebuilt surfaces use `--gold`.

### ⚑ Decision for the conductor — default theme
The canon prototype is **light-first** (`--bg #f4f5f7`); the app shell is
**dark-first** (`--kerf-bg #0A0D11`). Both modes carry exact canon values here,
so the parity is real either way — but **pick the default** the founder walks on
the phone. One-line change (the app's theme default). Until decided, canon
surfaces follow the app default (dark).

---

## 2. Component map — prototype element → what to use

| Prototype grammar | Use | Status |
|---|---|---|
| `.card` | `kg-card` / `Card.astro` | ✅ exists; token-align to canon |
| `.chip.{red,green,amber,blue}` | `kg-chip` + variant / `Chip.astro` | ✅ exists — **this kills the red row-rails** |
| `.routechip` (breadcrumb) | `kg-routechip` | ✅ new in canon layer |
| `.row` | `Row.astro` | ✅ exists |
| `.grid` / `.spanN` (12-col) | `kg-grid` + `kg-span-N` | ✅ **new — was a gap, no app equivalent** |
| `.pagehead` | `kg-pagehead` + `SectionLabel.astro` | ✅ new in canon layer |
| `.passdot` / `.warndot` (status) | `kg-passdot` / `kg-warndot` | ✅ new in canon layer |
| `.rh-pill` / `.rh-panel` / `.rh-thread` / `.bigmic` | `RightHandBubble.astro` (F-RH7) | ⚠️ **exists but NOT WIRED — wire it (Goal 2)** |
| `.phonebar` / `.navbtn` | `MobileBottomNav.astro` | ✅ exists |
| `.tabs` / `.tab` | `ProjectTabStrip.astro` | ✅ exists |
| back affordance | `NavBack.astro` | ✅ exists (#371) |
| phase progress | `PhaseStrip.astro` | ✅ exists (#372) |
| `.start-sheet` / `.sheet` (Start menu) | — | ❌ **gap — build in capture/CO flow** |
| `.paper` (client artifact) | `renderProposalHtml` / `renderInvoiceHtml` | ✅ exists (D-068) |

---

## 3. The flow grammar (prototype `go(screen)` + RH overlay)
The prototype navigates via `go('home'|'camera'|'estimateBuilder'|'project'|'field'|…)`
and `openRightHand()/minimizeRightHand()/closeRightHand()`. The 3 flow
corrections (Goal 1) map onto these:
- **Camera:** capture-first, route-after (prototype `go('camera')` opens capture).
- **Change Order:** builder → Decision Card (F-B1) → adjusted contract.
- **Daily Log:** one flat surface (F-DL1).

---

## 4. Per-surface checklist for Goals 1 & 2 (build against this)
Each rebuilt surface: `data-grammar="canon"` root · `kg-grid` layout · `kg-card`
sections · `kg-chip` for status (no red rails) · `NavBack` · canon tokens · the
F-\* wireframe + prototype as the dual reference · **wired + reachable on the
phone (definition of done).**

- **Home** — kill the tub-surround/galvanized seed data; row-rails → `kg-chip`.
- **Right Hand** — **wire `RightHandBubble`** (F-RH7 pill/bloom); it's built + tested, just disconnected.
- **Estimate / Proposal / Invoice / Money** — canon grid + cards + chips.
- **Camera / Change Order / Daily Log** — the 3 flow corrections.
