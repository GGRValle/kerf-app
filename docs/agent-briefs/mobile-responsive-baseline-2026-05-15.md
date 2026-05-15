# Cursor Agent Brief — Mobile-Responsive Baseline

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PRs:** #156 (kitchen scaffold), #159 (bath scaffold) — the surfaces this PR makes phone-usable
- **Branch from:** `main` (latest, `f9b52b3` or newer)
- **Target branch:** `feature/v15-mobile-responsive-baseline`
- **Target test count after merge:** ~745–755 (small delta; CSS-heavy, few new tests)
- **Estimated effort:** 4–6 hours

---

## 1. Working agreement preamble (required, do not skip)

You are operating inside the Kerf / Right Hand / Obraki architecture for the **GGR/Valle internal release** (30-day target).

**Architecture invariants — non-negotiable:**

- Deterministic core; LLMs at edges only
- All LLM output untrusted; schema/business-rule validation before side effects
- No autonomous pricing authority
- No autonomous money movement; no external sends
- Money as integer cents

**Forbidden actions:** force push, hard reset, branch delete pre-merge, hook bypass, GPG bypass.

**UI posture per the 30-day brief (verbatim):**
> "The UI MUST work on: laptop, phone. Wireframes already exist. The task is primarily: wiring operational flows, binding real state/data, connecting artifacts, ensuring responsive usability. Do NOT redesign the product visually unless explicitly asked."

This PR is the **baseline mobile-responsive pass** — make existing surfaces usable on phone, do not redesign.

---

## 2. Task summary

CSS-only changes to make the V1.5 vertical slice surfaces phone-usable. Three target surfaces:

1. **F-33** (`/field-capture`) — Record button, photo capture, project picker, mode toggles
2. **F-34** (`/transcript-review`) — Two-column desktop layout (transcript main + clarifications rail) should stack on mobile
3. **F-35** (`/draft-review`) — Scaffold section + scope-line list should stack cleanly

Plus the V1.5 shell (header, nav toggle).

No logic changes. No new modules. Pure CSS.

---

## 3. Approach

Mobile-first augmentation (NOT mobile-first rewrite). Existing CSS is desktop-anchored; add `@media (max-width: 720px)` breakpoint blocks at the end of each stylesheet to override layout where needed. Keep desktop layout unchanged.

**Recommended breakpoint:** `720px` (matches the existing `@media (max-width: 720px)` block in `src/examples/v15-vertical-slice/app.css` that already handles the nav-toggle behavior).

---

## 4. Files to modify

### 4.1 `src/examples/v15-vertical-slice/app.css`

Existing nav-toggle responsiveness is already there. Audit + extend:

- F-33 capture page (`.kerf-fc-*`): cards stack full-width, mode chips wrap, photo grid → 2 columns on phone, voice card layout adapts
- F-34 review rail (`.kerf-f34-mi-*`, `.kerf-f34-rail`): on mobile, the rail moves BELOW the main transcript (currently side-by-side via grid)
- V1.5 shell (`.kerf-v15-shell`, `.kerf-v15-header`): existing breakpoint already partially handles this — extend if anything overflows on phone widths

### 4.2 `src/examples/v15-vertical-slice/f35-embed.css`

F-35 scaffold + scope-line layout:
- `.kerf-f35-line__head` (currently flex with description + amount side-by-side): stack on mobile when the description is long
- `.kerf-f35-scaffold__line-head`: same stacking pattern
- `.kerf-f35-scaffold__meta` (provenance pills): wrap on mobile (already flex-wrap, confirm)
- `.kerf-f35-section`: full-width padding adjustments

### 4.3 `src/examples/v15-vertical-slice/f33-embed.css`

F-33 photo grid + voice card:
- Photo thumbnails should reflow to a single column or 2-column grid on phone (instead of fixed desktop grid)
- Voice card controls should stack (record button + status + transcript text area)

### 4.4 `src/examples/v15-vertical-slice/f37-embed.css`

F-37 audit view:
- Timeline items stack
- Long source-ref URIs wrap (currently overflow on phone)

---

## 5. Specific layout targets (the "must work on phone" checklist)

Test each manually by resizing the browser window to **375px width** (iPhone SE narrow case) and **414px width** (iPhone Pro Max). On both:

| Surface | Must work |
|---|---|
| `/dashboard` | Header + nav fit; no horizontal scroll |
| `/field-capture` | Record button tappable (44×44px min touch target); project picker doesn't overflow; mode chips wrap; photo thumbs fit 2-up |
| `/transcript-review` | Transcript panel + clarification cards stack vertically; severity chips don't overflow; textareas resize to viewport |
| `/draft-review` | Scaffold section renders cleanly; each scaffold line card readable; scope-line list below also stacks |
| `/decisions/<id>` | Decision card content fits; CTAs tappable |
| `/audit/<id>` | Timeline items stack; ref URIs wrap (no horizontal scroll) |
| Header nav | Hamburger toggle works (already in place per `app.css` `@media (max-width: 720px)`); items reachable |

---

## 6. Constraints

- **No new HTML structure.** CSS-only changes. If something fundamentally needs DOM reshuffling to be phone-usable, flag in the PR body — don't restructure HTML in this PR.
- **No new CSS framework dependencies.** No Tailwind, no Bootstrap, no Material UI. Plain CSS (the repo's existing convention).
- **No JavaScript changes.** Touch targets and visual layout only.
- **Preserve desktop layout exactly.** All changes go inside `@media (max-width: 720px)` blocks at the END of each stylesheet. Desktop pixel-by-pixel unchanged.
- **44×44px touch target minimum** for all interactive elements (Apple HIG / WCAG 2.1 AA). Audit Record button, mode chips, primary CTAs.
- **No new color palette decisions.** Reuse existing `--kerf-*` tokens.

---

## 7. Tests

Add a small visual regression smoke test in `tests/v15-mobile-responsive-baseline.test.ts`:

```ts
test('app.css contains a @media max-width: 720px block at end-of-file', () => {
  const css = readFileSync(new URL('../src/examples/v15-vertical-slice/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*720px\s*\)/);
});

test('f35-embed.css contains a @media max-width: 720px block', () => {
  // similar
});

test('f33-embed.css contains a @media max-width: 720px block', () => {
  // similar
});

test('Record button (.kerf-fc-voice-btn) has min-height: 44px or larger on mobile', () => {
  const css = readFileSync(new URL('../src/examples/v15-vertical-slice/app.css', import.meta.url), 'utf8');
  // Match the mobile-scope rule that sets min-height >= 44px
  assert.match(css, /\.kerf-fc-voice-btn\s*\{[^}]*min-height\s*:\s*(?:44|48|56)px/s);
});
```

Pattern-only tests (not pixel-perfect regression). Goal: lock the breakpoint exists + the touch target is sized correctly. The actual visual quality is verified manually by the integration lead in browser DevTools.

**Manual smoke required in PR description:**
- Browser DevTools → Toggle device toolbar → iPhone SE
- Walk through all six routes; confirm no horizontal scroll, all CTAs tappable, all text legible
- Same on iPhone Pro Max width
- Paste a brief "what I tested" note in the PR body

---

## 8. Pre-push gate

```bash
npm run typecheck                              # CSS-only changes shouldn't affect, but confirm
npm run demo:v15-vertical-slice:esbuild       # bundle still builds (no JS imports)
npm test                                       # tests pass; count ~745–755
git diff --check
```

---

## 9. Scope-check before push

```bash
# No new HTML in .ts files
git diff main --stat -- 'src/**/*.ts' 'tests/**/*.ts'  # should be empty or test-only

# No JS framework dependencies snuck in
rg "from ['\"]tailwind|from ['\"]bootstrap|from ['\"]@mui" src/examples/v15-vertical-slice/
```

---

## 10. PR body template

```
feat(v15): mobile-responsive baseline for V1.5 vertical slice

CSS-only baseline pass to make F-33 / F-34 / F-35 / decisions / audit
phone-usable. No HTML structure changes; no JS changes; desktop layout
preserved pixel-for-pixel.

Approach: @media (max-width: 720px) blocks appended to each stylesheet,
overriding layout where needed:

- F-33: cards stack full-width, mode chips wrap, photo grid 2-up
- F-34: transcript + clarification rail stack vertically
- F-35: scaffold lines + scope-line list stack; provenance pills wrap
- F-37: timeline stacks; long source-ref URIs wrap
- V1.5 shell: existing nav-toggle responsiveness extended

Touch targets confirmed at 44×44px minimum (WCAG 2.1 AA / Apple HIG)
for Record button, mode chips, primary CTAs.

Manual smoke at iPhone SE (375px) and iPhone Pro Max (414px) widths:
[paste what was tested]

Tests: pattern-only locks the @media breakpoint + touch-target sizing
(no pixel-perfect regression). Visual quality verified manually.
```

---

## 11. What NOT to do

- ❌ Do not change desktop layout. Every change goes inside a mobile `@media` block.
- ❌ Do not introduce a CSS framework (Tailwind, Bootstrap, etc.).
- ❌ Do not change HTML / TSX. If DOM restructuring is needed, flag in PR body — don't restructure in this PR.
- ❌ Do not add JavaScript / state for responsive behavior. Pure CSS.
- ❌ Do not change `--kerf-*` design tokens.
- ❌ Do not change touch-target sizes for desktop (keep desktop hover/click ergonomics; only enforce 44px on mobile).
- ❌ Do not add a hamburger menu or new navigation pattern — the existing nav-toggle already handles that at 720px breakpoint.
- ❌ Do not optimize for tablet (768px–1024px) in this PR. iPhone-width is the priority; tablet is a future polish PR.

---

## 12. Coordination notes

- **No file conflict with any other Week-1 PR.** Bath, outdoor kitchen, deck, material matcher all touch source code; this PR touches CSS only.
- **Can land before or after any of the archetype scaffold PRs.** When new archetypes land, they reuse the same scaffold CSS that this PR makes phone-friendly; everything benefits automatically.

---

## 13. Handoff back to integration lead

When CI is green:
1. Open the PR with the body above
2. Self-review summary covering:
   - Which surfaces you tested at which widths
   - Any DOM restructuring needs you flagged
   - Touch-target audit results (Record button, mode chips, primary CTAs)
3. Include a screenshot or two if possible (phone-width screenshot of F-33 + F-35)

Integration lead routes to ChatGPT for review (CSS work is low-second-opinion-bar; ChatGPT can review the responsive behavior fine). Codex back May 16 for any harder follow-ups.
