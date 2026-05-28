# Phase 1J · Agent B · F-E1 Capture Visual Fidelity

**Branch:** `phase-1j-b-f-e1-visual-fidelity`
**Base:** `origin/main @ 1008b16` (`docs(1j-a): normalize Agent A report naming`)
**Head:** `2f42308`
**Canon anchor:** `docs/wireframes/canon/F-E1_mobile_field_capture.html`
**Scope:** `/field-capture` visual layer only — port the canon F-E1 treatment onto the live surface. No event/API/state-machine changes.

---

## Mandate

> Make `/field-capture` visually match the F-E1 canon wireframe now that Agent A's
> shared token/phone-shell foundation is on main. Preserve Record-more-after-Done,
> Photo / Video, Submit to Daily Log, the Relay / Field Detail / Draft Review links,
> and the existing event/API wiring. Do not repaint with generic cards — port the
> canon F-E1 visual treatment.

Agent A established the shared canon `--kerf-*` tokens + theme cascade in
`src/app/styles/shell.css` and removed the page's wrong hand-rolled `:root`.
Agent B builds on that: the page now consumes the shared tokens and the body
markup + page `<style>` are brought up to the canon F-E1 visual treatment. No
local `:root` was reintroduced.

---

## What changed — `src/app/pages/field-capture.astro` (only file touched)

The page was already field-green/dark themed but used generic cards, text-only
buttons, and a CSS-circle record control. It now ports the canon structure and
look, state by state:

### State 1 · Pre-capture
- **Canon top-chrome** — eyebrow (`New capture` mode + `Back`), bold title
  *"What are you capturing?"*, and a meta line with the location-pin silhouette SVG.
- **"Capture goes to" assignment card** — canon `assign-card` with Client / Project /
  Location rows (key-uppercase, value-right), replacing the old `dl` block.
- **Daily Log anchor banner** — canon green-tinted background + left rule:
  *"Writes to Wegrzyn · today's Daily Log."* with the canon detail line.
- **88px field-green record button** with the canon ring (`::after`) and the mic
  silhouette SVG, replacing the 118px gradient CSS-circle.
- **Secondary capture** — canon `cap-secondary` two-up buttons with silhouette SVGs
  (camera, document) + label + sub: **Photo / Video** and **Type a note**.
- **Action ribbon** — canon bottom ribbon with a red `Cancel`.

### State 2 · Active capture
- **Canon top-chrome** — `Capturing · Wegrzyn / Kitchen` eyebrow + live item count.
- **Live record bar** — canon green-tinted bar: glowing dot, `RECORDING` label,
  tabular timer (`#f-e1-timer`), and a field-green `Stop` button with the stop-square SVG.
- **Typed-summary card** kept (with the required honest copy) above the captured list.
- **Captured items** — canon `cap-item` rows: 26px colored icon badge
  (voice = green / photo+video = blue / note = amber), title + sub, timestamp meta,
  and a **working remove** affordance (the canon `×`) that splices the item and its
  backing photo/video/audio ref.
- **Action ribbon** — `Record more` · `Photo / Video` · primary `Done capturing`,
  each with its silhouette SVG.

### State 3 · Pre-flight + submit
- **Canon top-chrome** + `‹ Back`.
- **Pre-flight summary card** — canon gradient `preflight-card` with eyebrow / title / meta.
- **Capture readout** (`#f-e1-readout-list`) kept for the honest media/transcript breakdown
  + the amber not-transcribed warning.
- **Draft-intent picker** — canon `di-option` radio cards (green selected state via
  `:has(input:checked)`, filled radio dot). **The three real `entry_kind` options and
  values are unchanged** (`change_signal` / `progress_update` / `blocker`) — only the
  visual treatment is canon. The radios remain native inputs (a11y + form wiring intact).
- **Final transcript** — canon `final-transcript` with the blue pencil `Edit` affordance
  and the canon transcript hint (honestly reworded: *"This is not a live transcript…"*).
- **Photo grid mini** — canon 4-col `photo-tile-mini` tiles (image / video glyph) plus a
  dashed **add** tile wired to the camera input (no dead tile).
- **AI disclosure** — canon §13 gold-left-rule note: *"AI-assisted by Kerf Right Hand…"* (added; was absent before).
- **Action ribbon** — `Back` + primary `Submit to Daily Log` (label flips to
  `Submit media only` via an `.ar-label` span so the icon survives the swap).

### Submit outcome (unchanged behavior, canon-skinned)
- Status line, play-error block, **Open Relay** link, and the loop nav
  (**Transcript review** · **Draft Review** preview · **Field detail**) are preserved
  with their IDs, hrefs, and reveal logic intact.

---

## Preservation checklist (all required behavior kept)

| Required | Status |
|---|---|
| Record more after Done capturing (`#f-e1-record-more` in State 3) | ✅ kept |
| Photo / Video (`accept="image/*,video/*"`, video branch + `videos.push`) | ✅ kept |
| Submit to Daily Log (`POST /api/v1/projects/:id/daily-log/entries`) | ✅ kept |
| Relay / Field Detail / Draft Review links | ✅ kept |
| Existing event/API wiring (`daily_log.entry_captured`, transcribe, submit outcome) | ✅ kept |
| Required copy tokens (Typed summary · not transcribed yet · Submit media only · Saved to Daily Log as media-only · Right Hand flagged…) | ✅ kept |

### JS changes (visual-rendering only, wiring intact)
- `renderCaptured()` now emits the canon `cap-item` shape (icon badge + body + meta + remove).
- Captured items carry `kind` + `time` + a media `ref`; `removeCapturedItem()` keeps the
  `photos` / `videos` / `audioUri` arrays in sync (honest remove, no orphan payload).
- Transcribe status now updates the voice item **by object identity** (was by index),
  which is removal-safe and otherwise identical.
- Photo grid renders canon tiles + a functional add tile.
- Submit-label swap targets the `.ar-label` span so the arrow icon is preserved.
- The submit payload, endpoint, headers, `entry_kind` values, and outcome handling are byte-for-byte unchanged.

---

## Verification — clean worktree

Verified from a **fresh `git worktree` detached at the pushed commit `2f42308`**
(not the local workspace), with a clean `npm ci`.

```
worktree HEAD: 2f42308

npm run typecheck    → tsc --noEmit · no errors
npm run build:astro  → ✓ server built · prerender complete
node --import tsx --test \
  tests/phase1g-f-e1-capture-clarity.test.ts \
  tests/phase1e-field-capture-submit.test.ts \
  tests/phase1g-c-plain-language.test.ts \
  tests/route-shell-smoke.test.ts
    → 8/8 pass (truthful capture copy · controls through preflight ·
                 submit wiring · "untouched by 1G-C lane" · route shell 13 paths)

Full suite (npm test): tests 1480 · pass 1477 · fail 3
```

### The 3 failures are pre-existing and unrelated

All 3 failures live in `tests/v15-vertical-slice-pages.test.ts` and
`tests/v15-vertical-slice-8010-http-smoke.test.ts`. They read
`src/examples/v15-vertical-slice/app.bundle.js` — a **generated artifact not tracked
in git** — and assert a JS content-type from a route the static build serves as
`text/html`. Both are environmental, predate this branch, and are the **same failures
Agent A documented** in `phase-1j-a-tokens-phone-shell_report.md`. They are unrelated to
a field-capture visual port (this branch touches one file: `field-capture.astro`).

---

## Notes for downstream

- **One file changed.** No shared component, token, route, or API was modified — the
  canon skin came entirely from Agent A's `shell.css`; this branch only consumes it.
- **No stacking required.** This branch can merge independently onto main; it does not
  depend on other Phase 1J lanes beyond Agent A's foundation (already on main).
- **Spanish-locale capture UI** remains deferred (V2.1) per canon; copy here is English-only.
- The draft-intent labels intentionally reflect the **real** `entry_kind` contract rather
  than the canon's aspirational CO/estimate/Daily-Log-only wording, to keep the surface honest
  to what the system actually does. Visual fidelity = the radio-card treatment.

---

*Agent B · Phase 1J · F-E1 canon visual treatment ported. Not merged — pushed for review.*
