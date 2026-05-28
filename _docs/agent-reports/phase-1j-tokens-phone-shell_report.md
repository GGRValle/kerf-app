# Phase 1J · Agent 0 · Shared Token + Phone-Shell Foundation

**Branch:** `phase-1j-tokens-phone-shell`
**Base:** `origin/main @ cbba6cf` (`docs(wireframes): lock theme behavior — system default + Settings-only toggle`)
**Head:** `61d1bd3`
**Scope:** Shared skin only — tokens + phone-shell chrome. **No per-page repaint.**

---

## Mandate

> Shared token + phone shell foundation only. Extract tokens verbatim from
> `docs/wireframes/canon/F-E1_mobile_field_capture.html`, remap the generic shell
> styling onto canon `--kerf-*` tokens, preserve existing routes/buttons/events.
> Do not repaint pages individually. Fix the shared skin first.

This matches the Phase 1J fix shape already recorded in `docs/wireframes/CATALOG.md`
(steps 1–3): put the full canon `:root` + theme cascade into the shared layer,
remap the generic vocabulary onto `--kerf-*`, and delete the wrong hand-rolled
`:root` from `field-capture.astro` so it inherits the shared canon. (Step 4 —
wiring the Settings light/dark/System toggle — is a separate Settings-page concern
and is **out of scope** for this agent; the cascade it depends on is now in place.)

---

## What changed

### 1. `src/app/styles/shell.css` — the shared skin

- **Canon tokens, verbatim.** The full 17-token canon palette is now defined in
  `:root`, copied exactly from `F-E1_mobile_field_capture.html`:
  `--kerf-bg #0A0D11 · --kerf-bg-2 #14181F · --kerf-surface #1A1F28 ·
  --kerf-surface-2 #232936 · --kerf-border #2A3140 · --kerf-border-soft #1F2530 ·
  --kerf-text #E8ECF1 · --kerf-text-dim #98A1B3 · --kerf-text-mute #6A7282 ·
  --kerf-amber #F5B544 · --kerf-green #4ADE80 · --kerf-red #F87171 ·
  --kerf-blue #7BA8FF · --kerf-violet #A78BFA · --kerf-magenta #E879A8 ·
  --field-green #38C977 · --right-hand #C9A961`.
- **Generic vocabulary remapped onto canon** (so every existing consumer inherits
  the canon skin with zero per-page edits):
  | generic token | → canon |
  |---|---|
  | `--bg` | `--kerf-bg` |
  | `--surface` | `--kerf-surface` |
  | `--text` | `--kerf-text` |
  | `--text-muted` | `--kerf-text-dim` *(dim, not mute — readability on dark bg)* |
  | `--border` | `--kerf-border` |
  | `--accent` | `--kerf-amber` |
  | `--chip-red` | `--kerf-red` |
  | `--chip-amber` | `--kerf-amber` |
  | `--chip-green` | `--kerf-green` |
  | `--chip-cyan` | `--kerf-blue` |
  | `--chip-neutral` | `--kerf-text-mute` |
- **Theme cascade (LOCKED, Christian 2026-05-28).** Implemented the three-tier
  cascade from `CATALOG.md` in the shared layer:
  - `:root` = canon **dark** base.
  - `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` —
    light bg/surface/border/text **only when the user has not chosen** a theme.
  - `:root[data-theme="light"]` / `:root[data-theme="dark"]` — explicit choice wins.
  - Light values are verbatim from `F-E1 body.light-mode`. **Accents stay constant
    across themes** — only bg/surface/border/text flip.
- **Active-nav chrome** no longer blends against hardcoded `white` / a teal
  box-shadow; it now uses `color-mix(... --accent ..., transparent)` so it reads
  correctly on the canon dark surface in either theme.
- **Compatibility aliases.** `--kerf-line → --kerf-border-soft` and
  `--kerf-muted → --kerf-text-mute` are defined in the shared root so the legacy
  names still used inside `field-capture.astro` resolve after its local `:root`
  is removed — keeps this a token-layer change, not a body repaint.

### 2. Phone-shell chrome onto canon

- **`MobileBottomNav.astro`** — replaced hardcoded `#fff` / `#ddd` with
  `--kerf-bg-2` background + `--kerf-border` top border; link copy on
  `--kerf-text-mute`, active item on `--kerf-amber`.
- **`SpeakFAB.astro`** — recolored from `--accent` (was teal) to `--right-hand`
  gold with dark glyph + canon drop-shadow. Canon: the Speak button is the
  Right Hand surface. Route (`/field-capture`), label, and event are unchanged.

### 3. `field-capture.astro` — inherit the shared canon

- Removed the wrong hand-rolled `:root` (it set `--kerf-bg: #070b0f` — not canon
  `#0A0D11` — and used `--kerf-surface-2` which it never defined). The page now
  inherits the shared canon tokens. All body markup, scripts, routes, buttons,
  and events are untouched.

**Routes, buttons, and events: unchanged across all four files.**

---

## Verification — clean worktree

Verified from a **fresh `git worktree` at the pushed commit** (`61d1bd3`), not the
local workspace, with a clean `npm ci`.

```
worktree HEAD: 61d1bd3f48c0ff4bfd84a3f53eed228bfe847082

npm run typecheck   → tsc --noEmit, no errors
npm run build:astro → ✓ server + client built, prerender complete
node --import tsx --test tests/route-shell-smoke.test.ts \
                        tests/phase1g-f-e1-capture-clarity.test.ts
  ✔ 3/3 pass (route shell serves all 13 legacy paths without 5xx;
              F-E1 truthful capture copy; capture controls through preflight)

Full suite (excluding tests/v15-vertical-slice-pages.test.ts):
  ℹ tests 1459 · pass 1459 · fail 0
```

### Known pre-existing failure (not introduced here)

`tests/v15-vertical-slice-pages.test.ts` fails on a fresh checkout because it
reads `src/examples/v15-vertical-slice/app.bundle.js` — a **generated artifact
that is not tracked in git** (`git ls-files` confirms no bundle is committed) —
and asserts a JS content-type from a route the static build serves as `text/html`.
Both failures are environmental and predate this branch; they are unrelated to a
CSS token remap and were not caused by these changes.

---

## Notes for downstream Phase 1J agents

- **Persona-accent theming** (CATALOG step 2 — Owner/RH amber, Field green,
  etc.) is intentionally **not** done here; the foundation maps the single generic
  `--accent` to amber. Per-role accent assignment is a follow-up.
- **Settings toggle wiring** (CATALOG step 4) is out of scope for Agent 0. The
  `data-theme` cascade it must drive is now live; the Settings page only needs to
  write `data-theme="light|dark"` to `<html>` (and remove it for "System").
- Pages should keep consuming the shared tokens; **do not reintroduce local
  `:root` blocks**. If a page needs a canon color, use the shared `--kerf-*` name.

---

*Agent 0 · Phase 1J · shared skin established. Not merged — pushed for review.*
