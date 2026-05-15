# Cursor Agent Brief — Inline-Edit Scaffold Lines

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PRs:** #156 (kitchen scaffold), #159 (bath), #163 (outdoor kitchen), #164 (deck) — extends the pattern
- **Branch from:** `main` (latest)
- **Target branch:** `feature/v15-inline-edit-scaffold-lines`
- **Target test count after merge:** +12 to +18 tests
- **Estimated effort:** 3–4 hours

---

## 1. Working agreement preamble (required, do not skip)

You are operating inside the Kerf / Right Hand / Obraki architecture for the **GGR/Valle internal release** (30-day target). NOT generic SaaS, NOT multi-tenant, NOT public launch.

**Architecture invariants — non-negotiable:**

- Deterministic core; LLMs at edges only
- All LLM output untrusted; schema/business-rule validation before side effects
- No autonomous pricing authority
- No autonomous money movement; no external sends
- Money as integer cents
- Structured artifacts shared between agents (not giant prompts)

**Forbidden actions:** force push, hard reset, branch delete pre-merge, hook bypass, GPG bypass.

**Product framing:** *"Here is my working draft — refine it."* This brief implements the **refine** half of that framing.

---

## 2. Task summary

Add per-line inline-edit capability to the four scaffold surfaces (kitchen / bath / outdoor kitchen / deck). Operator clicks a scaffold line's quantity or material → an inline input appears → operator types override → "Save" or Esc-cancel. Saved overrides:

1. Replace the displayed value on the line
2. Show a small "operator-edited" pill (`refined`)
3. Carry override into all downstream renders (decision card, audit)
4. **Currently scoped to in-page state only.** Persistence wiring is a separate downstream brief (depends on persistence Steps 4+5).

This brief makes the UI editable. The persistence integration brief comes after persistence Step 4 (HTTP endpoints) lands.

---

## 3. The UX target

| Field | Editable | Validation |
|---|---|---|
| `quantity` | Yes — inline number input | `>= 0`; up to 1 decimal place |
| `materials_value` | Yes — inline text input | Non-empty when present; clears to null on empty |
| `quantity_assumption` | No | (system-emitted; never operator-edited) |
| `pricing_basis` | No | (system-emitted) |
| `range_low_cents` / `range_high_cents` | No | (KB-sourced; never operator-edited at the scaffold; operator overrides in the invoice surface later) |

**Critical:** This is a UI-layer override, not a money commitment. The architecture invariants stay locked. Inline-edit on quantity changes a display number; it does NOT commit to a price or autonomously recompute a total.

---

## 4. Files to modify

### 4.1 New module: `src/examples/v15-vertical-slice/v15-scaffold-edit-state.ts`

In-memory edit state for the active scaffold session. Reuses the sessionStorage pattern from F-33 → F-34 handoff but for scaffold overrides.

```typescript
export interface ScaffoldLineOverride {
  readonly line_id: string;
  readonly field: 'quantity' | 'materials_value';
  readonly before: unknown;
  readonly after: unknown;
  readonly edited_at: string; // ISO8601
}

const STORAGE_KEY = 'kerf_v15_scaffold_overrides_v1';

export function getScaffoldOverrides(scaffoldId: string): readonly ScaffoldLineOverride[];
export function setScaffoldOverride(scaffoldId: string, override: ScaffoldLineOverride): void;
export function clearScaffoldOverride(scaffoldId: string, line_id: string, field: string): void;
export function clearAllScaffoldOverrides(scaffoldId: string): void;
```

Implementation: sessionStorage-backed JSON dictionary keyed by `${scaffoldId}::${line_id}::${field}`.

### 4.2 Shared render helper: `src/examples/v15-vertical-slice/v15-scaffold-edit-render.ts`

Build the inline-edit HTML controls. Reuses the existing scaffold `.kerf-f35-scaffold__line` structure; replaces the quantity / material text spans with `<button>`-wrapped editable triggers.

```typescript
export function buildScaffoldLineWithEdits(
  line: KitchenScaffoldLine,
  scaffoldId: string,
  overrides: readonly ScaffoldLineOverride[],
): string;
```

Renders:
- `quantity` span as `<button data-kerf-v15-edit="quantity" data-kerf-v15-line-id="...">` — clicking swaps it for `<input type="number" step="0.1" min="0">`
- `materials_value` chip as `<button data-kerf-v15-edit="materials_value" data-kerf-v15-line-id="...">` when material is set, or a "+ add material" affordance when null
- A small `refined` pill next to the value when an override is active for that field

### 4.3 Wire into each scaffold-html module

`v15-kitchen-scaffold-html.ts` / `v15-bath-scaffold-html.ts` / `v15-outdoor-kitchen-scaffold-html.ts` / `v15-deck-scaffold-html.ts` — each one's `renderLine` function calls `buildScaffoldLineWithEdits` instead of inlining its own quantity/material rendering. **Minimal change per file; the substitution is one function call.**

### 4.4 Event delegation in `app.ts`

`onDocumentClick` handler grows a new branch:

```ts
const editBtn = t.closest('[data-kerf-v15-edit]');
if (editBtn instanceof HTMLButtonElement) {
  // swap the button for an input; save on blur/Enter; cancel on Esc
}
```

Similarly an `onDocumentInput` branch handles input value changes, and a `keydown` listener handles Enter/Esc.

### 4.5 CSS

Add to `f35-embed.css` (or a new dedicated file — keep small):

- `.kerf-f35-scaffold__refined-pill` — small green pill, like the existing material chip, but with a clear "refined by operator" label
- `.kerf-f35-scaffold__edit-input` — narrow inline input, matches the surrounding text size
- Hover state on `[data-kerf-v15-edit]` buttons signals editability (dotted underline or pencil cursor)

---

## 5. Tests

### 5.1 `tests/v15-scaffold-edit-state.test.ts` (~6 tests)

- `setScaffoldOverride` persists to sessionStorage; `getScaffoldOverrides` reads back
- Overriding the same `(scaffoldId, line_id, field)` twice keeps only the latest
- `clearScaffoldOverride` removes a specific override
- `clearAllScaffoldOverrides` clears for a specific scaffold; leaves others
- Empty sessionStorage returns `[]`
- Static guard: module imports no LLM / fetch / secrets

### 5.2 `tests/v15-scaffold-edit-render.test.ts` (~6 tests)

- Rendered HTML contains `data-kerf-v15-edit="quantity"` and `data-kerf-v15-edit="materials_value"` buttons
- When override exists for a line, the `refined` pill appears
- When override exists for `materials_value`, the new value shows; original from `materials_value` doesn't appear on screen
- When `materials_value` is null and no override, an "+ add material" affordance appears
- Quantity input has correct attributes (`type="number"`, `step="0.1"`, `min="0"`)
- Rendered HTML still passes the no-project-total invariant test from PR #156

---

## 6. Pre-push gate

```bash
npm run typecheck
npm run demo:v15-vertical-slice:esbuild
npm test                                # all tests pass
git diff --check
```

---

## 7. Scope-check before push

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/v15-scaffold-edit-*.ts
rg "process\.env\." src/examples/v15-vertical-slice/v15-scaffold-edit-*.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/examples/v15-vertical-slice/v15-scaffold-edit-*.ts
rg -i "groqChat|whisperTranscribe|openai|anthropic" src/examples/v15-vertical-slice/v15-scaffold-edit-*.ts
```

If `rg` isn't on PATH, note in PR description.

---

## 8. PR body template

```
feat(v15): inline-edit scaffold lines (quantity + materials override)

Adds operator-driven inline edit to the four scaffold surfaces (kitchen,
bath, outdoor kitchen, deck). Operator clicks a quantity or material →
inline input → saves to sessionStorage → renders with a "refined" pill.

Quantity overrides:
  - Number input, step 0.1, min 0
  - 1-decimal precision (matches scaffold formula output)
  - Replaces displayed value; underlying scaffold instantiation unchanged

Material overrides:
  - Text input
  - Empty value clears the override (material reverts to null)
  - "+ add material" affordance when scaffold emits null and no override

Persistence wiring is DEFERRED to a separate brief (depends on persistence
Step 4 HTTP endpoints — currently in design at PR #166). In-page state
via sessionStorage only for this PR.

Architecture invariants preserved 1:1:
  - Inline edit changes DISPLAY values only — no autonomous price/total
    commitment
  - Deterministic UI flow; no LLM
  - quantity_assumption / pricing_basis / range fields are NOT editable
  - Integer cents discipline unchanged (no money fields are edited here)
  - sessionStorage scope (cleared on tab close; no persistence yet)

Tests: ~12 new (6 edit-state + 6 edit-render).
Bundle: minor delta from new modules (~3-4kb).
```

---

## 9. What NOT to do

- ❌ Do not edit `quantity_assumption`, `pricing_basis`, or range fields. These are system-emitted; never operator-edited.
- ❌ Do not introduce a project total or rollup. Inline edits do not autonomously recompute totals.
- ❌ Do not wire to persistence yet. sessionStorage only this PR; the persistence Step 4 brief is separate.
- ❌ Do not change the scaffold instantiation logic. The override layer sits ON TOP of the existing scaffold output.
- ❌ Do not add LLM-driven "suggested values" or autocomplete.
- ❌ Do not break the existing scaffold render tests — modifications to `renderLine` should preserve all prior output structure.

---

## 10. Coordination notes

- **No file conflict with persistence work.** This brief touches `v15-scaffold-*.ts` + `app.ts` + CSS only. Persistence Steps 1-2 (PRs #165 and #166) are in `src/persistence/` and don't intersect.
- **Material matcher already on main.** No interaction needed.
- **Mobile responsive already on main.** Verify your inline-edit inputs work at 375px width during manual smoke; if they overflow, scope the responsive CSS into this PR.

---

## 11. Handoff back to integration lead

When CI is green, open the PR with the body above. Include in self-review summary:

- Confirmation that quantity/material edits do NOT affect any downstream total or money commitment
- Test count delta
- Whether you ran the §7 scope-check `rg` commands (note in PR if not)
- Mobile smoke result (375px viewport: does the inline input fit?)

Integration lead routes to ChatGPT + Codex (back May 16) for second-opinion review before merge.
