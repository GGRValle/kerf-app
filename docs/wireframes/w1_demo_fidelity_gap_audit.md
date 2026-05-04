# W1 Demo ↔ Standard UI Wireframe Canon — Fidelity Gap Audit

**Date:** 2026-05-03
**Auditor:** Claude Code (Visual QA Agent)
**Base branch:** `main` @ `bd32a00` (latest merged: PR #98 *align W1 operator summary with canon*)
**In-flight context:** PR #99 *add Standard UI navigation rail* is **OPEN** and inspected as part of this audit.

---

## 0. Scope and method

This audit compares:

- **Demo:** `src/examples/w1-decision-queue-demo.html` + `src/ui/styles/decision-card.css` + `src/ui/styles/decision-queue.css` + `src/examples/w1-standard-ui-demo.css`
- **Canon:** `docs/wireframes/kerf_wireframes_web_v2.html` (base shell) + `docs/wireframes/kerf_wireframes_v4_apr26.html` (Right Hand + Blackboard) + `docs/wireframes/kerf_wireframes_v5_1_apr26.html` (latest superset) + `docs/wireframes/README.md` + `docs/wireframes/notes.md`

When canon revs disagree, **v5.1 wins** (per `README.md` §"When tokens disagree across revs"). Canon README precedence rules used: do-not-regress checklist + screenshot-readiness criteria.

This is a diagnosis/report PR. No code, tests, or canon files were modified.

---

## 1. Executive summary — what feels non-canon

The demo's **shell, layout proportions, and density rhythm** are the dominant fidelity gap, not its content or behavior. Three structural mismatches account for ~80% of the "looks off" perception:

1. **The demo has no Right Hand rail and no module rail.** Canon's app grid is `56px module · 320px cos-rail · 1fr main` — a three-column shell where Right Hand presence is part of the operator's first-viewport context. The demo is `1fr main · 12.5–15.5rem log rail` — a two-column shell where the right rail is the audit log. PR #99 adds a left side-nav, but the rail it introduces (`8.75–10.5rem`) is **neither** the canon module rail (56px icon column) **nor** the canon cos-rail (320px Right Hand surface). It's a hybrid that doesn't match either canon primitive.
2. **The accent color in the production decision card is blue (`#3d7dd9`), not amber (`#D4923A`).** The W1 shell does override at the outermost level (`--kerf-w1-brand: #d4923a`), but card internals still use `var(--kerf-accent)` for action highlights, banded backgrounds, and focus tones — so anything *inside* a card on the W1 surface picks up blue tinting where canon expects amber. This is the single most visually wrong token in the demo.
3. **Density rhythm is off-grid in both directions.** Body type is 14px (canon 13px = +7% universal bloat). After PR #94's tightening, card padding compressed to `0.78/0.9/0.85rem` ≈ 11/12.6/12px (canon: 14px flat) — undershooting in the opposite direction. Section labels are 9.6/8.75px (canon: 11px operator / 10px micro). The demo oscillates around canon density rather than matching it.

The demo's **token vocabulary** is also drifted: text/text-dim/border/panel hex values differ from canon by 1–6 hex units across the board (cooler tone vs canon's warm off-white). Subtle individually; cumulative side-by-side.

What's already aligned: topbar height (50px), demo brand color (`#d4923a` exact match), the W1 shell's outer canvas (`#0a0d11` exact match), font stack (overlap with canon), `box-sizing: border-box` reset.

---

## 2. Token comparison table

Pulled verbatim from `decision-card.css :root` and `w1-standard-ui-demo.css .kerf-w1-standard-ui` against canon's `kerf_wireframes_v5_1_apr26.html` :root + `notes.md` cheat sheet.

| Token / role | Canon (v5.1) | Demo `decision-card.css :root` | Demo `.kerf-w1-standard-ui` | Verdict |
|---|---|---|---|---|
| Canvas / body bg | `#0A0D11` | `--kerf-bg-app: #12151a` | `--kerf-w1-bg: #0a0d11` | Card root WRONG; W1 shell override OK |
| Primary panel | `#1A1F26` | `--kerf-bg-card: #1a1f27` | `--kerf-w1-panel: #1a1f26` | Card root off-by-1; W1 shell OK |
| Secondary panel | `#232932` | `--kerf-bg-elevated: #222831` | `--kerf-w1-panel-raised: #232932` | Card root off-by-1; W1 shell OK |
| Hairline border | `#2F3641` | `--kerf-border: #343c4a` | (inherits from card) | WRONG — demo border 5 hex steps lighter |
| Primary text | `#E8E6E1` (warm) | `--kerf-fg: #e8ecf1` (cool) | (inherits) | WRONG — demo text is cooler/bluer |
| Secondary text | `#9097A1` | `--kerf-fg-muted: #9aa3b2` | (inherits) | WRONG — demo lighter and bluer |
| Tertiary text | `#5F6670` | (no token; uses `--kerf-fg-muted`) | (no token) | MISSING — demo collapses two canon levels into one |
| **Accent** | `#D4923A` (amber) | `--kerf-accent: #3d7dd9` (blue) | `--kerf-w1-brand: #d4923a` ✓ | **CARD CSS WRONG**; W1 brand-level override correct, but `--kerf-accent` is what `color-mix(... var(--kerf-accent) ...)` rules consume inside cards |
| Action button color | n/a (canon uses amber) | n/a | `--kerf-w1-action: #c28a32` | OFF — slightly darker amber than canon `#D4923A` |
| Right Hand chrome | `--rh: #C9A876` | NOT DEFINED | NOT DEFINED | MISSING — required by canon for any Right Hand surface |
| Blackboard chrome | `--future: #7E6FCF` | NOT DEFINED | NOT DEFINED | MISSING — required for blackboard projections |
| Confidence-hi / success | `#5FB37A` | NOT DEFINED as confidence | NOT DEFINED | MISSING semantic alias |
| Confidence-med / warn | `#E0A858` | NOT DEFINED | NOT DEFINED | MISSING semantic alias |
| Confidence-lo / alert | `#CF5B5B` | uses `--kerf-danger-muted: #a67a7a` | (inherits) | WRONG — demo's red is materially desaturated vs canon |

**Headline token finding:** demo `decision-card.css` ships **a blue-accented dark theme** that the W1 shell partially repaints amber. Anywhere in card CSS that uses `var(--kerf-accent)` (e.g., line 146 `color-mix(in srgb, var(--kerf-accent) 16%, var(--kerf-bg-card))` for action highlight banding) renders blue under W1 — directly contradicting canon's "amber accent everywhere" rule.

---

## 3. Typography scale comparison

| Use | Canon size | Demo (W1-scoped, after PR #94) | Verdict |
|---|---|---|---|
| Body (set on `body`) | **13px** | 14px (`html:has(.kerf-w1-standard-ui)` and `body` in card css) | OFF — universal +7% scale bloat |
| Page / doc title | 22px / 600 | n/a (no doc title in demo) | n/a |
| Topbar greeting / panel title | 16px / 600 | `1rem` = 14px on 14px root, but should be 16px | OFF |
| Section header in panel | 15px / 600 | n/a (demo uses tag-style mini-labels here) | DIVERGENT but possibly intentional |
| Card title | 14px / 600 / lh 1.3 | `clamp(1rem, 0.96rem + 0.35vw, 1.286rem)` ≈ 14–18px | OFF at narrow / OK at midpoint / OFF at 1440 |
| Body / sub | 12px | `0.8125rem` = 11.4px on 14px root ≈ 11.4px | OFF (1px too small) |
| **Operator labels / badges (dominant tier)** | **11px / 400–600** | `.kerf-section h3 { font-size: 0.6875rem }` = 9.6px on 14px root | WRONG — canon's dominant operator tier is 11px; demo runs the section labels at 9.6px |
| Micro / button-sm / status dot | 10px / 600 | `.kerf-section h4 { font-size: 0.625rem }` = 8.75px | WRONG — undershoots canon micro by 1.25px |
| Tiny strip labels | 9px / 600 | n/a | n/a |
| Line-height (body) | 1.4 | `--kerf-leading-normal: 1.45` | OFF by 0.05 |
| Line-height (title) | 1.3 | `--kerf-leading-tight: 1.28` | OK (within rounding) |

**Impact:** PR #94 corrected the original "huge serif text" report by tightening, but **overshot canon by ~1–2px on most labels** while leaving body 1px too large. The demo's section labels at 9.6px are noticeably squinty next to canon's 11px operator labels.

---

## 4. Layout / shell comparison

### 4.1 App grid columns

| Surface | Columns | Source |
|---|---|---|
| **Canon** (v2 base) | `56px module-rail · 320px cos-rail · 1fr main` | `kerf_wireframes_web_v2.html:79–83` |
| **Demo on `main`** | `1fr main · minmax(12.5rem, 15.5rem) log-rail` (above 1024px breakpoint) | `w1-standard-ui-demo.css:289–292` |
| **Demo on PR #99** | `minmax(8.75rem, 10.5rem) side-nav · 1fr main · minmax(12.5rem, 15.5rem) log-rail` | PR #99 diff |

**Finding:** the demo never had a Right Hand rail (canon's 320px `.cos-rail`) and never had a module rail (canon's 56px `.module-rail`). PR #99 adds a single ~150px nav rail that is structurally a hybrid — wider than the icon module rail, narrower than the Right Hand rail, and content-different from both. This is forward progress in the sense that "demo now has a left rail," but it's not a canon-shaped left rail.

### 4.2 Right rail (action log vs cos-rail)

| Property | Canon `.cos-rail` (Right Hand surface) | Demo `.kerf-w1-log-panel` (action log) |
|---|---|---|
| Width | 320px | 12.5–15.5rem (200–248px) |
| Background | `var(--kerf-panel)` `#1A1F26` | `var(--kerf-bg-elevated)` `#222831` (uses panel-2; ≠ canon) |
| Header content | Right Hand title + green dot + status | "Action log" `<h2>` + descriptive `<p>` + control toolbar |
| Body content | Right Hand reasoning, candidates, source basis | Append-only audit log entries |

**Important nuance:** these two rails serve **different purposes** in the canon. Canon has *both*:
- The **cos-rail** (Right Hand surface, 320px) to the left-of-main
- The **audit log right rail** to the right-of-main, which canon notes describe as "every event in append-only order, with `correlationId` chains"

The demo only has the audit log (in the right slot). The Right Hand surface is missing entirely. So the demo isn't using a wrong rail — it's using only one of the two rails canon expects.

### 4.3 Container widths

- Canon: `.wireframe-container { max-width: 1600px }`, viewport target 1440×900
- Demo: `.kerf-w1-demo-shell { max-width: 1600px }` — matches canon
- Demo's `decision-card.css`: `.kerf-decision-card { max-width: 44rem }` — 616px at 14px root, narrower than canon's per-frame content widths but acceptable for card stack

---

## 5. Top 10 visual gaps ranked by demo impact

Rank logic: each gap is scored on (a) how broadly it propagates across the demo and (b) how visible it is in screenshot review. Gap 1 propagates to every card. Gap 10 affects only the first-viewport check.

### Gap 1 — Accent color is blue, not amber (in card body)
- **Current behavior:** `decision-card.css :root { --kerf-accent: #3d7dd9 }`. Card-level rules using `color-mix(... var(--kerf-accent) ...)` produce blue-tinted backgrounds and highlights inside cards on the W1 surface.
- **Canon expectation:** `--kerf-amber: #D4923A` everywhere. Right Hand chrome would use `--rh: #C9A876` (still amber-family). No blue in the canon palette except as outright not-canon.
- **Likely file/rule responsible:** `src/ui/styles/decision-card.css` line 16.
- **Recommended fix:** scope `--kerf-accent: #D4923A` override under `.kerf-w1-standard-ui` (don't change the production token until non-W1 surfaces also align). Or, more permanently, change the production root to amber and add a different token name for any UI that genuinely needs blue.
- **Risk level:** LOW (CSS-only, scoped). Visible improvement on every card.

### Gap 2 — No Right Hand rail (canon's `.cos-rail`)
- **Current behavior:** demo has no Right Hand surface at all. PR #99 adds a side nav but it's not the cos-rail.
- **Canon expectation:** `cos-rail` 320px wide, panel background, vertical column with Right Hand title (13px / 600) + status dot (`--success` w/ box-shadow glow) + reasoning content. Sits between module rail and main.
- **Likely file/rule responsible:** missing surface; would be added to `w1-decision-queue-demo.html` + `w1-standard-ui-demo.css`.
- **Recommended fix:** either accept that proposal-first decision queue doesn't surface Right Hand reasoning (and document this as an intentional "Known canon-vs-demo delta" in `wireframes/README.md`), or design + add a 320px Right Hand rail with at minimum a status indicator. Don't conflate this with the PR #99 side nav.
- **Risk level:** MED. New surface = new design decisions. Don't wedge into PR #99.

### Gap 3 — No module rail (canon's 56px `.module-rail`)
- **Current behavior:** missing.
- **Canon expectation:** 56px far-left vertical column with module icons (40×40px), active marker bar, hover tooltip pattern. Background `#0A0D11` (darker than panel).
- **Likely file/rule responsible:** missing surface.
- **Recommended fix:** if the demo's left side-nav from PR #99 is meant to replace the module rail, it needs to compress to 56px and use icon-only items. Otherwise, document the divergence intentionally.
- **Risk level:** MED. Tied to navigation IA decisions, not just CSS.

### Gap 4 — Body font-size 14px instead of canon 13px
- **Current behavior:** `decision-card.css body { font-size: 14px }` and `w1-standard-ui-demo.css html:has(...) { font-size: 14px }`.
- **Canon expectation:** body 13px universally (`kerf_wireframes_web_v2.html:25`).
- **Likely file/rule responsible:** `decision-card.css:51` (production), `w1-standard-ui-demo.css:13` (W1 shell).
- **Recommended fix:** drop both to 13px. Update existing rem-based rules across the W1 shell — at 13px root, the previous `0.6875rem` becomes `0.846rem` for canon's 11px operator label; `0.769rem` for canon's 10px micro.
- **Risk level:** MED — shifts every typeset element. Need a coordinated PR.

### Gap 5 — Border color too light (`#343c4a` vs canon `#2F3641`)
- **Current behavior:** `--kerf-border: #343c4a` in `decision-card.css :root`. Approximately 5 hex steps lighter.
- **Canon expectation:** `--kerf-border: #2F3641` — visibly darker, closer to panel-2.
- **Likely file/rule responsible:** `decision-card.css:14`.
- **Recommended fix:** change to `#2F3641`. No scope override needed if we accept the production token can match canon.
- **Risk level:** LOW. Single-token swap. Visible — borders feel less prominent under canon value.

### Gap 6 — Text color is cooler-blue, not warm off-white
- **Current behavior:** `--kerf-fg: #e8ecf1`, `--kerf-fg-muted: #9aa3b2` — both on the cool/blue side of greyscale.
- **Canon expectation:** `--kerf-text: #E8E6E1`, `--kerf-text-dim: #9097A1` — distinctly warmer/yellower.
- **Likely file/rule responsible:** `decision-card.css:12–13`.
- **Recommended fix:** change values to canon. The warm off-white pairs with amber accents per the canon palette intent.
- **Risk level:** LOW. Two-token swap. Visible most in long body copy.

### Gap 7 — Section h3/h4 type undershoots canon labels
- **Current behavior:** `.kerf-section h3 { font-size: 0.6875rem }` = 9.6px; `h4` = 8.75px (PR #94 values).
- **Canon expectation:** operator labels 11px / 400–600. Micro labels 10px / 600. The dominant tier is 11px, not 9–10px.
- **Likely file/rule responsible:** `w1-standard-ui-demo.css` (PR #94 added these scoped rules); decision-card.css h3/h4 rules at lines 217–230 (different values, also non-canon at 12px and 11px equivalent).
- **Recommended fix:** when body root drops to 13px (Gap 4), set `.kerf-section h3 { font-size: 11px / 0.846rem }` and `h4 { 10px / 0.769rem }`.
- **Risk level:** LOW. Restores label legibility.

### Gap 8 — Card padding too tight after PR #94
- **Current behavior:** `--kerf-card-pad-y-start/x/y-end: 0.78rem 0.9rem 0.85rem` under `.kerf-w1-standard-ui` ≈ 10.9/12.6/11.9px on 14px root.
- **Canon expectation:** flat 14px on card body. Panel padding 14px or `10px 14px` as the dominant rhythm values.
- **Likely file/rule responsible:** `w1-standard-ui-demo.css` (PR #94 introduced the tighter values).
- **Recommended fix:** at 13px body root, set padding tokens to `1.077rem` (14px) flat. Removes the asymmetric y-start / y-end split — canon padding is symmetric.
- **Risk level:** LOW. May make cards feel slightly less compact; canon density is still tighter than typical SaaS.

### Gap 9 — Right rail width 12.5–15.5rem; canon-equivalent column is 320px / 20rem
- **Current behavior:** action log rail at `minmax(12.5rem, 15.5rem)` = 200–248px.
- **Canon expectation:** the right-of-main column in canon is 320px (`.cos-rail`) — though canon uses that slot for Right Hand, not action log. If treating the demo's audit log as the equivalent right-side workspace, 320px is more consistent.
- **Likely file/rule responsible:** `w1-standard-ui-demo.css:292`.
- **Recommended fix:** widen to `minmax(15rem, 20rem)` (240–320px). Verify card stack still has enough room at 1440px viewport.
- **Risk level:** LOW. Visual rebalance.

### Gap 10 — First viewport missing system status tile and Right Hand availability indicator
- **Current behavior:** demo first viewport shows topbar + filter row + first card + action log start. No system tile (green/amber/red answering "should the operator be looking at this right now"). No Right Hand availability dot.
- **Canon expectation:** README §"What must be visible in the first viewport" lists six items; demo hits 4/6.
- **Likely file/rule responsible:** missing markup in `w1-decision-queue-demo.html`.
- **Recommended fix:** add a status tile element to the topbar or as a column header above the queue. Add a brass-colored Right Hand dot in the topbar (8×8px, `--rh` color, simple availability indicator, not the full Right Hand rail).
- **Risk level:** MED. Component-level addition, not pure CSS.

---

## 6. Special-attention answers (from brief)

### Nav rail proportions
Canon: 56px module-rail + 320px cos-rail = **376px total left-side rails**. PR #99: ~150px single rail. **Verdict:** PR #99 is forward progress (gives the operator a left context column) but doesn't match either canon rail. Treat #99 as a stepping stone; document its proportions as a known delta until either (a) split into 56 + 320, or (b) the canon adopts a single ~150px rail.

### Queue / detail / log layout proportions
Canon dominant pattern (e.g., authority lattice, project + generative widget): main column carries the work, side rail carries reasoning context. The demo's queue/detail/log triple is reasonable for proposal-first review, but **the proposal detail panel currently flexes at `flex: 0 0 22rem` (352px) when expanded**, which is wider than canon's right-side rail (320px). This puts the detail panel and queue in roughly equal visual weight rather than the queue dominating with detail-as-context. **Recommendation:** detail panel should be 280–320px (canon range) so the queue card stack remains the primary scan surface.

### Typography scale
See Gaps 4, 7. Net: drop body to 13px, lift section labels to 11px / 10px, harmonize all card/W1 type to 13px-root rem values. This single change unblocks every other density issue.

### Card density
See Gap 8. Net: relax PR #94's tightening back toward canon's 14px flat padding. Demo currently oscillates around canon — overshoots in one direction, undershoots in the other.

### Panel border / background contrast
See Gaps 5, 6. Net: darker borders (`#2F3641`), warmer text (`#E8E6E1` / `#9097A1`). Together these produce the canon's distinctive "warm low-contrast operator console" feel. Demo currently reads as cooler/blue.

### Whether action log should remain visible in first viewport
**Yes** — canon explicitly lists "right-rail action log entry point" as one of the six first-viewport required elements (README §"What must be visible in the first viewport"). The current demo respects this. Do not move the action log below the fold.

### Whether proposal detail panel should dominate more than queue card stack
**No** — canon's dominant pattern is "main column owns the primary scan, side rails carry context." The detail panel is context for the selected card, not the primary surface. Currently 22rem detail panel is visually equal to the queue; canon would say it should be ~280–320px (≈ side-rail-equivalent) so the queue stack reads as the primary surface.

### Screenshot viewport: 1280, 1440, or wider?
**1440px**, per canon README §"Screenshot-readiness criteria" — "Viewport width: 1440px (laptop) for canon comparison; 1920px for the wide-display reference." 1280px collapses below the 1100px-breakpoint margin too easily and produces narrow-collapsed layouts that don't match the canon target. Lock screenshot capture at 1440×900 (canon's stated demo viewport) for the proposal F&F evidence packet.

---

## 7. Do not change — already aligned with canon

These elements pass canon checks and should not be modified by the next CSS PR:

- **Topbar height:** 50px (`w1-standard-ui-demo.css` post-PR #94). Matches canon `kerf_wireframes_web_v2.html:88` exactly. **Locked.**
- **Demo W1 brand color:** `--kerf-w1-brand: #d4923a` is an exact match to canon `--kerf-amber: #D4923A`. **Locked.**
- **Demo W1 outer canvas:** `--kerf-w1-bg: #0a0d11` is an exact match to canon body background. **Locked.**
- **Demo W1 panel tokens:** `--kerf-w1-panel: #1a1f26` and `--kerf-w1-panel-raised: #232932` are exact matches to canon `--kerf-panel` and `--kerf-panel-2`. **Locked at the W1 shell scope.** (Note: the production `decision-card.css :root` versions are off-by-1 and need separate alignment per Gap 1's pattern.)
- **Container max-width:** 1600px on `.kerf-w1-demo-shell`. Matches canon `.wireframe-container`.
- **Font stack base:** `system-ui, -apple-system, "Segoe UI", Roboto, ...` — overlaps with canon's `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` enough that rendering is consistent on macOS / iOS / Windows. The Roboto entry is a no-op on Apple platforms (system-ui resolves first); harmless.
- **`box-sizing: border-box` reset** in `decision-card.css:43–46`. Standard, matches canon-implicit behavior.
- **Status / severity color logic:** confidence + severity sharing a palette is canon-correct (`notes.md` §"Status / state vocabulary"). Don't introduce a separate severity scale.

---

## 8. "Next CSS PR should do exactly this" checklist

In recommended landing order. Each item is scoped to be merge-ready as a small standalone PR; none requires component design or new markup unless flagged.

### Phase A — pure CSS, scoped to W1 shell (low risk)

- [ ] **Override `--kerf-accent` under `.kerf-w1-standard-ui`** to canon amber `#D4923A`. One-line CSS change. Resolves Gap 1 inside the W1 surface without changing production card behavior.
- [ ] **Drop body font-size to 13px** in two places: `w1-standard-ui-demo.css` `html:has(.kerf-w1-standard-ui) { font-size: 13px }` and `decision-card.css` body rule. Resolves Gap 4.
- [ ] **Recompute rem-based rules** that PR #94 introduced at 14px root: at 13px root, `0.6875rem` becomes `0.846rem` (11px label tier, Gap 7); `0.625rem` becomes `0.769rem` (10px micro tier).
- [ ] **Relax card padding** from PR #94's `0.78/0.9/0.85rem` to canon-equivalent flat `1.077rem` (14px) under `.kerf-w1-standard-ui`. Resolves Gap 8.
- [ ] **Widen action log rail** from `minmax(12.5rem, 15.5rem)` to `minmax(15rem, 20rem)`. Resolves Gap 9.
- [ ] **Cap proposal detail panel width** at `flex: 0 0 18rem` (≈ 234px on 13px root) instead of `22rem`. Restores queue-as-primary scan surface.

### Phase B — production-token alignment (medium risk; touches non-W1 surfaces)

- [ ] **`decision-card.css :root` token alignment** to canon hex values:
  - `--kerf-bg-app: #0A0D11` (was `#12151a`)
  - `--kerf-bg-card: #1A1F26` (was `#1a1f27`)
  - `--kerf-bg-elevated: #232932` (was `#222831`)
  - `--kerf-border: #2F3641` (was `#343c4a`) — Gap 5
  - `--kerf-fg: #E8E6E1` (was `#e8ecf1`) — Gap 6
  - `--kerf-fg-muted: #9097A1` (was `#9aa3b2`) — Gap 6
  - **Caveat:** these tokens leak to non-W1 surfaces (`decision-card-demo.html`, `decision-queue-demo.html`). Visual diff each demo before merging.
- [ ] **Add `--rh: #C9A876` and `--future: #7E6FCF` tokens** to `decision-card.css :root`. Reserved for Right Hand and blackboard surfaces; harmless if unused immediately.
- [ ] **Add `--kerf-text-mute: #5F6670`** to `decision-card.css :root` as the third text level canon defines but demo lacks.

### Phase C — first-viewport completeness (medium risk; needs design)

- [ ] **Add system status tile** to the topbar or above the queue: a small element answering "is anything wrong right now," tinted by `--success` / `--warn` / `--alert`. Resolves Gap 10's first half. Requires component decision.
- [ ] **Add Right Hand availability dot** to the topbar: 8×8 pseudo-element, `--rh` brass color, with green if Right Hand is online. Resolves Gap 10's second half. Lightweight; doesn't require a full Right Hand rail.

### Phase D — layout structural decision (high risk; needs IA decision before CSS)

- [ ] **Decide canon stance on PR #99's nav rail.** Three options: (a) compress to canon module-rail proportions (56px icon-only); (b) expand to canon cos-rail proportions (320px Right Hand surface); (c) document #99's hybrid as a known canon-vs-demo delta in `wireframes/README.md`. **Don't ship #99 to evidence screenshots without making this call.**
- [ ] If (b) chosen, add the missing module rail (56px) **as well**, so the demo matches canon's `56px · 320px · 1fr` triplet and not a hybrid `150px · 1fr · 250px`.

### Phase E — screenshot-capture conventions (zero CSS; documentation only)

- [ ] **Lock screenshot viewport at 1440×900** in `src/examples/evidence/2026-05-03-proposal-ff/screenshots/README.md`. Resolves the brief's "1280, 1440, or wider" question — canon answer is 1440. 1280 is too narrow for canon comparison.

---

## 9. Files inspected

**Canon (read-only):**
- `docs/wireframes/README.md` (full)
- `docs/wireframes/notes.md` (full)
- `docs/wireframes/kerf_wireframes_web_v2.html` (token + topbar + module-rail + cos-rail + .app grid sections)
- `docs/wireframes/kerf_wireframes_v5_1_apr26.html` (root tokens + body rule)

**Demo on `main`:**
- `src/examples/w1-decision-queue-demo.html` (head/tail, structural markup)
- `src/examples/w1-standard-ui-demo.css` (full, 489 lines)
- `src/ui/styles/decision-card.css` (root tokens + body + section h3/h4 rules)
- `src/ui/styles/decision-queue.css` (queue layout rules)

**In-flight:**
- PR #99 `feature/ca-w1-standard-ui-nav-rail` diff (CSS portion only — no test/HTML edits beyond the addition itself)

**Not modified by this audit:** none of the above. This document is the only file changed.

---

## 10. Provenance

- Audit performed against `main` HEAD `bd32a00` ("feat(ui): align W1 operator summary with canon (#98)").
- Canon SHAs as recorded in `docs/wireframes/README.md` table; not re-verified by this audit. To verify, run `shasum -a 256 docs/wireframes/*.html` and compare.
- This audit replaces no prior document; it is the first full demo↔canon fidelity gap audit committed to the repo.
- Last updated: 2026-05-03.

*— end audit —*
