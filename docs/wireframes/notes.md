# Standard UI — Implementation Notes

Token cheat sheet, type / spacing scale, and state-coverage matrix extracted from the full canon set (`kerf_wireframes_web_v2.html` through `kerf_wireframes_v5_1_apr26.html`). Use as the lookup table when polishing W1 CSS.

---

## Color tokens (full superset across all six canon files)

The canon evolved tokens incrementally. Below is the complete set — earlier revs have a subset.

```
/* === Core surface (v2 baseline, present in every rev) === */
--kerf-amber:       #D4923A     /* primary accent — warm/burnt, not orange */
--kerf-amber-dim:   #8B5E24     /* amber on dim states, dividers */
--kerf-dark:        #0F1419     /* deep panel base */
--kerf-panel:       #1A1F26     /* primary panel surface */
--kerf-panel-2:     #232932     /* secondary panel / nested surface */
--kerf-border:      #2F3641     /* hairline borders */
--kerf-text:        #E8E6E1     /* primary text — warm off-white */
--kerf-text-dim:    #9097A1     /* secondary text */
--kerf-text-mute:   #5F6670     /* tertiary / disabled text */

/* Body / canvas — declared on body, not in :root */
body background: #0A0D11        /* deep blue-black, darker than --kerf-dark */

/* === Brand tenant colors (v2 baseline) === */
/* Reserved for tenant-tagging chips, brand strip, project stripes. */
/* NEVER repurpose for status, severity, or agent identity. */
--ggr:              #4A7FB0     /* GGR Design+Remodel */
--ggr-dim:          #1B3A5C
--val:              #A8794A     /* VALLE cabinetry + millwork */
--val-dim:          #5C3A1B
--hpg:              #4A9F74     /* Hard Point Group */
--hpg-dim:          #1B5C3A

/* === Status / severity (v2 baseline; same palette serves as confidence) === */
--success:          #5FB37A     /* = --confidence-hi */
--warn:             #E0A858     /* = --confidence-med */
--alert:            #CF5B5B     /* = --confidence-lo */
--confidence-hi:    #5FB37A
--confidence-med:   #E0A858
--confidence-lo:    #CF5B5B

/* === Right Hand + Blackboard (v4, Apr 26) === */
--rh:               #C9A876     /* Right Hand agent chrome (brass, not amber) */
--rh-dim:           #6B5938     /* Right Hand on dim / dividers */
--future:           #7E6FCF     /* Blackboard / future-state surfaces */
--future-dim:       #3A2E6B

/* === Integrations + observability (v5.1, Apr 26 PM) === */
--sentry:           #E0A858     /* Sentry surface chrome */
--sentry-dim:       #6E512A
--mcp:              #5FB3B5     /* MCP integrations surface chrome */
--mcp-dim:          #2A5556
```

**Token rules:**

- Severity and confidence share a palette intentionally — a "low confidence" badge and an "alert" badge use the same red. Don't introduce a separate severity palette.
- **Brand tenant colors** (GGR / Valle / HPG) are **only** for tenant-tagging chips, brand strip indicators, and project-card brand stripes. Never use them for status or interactive affordance.
- **Amber is an accent, not a fill.** It appears on focused borders, active dots, hover states, and brand-strip dividers — never as a panel background.
- **Right Hand has its own color (`--rh`).** Don't render Right Hand chrome in amber. The brass tone is the visual signature of the agent — keeping it distinct from system accents is the whole point of the v4 token addition.
- **Blackboard surfaces use `--future` (purple).** Anything that visualizes the event log, projections, blackboard roles, or causal graphs gets purple chrome.
- **Sentry / MCP** are reserved for those specific surfaces — don't pull `--mcp` cyan into general use.

---

## Typography scale

| Use | Size | Weight | Notes |
|---|---|---|---|
| Doc / page title | 22px | 600 | `letter-spacing: 0.02em` |
| Topbar greeting / panel title | 16px | 600 | |
| Section header in panel | 15px | 600 | |
| Card title | 14px | 600 | `line-height: 1.3` |
| **Body (default)** | **13px** | 400 | Set on `body`. Most operator copy. |
| Right Hand surface title (right rail) | 13px | 600 | Was `.cos-title` in v2 (pre-rename). |
| Sub / metadata | 12px | 400 | `--kerf-text-dim` |
| Operator labels, badges, control text | 11px | 400–600 | The dominant operator size |
| Micro / button-sm / step-dot / status-dot | 10px | 600 | |
| Tiny strip labels | 9px | 600 | Brand-strip stripe label only |

**Font stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No web fonts. No icon fonts. SVGs inline if needed.

**Line-height:** `1.4` body default. `1.3` on titles. Don't reset to `normal`.

---

## Spacing rhythm

The canon uses a tight, asymmetric rhythm — not a strict 4 / 8 / 16 grid.

Common values, in order of frequency:

- **Padding:** `14px` · `10px 14px` · `20px 28px` · `16px` · `10px 18px` · `8px 14px` · `8px 12px` · `8px 10px`
- **Card / panel padding:** `14px` (card body), `20px 28px` (page-level container)
- **Doc header padding:** `22px 40px`
- **Wireframe container padding:** `30px 40px`
- **Gap (flex/grid):** `8px` (tight clusters), `12px` (control rows), `16px` (panel sections)
- **Border-radius:** `4px` (chips, small buttons), `6px` (cards, panels), `50%` (status dots, avatars)

**Rule of thumb:** if your value isn't one of `4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 28 / 40 / 50`, you're probably off-grid. Snap to the nearest canon value before shipping.

---

## Layout primitives

- **Topbar:** `height: 50px`. Brand mark left, greeting / context center, user / actions right. Background gradient `linear-gradient(180deg, #14181F 0%, #0A0D11 100%)`. Bottom border `1px solid var(--kerf-border)`.
- **Brand strip (left rail):** narrow vertical column with tenant indicators. 22px circular dots for tenant brand colors with `--ggr` / `--val` / `--hpg` fills.
- **Right Hand module rail:** vertical icon column with 24px-wide module dividers (`background: var(--kerf-border)`, height 1px). In v2 this was labelled "COS module rail" via `.cos-*` CSS classes — same surface, renamed. Right Hand chrome (avatar, status, indicator) uses `--rh` brass, not amber.
- **Panels:** `background: var(--kerf-panel)`, `border-radius: 6px`, `border: 1px solid var(--kerf-border)`. Nested panels use `--kerf-panel-2`.
- **Frames** (in the wireframe doc itself): `min-height: 560–760px` depending on content density. The W1 demo viewport target is 1440×900.
- **Container max-width:** `1600px` for wireframe canvas. The actual app uses fluid widths but should not exceed this on Standard UI.
- **Authority lattice** (v4+): grid layout of authority bands × decision domains. Cells are panels, lattice rows show altitude tiers (L0–L4). Background grid `1px solid var(--kerf-border)`.
- **Blackboard surfaces** (v4+): event-log views, projections, causal graph. Chrome in `--future` purple, content in standard panel colors.

---

## Status / state vocabulary

| State | Visual | Token |
|---|---|---|
| Healthy / approved / hi-confidence | Green dot or band | `--success` / `--confidence-hi` `#5FB37A` |
| Needs attention / med-confidence | Amber-yellow dot or band | `--warn` / `--confidence-med` `#E0A858` |
| Blocked / failed / lo-confidence / drift | Red dot or band | `--alert` / `--confidence-lo` `#CF5B5B` |
| In progress | Amber accent | `--kerf-amber` `#D4923A` |
| Right Hand active | Brass dot or border | `--rh` `#C9A876` |
| Blackboard / future-state | Purple dot or border | `--future` `#7E6FCF` |
| Sentry alert | Sentry yellow | `--sentry` `#E0A858` (same hue as warn — context disambiguates) |
| MCP integration | Cyan-teal | `--mcp` `#5FB3B5` |
| Inactive / muted | Text-mute color | `--kerf-text-mute` `#5F6670` |

**Status dot pattern:** `width: 8px; height: 8px; border-radius: 50%`. Used inline before the label.

**Step dot pattern (for sequenced flows):** `width: 18px; height: 18px; border-radius: 50%; background: var(--kerf-panel-2); color: var(--kerf-text-dim); font-size: 10px; font-weight: 700`.

---

## Primary vs secondary affordance

The canon enforces a clear hierarchy in operator surfaces:

**Primary (one per panel max):**
- Action button using amber border or amber-on-dark fill
- 14px label, 8–10px vertical padding
- Always paired with a confidence indicator and source-ref count
- For Right Hand–driven actions, primary uses `--rh` border instead of amber

**Secondary (multiple OK):**
- Ghost button: `background: var(--kerf-panel-2)`, `color: var(--kerf-text)`, `font-size: 11px`
- Used for "details", "source", "log entry", expand-toggle, etc.

**Tertiary / micro:**
- Text-only, often `--kerf-text-dim`, 10–11px
- Used for inline metadata, timestamps, "n more" counters

**Anti-pattern:** two amber primary buttons in the same panel. If a card has two next steps, one must be ghost.

---

## What stays in audit disclosure (below the fold)

Per CLAUDE.md §3.5 (source-or-silent), every agent claim carries `SourceRef[]`. The UI rule:

- **First viewport:** decision title, primary action, confidence band, single-line summary, who/when, source count badge.
- **On expand:** full source refs (with links), validator output (V1/V2/V6/V7/V8/V9/V12/V17/V18 results), DecisionPacket payload, altitude class (L0–L4) badge, prior decision lineage if any.
- **Audit log right rail:** every event in append-only order, with `correlationId` chains. Filter by actor / role / time. Never editable.
- **Right Hand reasoning:** Right Hand's draft rationale, candidate options it considered, and the source basis it used go in expand state — never in the first viewport for the decision queue.

Do not collapse audit detail into tooltips or popovers — it has to be inspectable, copyable, and screenshottable.

---

## What must be visible in the first viewport (Decision Queue)

When a user lands on the Standard UI decision queue, viewport above the fold (≈900px on a 1440 display) must include:

1. Topbar (50px) — context, current tenant, user.
2. Filter / sort row — open by default, not behind a "Filter" button.
3. The top-ranked decision card, fully visible, with its primary action affordance.
4. Either the next-card preview (at least the title row) **or** the right-rail action log entry point.
5. Status of the system tile (green/amber/red) — the answer to "should the operator be looking at this right now."
6. Right Hand availability indicator (brass dot, in topbar or module rail) — whether the agent is online and ready to draft.

Anti-pattern: marketing copy, "welcome" hero, "no decisions yet" empty state when decisions exist, oversized brand mark, "Chief of Staff" anywhere in copy.

---

## State coverage matrix (canon revs vs W1 demo)

| State / surface | In canon? | Which file | Where it lives now (if not in canon) |
|---|---|---|---|
| Standard dashboard shell | Yes | v2 (`#frame-dashboard-std`) | shared shell |
| Project + generative widget | Yes | v2 (`#frame-project`) | — |
| Graphical dashboard | Yes | v2 (`#frame-dashboard-graph`) | — |
| Kerf Teams (L0–L3) | Yes | v2 (`#frame-teams`) | — |
| Homeowner SMS thread | Yes | v2 (`#frame-homeowner`) | consumer-facing |
| Plays authoring | Yes | v2 (`#frame-plays`) | — |
| 60-second undo state | Yes | v2 (`#frame-undo`) | — |
| Homeowner e-sig view | Yes | v2 (`#frame-homeowner-esig`) | consumer-facing |
| Apr 23 addendum | Yes | v2 (`#apr23-addendum`) | — |
| Operator landing | Yes | v3 (`#operator-landing`) | — |
| MoO CoS surface (pre-rename) | Yes | v3 (`#moo-cos`) | renamed to Right Hand in v4 |
| Intake mode picker | Yes | v3 (`#intake-mode-picker`) | — |
| Intake voice / form / draft / capture / consent | Yes | v3 (multiple ids) | — |
| LiDAR edit | Yes | v3 (`#lidar-edit`) | — |
| Approval authoring | Yes | v3 (`#approval-authoring`) | — |
| Fintech surface | Yes | v3 (`#fintech`) | — |
| Co-intake | Yes | v3 (`#co-intake`) | — |
| Desktop view | Yes | v3 (`#desktop`) | — |
| **Right Hand landing** | Yes | v4 (`#landing`) | — |
| **Authority lattice** | Yes | v4 (`#lattice`) + v5 | — |
| **Blackboard roles** | Yes | v4 (`#bb-roles`) | — |
| **Blackboard mobile** | Yes | v4 (`#bb-mobile`) | — |
| **Altitude + multi-agent** | Yes | v5 | — |
| **Client portal** | Yes | v5.1 (`#client-portal`) | — |
| **Sentry surface** | Yes | v5.1 (`#sentry`) | — |
| **MCP integrations** | Yes | v5.1 (`#mcp`) | — |
| **Guardrails** | Yes | v5.1 (`#guardrails`) | — |
| **Cost KB** | Yes | v5.1 (`#cost-kb`) | — |
| **Bilingual EN/ES** | Yes | v5.1 (`#bilingual`) | — |
| Mobile / narrow base | Yes | `kerf_wireframes_mobile_v2.html` | — |
| **Proposal-first decision queue** | No | — | `src/examples/w1-decision-queue-demo.html` |
| **Proposal detail review panel** | No | — | same file, expand interaction |
| **Decision card V1 styling** | No | — | `src/ui/styles/decision-card.css` |
| **Blocked / source-missing card** | No | — | `decision-card.css` status hooks |
| **Owner-review card** | Partial — pattern only | v2 cards | `decision-card.css` |
| **Drift card with severity badge** | No | — | `w1-decision-queue-demo.html` |
| **Reject / false-positive reason form** | No | — | `w1-decision-queue-demo.html` |
| **Empty state** | No | — | not yet built |

When you need a state that isn't in the canon, **use canon tokens and density** to build it. Do not invent new tokens. If a new visual primitive is genuinely needed, propose it as a canon-side change in `kerf-cos/_docs/wireframes/` and re-sync this directory.

---

## Quick render check

Open any of the canon files directly in a browser:

```sh
open docs/wireframes/kerf_wireframes_web_v2.html        # base shell
open docs/wireframes/kerf_wireframes_v3_apr23.html      # intake pack
open docs/wireframes/kerf_wireframes_v4_apr26.html      # Right Hand + Blackboard
open docs/wireframes/kerf_wireframes_v5_apr26.html      # lattice + altitude
open docs/wireframes/kerf_wireframes_v5_1_apr26.html    # client portal + Sentry + MCP
open docs/wireframes/kerf_wireframes_mobile_v2.html     # mobile reference
```

What you should see in any of them:
- Top header strip with the rev title and date
- Vertical scroll of frames against `#0A0D11` canvas
- Amber accents only on dividers, focused elements, and brand strip
- Right Hand chrome (v4+) in brass `#C9A876`, not amber
- No external font loading flash, no broken image icons, no console errors

If you see any of: light background, oversized type, missing colors, broken layout — the file is corrupted or the browser is forcing a light theme. Disable any "force dark / force light" extensions and reload.
