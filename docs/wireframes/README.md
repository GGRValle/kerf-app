# Kerf Standard UI — Wireframe Canon

This directory is the **canonical Standard UI wireframe reference** for Kerf's web/operator surfaces. W1 demo CSS, future operator-surface work, and any UI reviews should be aligned to this package.

The canon is layered: a base shell (v2) plus four thematic delta packs (v3 → v5.1) added between Apr 23 and Apr 26, 2026. Each HTML file is fully self-contained — no CDN deps, no fonts, no images, no network fetches. Open any of them directly in a browser.

---

## Naming — read this first

The agent is **Right Hand** (Spanish: **Mano Derecha**). It was renamed from "Chief of Staff" / "CoS" / "MoO CoS" on **Apr 26, 2026**. All operator-surface, customer-facing, and new code must use **Right Hand**.

Files dated **before Apr 26** (v2 Apr 21, v3 Apr 23) still contain the old "CoS" / "MoO CoS" naming and CSS classes (`.cos-title`, `.cos-sub`, `id="moo-cos"`). Those files are preserved verbatim as historical canon — do not rewrite the HTML to backport the rename. **Do** use "Right Hand" in:

- new code (TS, CSS, JSX)
- new copy / I18nKey strings
- this README, `notes.md`, and any future documentation
- PR descriptions and commit messages

The `--rh` (`#C9A876`) and `--rh-dim` (`#6B5938`) color tokens were introduced in v4 (Apr 26) specifically for the Right Hand surface. Use those, not amber, for Right Hand chrome.

---

## Contents

| File | Date | Purpose | SHA-256 (pin to canon) |
|---|---|---|---|
| `kerf_wireframes_web_v2.html` | Apr 21 | **Base shell.** 9 frames: legend, std dashboard, project + generative widget, graph dashboard, teams (L0–L3 + cost/outcome), homeowner SMS, plays authoring, 60-second undo, e-sig view, plus Apr 23 addendum. Defines the foundational tokens (amber, dark canvas, panels, type scale, brand tenant colors). | `f7b4d009dd5f53575e092e1ca5b93391a9d9130e650a6a62c128daa0fe6a8261` |
| `kerf_wireframes_mobile_v2.html` | Apr 21 | Mobile / narrow-layout reference companion to v2. | `bc1be9787dfc194d47b709174c97860873a9b1437c596e7ec8f047c49305fc9a` |
| `kerf_wireframes_v3_apr23.html` | Apr 23 | **Intake + operator-landing pack.** Operator landing, MoO CoS surface (pre-rename to Right Hand), intake flow (mode-picker, voice, form, draft, capture, consent), LiDAR edit, approval authoring, fintech, co-intake, desktop view. | `432f6e845aa430bb5c210d393a7c5c9155cd1545fcc29458024cd170fed8c037` |
| `kerf_wireframes_v4_apr26.html` | Apr 26 | **Right Hand + Robust Blackboard.** Landing, authority lattice, Blackboard roles, Blackboard mobile. Introduces `--rh` (`#C9A876`) Right Hand color and `--future` (`#7E6FCF`) Blackboard color. First post-rename canon. | `8b929931c5e310f468312276e5b2e2f74f15e9fef5f82bed41e5ba248c137b1a` |
| `kerf_wireframes_v5_apr26.html` | Apr 26 | **Authority lattice + altitude + multi-agent.** Extends v4's lattice with altitude tiers (L0–L4) and multi-agent coordination surfaces. | `05ff51cc31f66c88de1920936409ff905f6f791ecca3e511bf53b8f7a7036cd8` |
| `kerf_wireframes_v5_1_apr26.html` | Apr 26 PM | **Client portal + Sentry + MCP + guardrails + cost KB + bilingual.** Latest canon. Adds `--sentry` (`#E0A858`) and `--mcp` (`#5FB3B5`) tokens. Bilingual EN/ES surface reference. | `54c6a45500fe0dcd7be2869e4a9a1fdaf8c1ea9705722f6095929601c1e5a41d` |
| `notes.md` | — | Token cheat sheet (full superset across all six files), type/spacing scale, primary-vs-secondary affordance rules, audit-disclosure conventions, state-coverage matrix. |

When tokens disagree across revs, **the latest rev wins** (v5.1 > v5 > v4 > v3 > v2). v2's tokens are a strict subset of v5.1's.

---

## Provenance — read before editing

These files are **verbatim copies** from the parent canon repo (`GGRValle/kerf-cos`) at `_docs/wireframes/`. Two-repo boundary applies (locked `2026-04-23.0`, see `kerf-app/CLAUDE.md` §3.8): the wireframes are canon-side; this directory is the kerf-app working copy so engineering can compare against the canon without leaving the repo.

When the canon updates, update this copy from canon — do not edit the HTML in this directory directly. If a new state is needed:

1. Land the change in the canon repo (`kerf-cos/_docs/wireframes/`) first.
2. Open a follow-up PR here that re-copies the canon HTML(s), updates the SHA pins above, and updates `notes.md`.

This keeps the two repos from drifting under separate authorship. To verify parity against canon at any time, re-run `shasum -a 256` against each file and check against the table above.

---

## State coverage — what each rev actually contains

The task brief listed several W1 demo states (proposal-first decision queue, proposal detail review, blocked / source-missing card, owner-review, drift severity badge, reject reason form, empty state). **Most of those post-date even v5.1 and live in `src/examples/` and `src/ui/styles/`,** built on top of the canon's tokens and shell.

What the canon covers (use as the visual contract):

**v2 base shell (Apr 21)**
- 50px topbar, dark canvas (`#0A0D11`), panel system (`#1A1F26` / `#232932`)
- Amber accent (`#D4923A`), 13px body / 11–12px operator type scale
- Brand strip + module rail (the surface where Right Hand later lives)
- Generative widget panel pattern (project frame)
- Graph dashboard layout (alternative to standard)
- Teams view with L0–L3 altitude badges and cost/outcome columns
- Homeowner SMS thread + e-sig view (consumer-facing)
- Plays authoring surface
- 60-second undo state
- Confidence colors (hi/med/lo) and severity colors (success/warn/alert)
- Brand tenant colors (GGR / Valle / HPG)

**v3 intake pack (Apr 23)**
- Operator landing (pre-rename layout)
- MoO CoS surface (renamed to Right Hand surface in v4)
- Intake mode picker → voice / form → draft → capture → consent flow
- LiDAR edit canvas
- Approval authoring
- Fintech surface
- Co-intake (operator + customer in same session)
- Desktop view

**v4 Right Hand + Blackboard (Apr 26)**
- Landing redone for Right Hand
- Authority lattice (the new core navigation primitive)
- Blackboard roles surface
- Blackboard mobile
- New tokens: `--rh` Right Hand color, `--future` Blackboard color

**v5 lattice + altitude + multi-agent (Apr 26)**
- Authority lattice with altitude tier layering (L0–L4 explicit)
- Multi-agent coordination view

**v5.1 client portal + integrations + guardrails (Apr 26 PM)**
- Client portal surface
- Sentry surface (new `--sentry` token)
- MCP integrations surface (new `--mcp` token)
- Guardrails surface
- Cost KB surface
- Bilingual EN/ES reference

What the canon does **not** cover (and where to look instead):

| State | Where it lives now |
|---|---|
| Proposal-first decision queue | `src/examples/w1-decision-queue-demo.html` |
| Proposal detail review panel | same demo, expand-on-select interaction |
| Decision card (V1 styling) | `src/ui/styles/decision-card.css` + `src/examples/decision-card-demo.html` |
| Blocked / source-missing card | `src/ui/styles/decision-card.css` (status hooks) |
| Drift severity badge | `src/examples/w1-decision-queue-demo.html` (drift card) |
| Reject / false-positive reason form | `src/examples/w1-decision-queue-demo.html` |
| Action log / right rail | `src/examples/w1-standard-ui-demo.css` |

If you're aligning W1 CSS against the Standard UI canon, the right comparison is **tokens + shell + density** from the canon, plus **state-specific behavior** from the W1 files above. Don't expect every W1 state to appear in the canon HTMLs.

---

## Compare against (W1 demo files)

When polishing the W1 demo, diff against:

- `src/examples/w1-decision-queue-demo.html` — the live operator surface
- `src/examples/w1-standard-ui-demo.css` — Standard UI shell stylesheet for the demo
- `src/ui/styles/decision-card.css` — decision card component styles
- `src/ui/styles/decision-queue.css` — queue layout

If the W1 demo and the canon disagree on a token, **the canon wins** unless the disagreement is documented in a decision (`_docs/decisions/` in canon) or in this file's "Known canon-vs-demo deltas" section below.

---

## Do-not-regress checklist

When reviewing any operator-surface UI change, confirm:

- [ ] Topbar is **50px** tall (not 56, not 64, not 48).
- [ ] Body / canvas is **`#0A0D11`** — the deep blue-black.
- [ ] Panels are **`#1A1F26`** primary / **`#232932`** secondary. Borders **`#2F3641`**.
- [ ] Amber accent is **`#D4923A`** (warm/burnt). Not orange. Not gold.
- [ ] **Right Hand surface** uses `--rh` (`#C9A876`) for chrome, not amber. Reserved.
- [ ] **Blackboard / future-state** UI uses `--future` (`#7E6FCF`) for chrome.
- [ ] **Sentry** surfaces use `--sentry` (`#E0A858`); **MCP** surfaces use `--mcp` (`#5FB3B5`).
- [ ] Body type is **13px**. Operator controls **11–12px**. Micro-labels **10px**. No 16px+ body in dense surfaces.
- [ ] Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No web fonts loaded.
- [ ] Card / panel padding is in the **10px / 14px / 16px / 20px / 28px** rhythm. No arbitrary 13px / 17px / 22px paddings.
- [ ] Confidence is communicated by **color band** (hi/med/lo = `#5FB37A` / `#E0A858` / `#CF5B5B`), not by emoji or text alone.
- [ ] Severity (drift, alert, warning) uses **success / warn / alert** tokens — same palette as confidence, with stable semantic mapping.
- [ ] Brand tenant colors (GGR `#4A7FB0`, Valle `#A8794A`, HPG `#4A9F74`) are reserved for tenant-tagging — do not repurpose for severity, status, or agent identity.
- [ ] **No "Chief of Staff" / "CoS" / "MoO CoS" copy** in any new operator surface, error message, I18nKey, or marketing string. Use **Right Hand** / **Mano Derecha**.
- [ ] Operator UI is **dense**, not marketing-page. No hero sections, no oversized CTAs, no centered "Get started" copy on operator surfaces.
- [ ] Margin is **never** rendered in any client-facing path (CLAUDE.md §3.2). Operator panels can show it; consumer surfaces cannot.
- [ ] All render-to-user strings are `I18nKey`s (CLAUDE.md §3.6). No bare English strings in JSX/HTML for operator copy. Bilingual reference: `kerf_wireframes_v5_1_apr26.html` (`#bilingual`).
- [ ] Audit disclosure (source refs, decision packet detail, validator output) sits **below** the primary action affordance — visible on expand, not in the first viewport.
- [ ] First viewport on the decision queue shows: filter row, top decision card with primary action, action log entry point. Not: marketing copy, empty hero, undecorated lists.

---

## Screenshot-readiness criteria

When capturing screenshots for evidence packets or PR review:

- **Viewport width:** 1440px (laptop) for canon comparison; 1920px for the wide-display reference. The canvas inside `.wireframe-container` caps at `max-width: 1600px`.
- **Browser zoom:** 100%. Anything else makes the type scale lie.
- **Color profile:** sRGB. The amber and the dark canvas both shift visibly under wide-gamut profiles.
- **First viewport must show:** topbar (50px, fully visible), brand strip on the left, primary content panel header, at least one decision card / project card with its full action affordance row.
- **What a correct screenshot shows:** dark canvas behind everything, amber only on accents (not as a fill on large surfaces), Right Hand chrome in `--rh` brass tone (not amber), 13px body type comfortably legible at 100% zoom, no system font fallbacks visible.
- **What a wrong screenshot shows:** light backgrounds, amber-as-fill, oversized type (16px+ body), web font loading flash, browser scrollbars overlapping content, focus rings missing on interactive elements, "Chief of Staff" anywhere on screen.

For the W1 demo specifically, see `src/examples/W1_ACCEPTANCE_EVIDENCE.md` and `src/examples/W1_PROOF_PACKET.md` for screenshot acceptance criteria already tied to evidence packets.

---

## Known canon-vs-demo deltas

Document any intentional disagreement between the canon and live demo CSS here, with a link to the decision that authorized it.

- _(none yet)_

---

## What this directory is **not**

- Not a design system. Real component documentation lives in code (`src/ui/`).
- Not a screenshot archive. PR screenshots go in `src/examples/evidence/`.
- Not a fork of the canon. Any change here that doesn't trace back to a canon-side change is a regression by definition.
- Not a Figma replacement. The original design source is `kerf_wireframes_design.jsx` in the canon repo.

---

*Last updated: 2026-05-03. Branch: `docs/standard-ui-wireframe-canon`. Six HTML files spanning Apr 21 – Apr 26, 2026, plus README + notes.*
