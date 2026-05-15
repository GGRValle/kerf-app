# Cursor Agent Brief — Mobile Validation Harness

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PR:** #162 (mobile responsive baseline)
- **Branch from:** `main` (latest)
- **Target branch:** `feature/v15-mobile-validation-harness`
- **Target test count after merge:** +3 to +6
- **Estimated effort:** 2–3 hours

---

## 1. Working agreement preamble (required, do not skip)

You are operating inside the Kerf / Right Hand / Obraki architecture for the **GGR/Valle internal release** (30-day target).

**Architecture invariants — non-negotiable:**

- Deterministic core; LLMs at edges only
- Money as integer cents
- Structured artifacts shared between agents (not giant prompts)

**Forbidden actions:** force push, hard reset, branch delete pre-merge, hook bypass, GPG bypass.

**UI posture per the 30-day brief:**
> "The UI MUST work on: laptop, phone. Wireframes already exist. The task is primarily: wiring operational flows, binding real state/data, connecting artifacts, ensuring responsive usability. Do NOT redesign the product visually unless explicitly asked."

PR #162 shipped the CSS baseline. This brief builds a **validation harness** — a way to exercise + smoke the V1.5 surfaces at phone widths WITHOUT requiring a real device.

---

## 2. Task summary

Build a small HTML route at `/m/check` (or `/m`) that:

1. Embeds the V1.5 surfaces in viewport-locked iframes at 375px (iPhone SE narrow) and 414px (iPhone Pro Max) widths
2. Side-by-side comparison renders for the four key routes: `/dashboard`, `/field-capture`, `/transcript-review`, `/draft-review`
3. Reports any overflow / scroll / touch-target issues that can be detected DOM-side (e.g., elements exceeding viewport width)
4. Lets the integration lead (or you, Christian) screenshot or visually verify at typical phone widths without DevTools fiddling

**This is a development utility, not an operator surface.** Lives at a separate route; not in the V1.5 nav.

---

## 3. The harness

### 3.1 New file: `src/examples/v15-vertical-slice/m-validation-harness.ts`

```ts
export function buildMobileValidationHarnessHtml(): string {
  // Returns an HTML page with side-by-side iframes:
  // - 375px iframe: cycles through /dashboard, /field-capture, etc. via a tabbed selector
  // - 414px iframe: same, in parallel
  // - DOM probe: post-message from each iframe with overflow detection results
}
```

### 3.2 Router entry

Add a `/m/check` (or `/m-validation`) route that renders this harness page. Reuse the existing serve script's static + SPA-fallback machinery; the harness is just HTML+JS.

### 3.3 DOM overflow detection

Each iframe's loaded page runs a tiny inline script that reports:

- Any element whose `scrollWidth > clientWidth` (horizontal overflow)
- Any interactive element (`button`, `a`, `input[type="button"]`, etc.) with bounding rect < 44×44px
- The maximum scrollLeft of `document.documentElement` (any unintended horizontal scroll)

The harness page collects these via `postMessage` and displays a results panel below the iframes.

### 3.4 Visual diff (out of scope for this PR — flag as follow-up)

Don't pull in pixel-diff or a headless browser dependency. The harness is for human visual review + DOM-probe; pixel-level regression is a separate post-V1.5 task.

---

## 4. Optional: programmatic smoke test

If you have time, add `tests/v15-mobile-harness-smoke.test.ts` that:

1. Spawns the serve script (same pattern as `tests/v15-vertical-slice-8010-http-smoke.test.ts`)
2. Fetches `/m/check`; asserts 200 + HTML
3. Fetches each iframe target URL (`/dashboard?width=375`, etc.) and asserts 200

These are HTTP-route smokes, not real visual checks. Confirms the harness page loads and that the V1.5 routes still serve cleanly when the harness embeds them.

---

## 5. Pre-push gate

```bash
npm run typecheck
npm run demo:v15-vertical-slice:esbuild
npm test
git diff --check
```

---

## 6. Scope-check

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/m-validation-harness.ts
rg "process\.env\.(SECRET|API_KEY)" src/examples/v15-vertical-slice/m-validation-harness.ts
rg -i "groqChat|whisperTranscribe|openai|anthropic" src/examples/v15-vertical-slice/m-validation-harness.ts
```

---

## 7. What NOT to do

- ❌ Do not add Puppeteer / Playwright / Cypress. The harness is HTML/JS only.
- ❌ Do not add a CSS framework. Plain CSS.
- ❌ Do not test on real iOS / Android devices in this PR. Visual on the harness is enough.
- ❌ Do not change desktop layout or any production routes. The harness is additive.
- ❌ Do not add the harness to the V1.5 nav. Operator should never see this; integration lead only.
- ❌ Do not add a "pass/fail" grade. The harness reports detected issues; humans interpret.
- ❌ Do not introduce viewport-shifting CSS tricks (e.g., zoom). Use real iframe widths.

---

## 8. PR body template

```
feat(v15): mobile validation harness for V1.5 vertical slice

Adds /m/check route with side-by-side iframes at 375px and 414px widths
exercising /dashboard, /field-capture, /transcript-review, /draft-review.
DOM-probe overflow detection + touch-target audit reported in a panel
below the iframes.

Development utility only — not in V1.5 nav; not an operator surface.
Used by integration lead (and Christian) to verify mobile baseline
without DevTools fiddling.

Confirms PR #162's CSS baseline holds for the V1.5 surfaces at phone
widths.

No new dependencies; HTML + tiny inline JS only. Real iOS/Android
testing remains a manual step on Christian's actual phone.
```

---

## 9. Handoff back to integration lead

When CI is green:
1. Open PR with the body above
2. Include 1-2 screenshots of the harness rendered at full width (so integration lead sees what they're getting)
3. Note any V1.5 routes that showed overflow / touch-target failures — these become follow-up items
4. Integration lead reviews + merges; the harness lives forever as a dev tool

ChatGPT review acceptable; this is small + low-architectural-surface; Codex review not required.
