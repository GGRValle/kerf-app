# Cursor Agent Brief — Bath Archetype Scope Scaffold

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-14
- **Reference PR:** #156 (kitchen scope scaffold MVP — mirror this pattern)
- **Branch from:** `main` at HEAD `b3cb2d5` or later
- **Target branch:** `feature/v15-bath-scope-scaffold`
- **Target test count after merge:** 740–750 (was 715 at #156 merge)

---

## 1. Working agreement preamble (required, do not skip)

You are operating inside the Kerf / Right Hand / Obraki architecture for the **GGR/Valle internal release** (30-day target). This is NOT a generic SaaS build, NOT a multi-tenant architecture effort, NOT a public launch sprint.

**Architecture invariants — non-negotiable:**

- Deterministic core; LLMs at edges only
- All LLM output untrusted; schema/business-rule validation before side effects
- No autonomous pricing authority
- No autonomous money movement; no external sends
- `system_final_*` authoritative; `model_suggested_*` audit-only
- Money as integer cents
- Structured artifacts shared between agents (not giant prompts)

**Forbidden actions:** force push, hard reset, branch delete pre-merge, hook bypass, GPG bypass.

**Product framing:** *"Here is my working draft — refine it."* Not "fill out this form." Already proven on PR #156's kitchen scaffold; mirror it exactly for bath.

---

## 2. Task summary

Build a **bath archetype scope scaffold** that mirrors PR #156's kitchen pattern. Three new files + one wire-in into `pages.ts`. Deterministic detection (regex + arithmetic; no LLM). Per-line provenance. Working-draft framing. No project total.

---

## 3. Three files to create

### 3.1 `src/examples/v15-vertical-slice/v15-bath-archetype.ts`

Mirror `v15-kitchen-archetype.ts` shape exactly.

```ts
export type BathSubtype = 'powder' | 'half_bath' | 'full_bath' | 'primary_bath';

export interface BathDimensions {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly floor_sf: number;
  readonly perimeter_ft: number;
  readonly ceiling_height_ft: number | null;
  readonly raw_match: string;
}

export interface BathMaterials {
  readonly floor: string | null;          // "tile" | "LVP" | "heated tile" | "marble"
  readonly shower_walls: string | null;   // "tile" | "acrylic surround" | "glass enclosure"
  readonly shower_floor: string | null;   // "tile" | "pebble" | "solid surface"
  readonly vanity: string | null;         // "white oak" | "shaker" | "floating" | "wall-mount"
  readonly counters: string | null;       // "quartz" | "marble" | "quartzite" | "granite"
  readonly fixtures_finish: string | null;// "chrome" | "brushed nickel" | "matte black" | "brass" | "polished nickel"
}

export interface BathArchetypeDetection {
  readonly archetype: 'bath_remodel';
  readonly subtype: BathSubtype;
  readonly dimensions: BathDimensions | null;
  readonly materials: BathMaterials;
  readonly source_fragments: readonly string[];
}

export function detectBathArchetype(text: string): BathArchetypeDetection | null;
```

**Detection rules:**

- Trigger: `\b(bath|bathroom|powder room|half bath|primary bath|master bath|en[- ]suite)\b` (case-insensitive)
- Subtype heuristic (more specific first):
  - "powder room" / `\bpowder\b` → `powder`
  - "half bath" → `half_bath`
  - "primary bath" / "master bath" / "primary suite" / "en-suite" / "ensuite" → `primary_bath`
  - default → `full_bath`
- Dimensions: same parsing pattern as kitchen (`DIMENSION_PATTERN`); sanity bounds: **3 ft minimum, 20 ft maximum per side, <250 SF total floor**
- Ceiling: same as kitchen (digits or spoken "eight/nine/ten foot"), scoped within 60 chars of "ceiling"
- Materials: pattern-based (more specific first); patterns suggested:
  - `floor`: `\bheated tile\b`, `\bceramic tile\b`, `\bporcelain tile\b`, `\bmarble tile\b`, `\bLVP\b`, `\bvinyl plank\b`, `\btile floor\b`
  - `shower_walls`: `\bglass enclosure\b`, `\bacrylic surround\b`, `\bmosaic tile\b`, `\bporcelain tile\b`, `\bceramic tile\b`, `\btile (walls?|shower)\b`, `\bmarble tile\b`
  - `vanity`: `\bfloating vanity\b`, `\bwall[- ]mount(?:ed)? vanity\b`, `\bdouble vanity\b`, `\bwhite oak vanity\b`, `\bshaker vanity\b`
  - `counters`: same as kitchen (`quartzite`, `quartz`, `marble`, `granite`, `solid surface`)
  - `fixtures_finish`: `\bmatte black\b`, `\bbrushed nickel\b`, `\bpolished nickel\b`, `\bbrushed brass\b`, `\bchrome\b`, `\bbrass\b`

### 3.2 `src/examples/v15-vertical-slice/v15-bath-scaffold.ts`

Mirror `v15-kitchen-scaffold.ts` exactly. **Reuse the same enum types** (`KitchenScaffoldQuantityBasis` etc.) — import them directly; do not generalize into a shared abstract type. Direct duplication is correct per the "no over-abstraction" rule from the 30-day brief.

**Slot list — 11 slots (waterproofing is mandatory for any subtype with a shower; renders 0 SF for powder/half but stays visible):**

| slot_id | scope_label | UoM | Quantity formula | Material slot |
|---|---|---|---|---|
| `demo` | Bathroom demolition | SF | `floor_sf` | none |
| `framing_adj` | Framing adjustments | LF | estimator_default: 0 (refine if walls move) | none |
| `plumbing_rough` | Plumbing rough-in (supply + DWV) | EA | powder=2, half=2, full=3, primary=4 | none |
| `electrical` | Electrical (GFCI, lighting, exhaust fan) | EA | powder=3, half=3, full=5, primary=6 | none |
| `drywall_paint` | Drywall + paint | SF | `perimeter × ceiling_height + floor_sf` (ceiling height defaults to 8 ft when missing) | none |
| **`waterproofing`** | **Shower waterproofing (membrane, pan, curb)** | **SF** | **powder=0, half=0, full=60, primary=100** | none |
| `shower_install` | Shower / tub install (pan / surround / valve) | EA | powder=0, half=0, full=1, primary=2 | none |
| `shower_walls` | Shower wall tile / surround surface | SF | powder=0, half=0, full=50, primary=80 | `shower_walls` |
| `floor` | Floor tile / LVP | SF | `floor_sf` | `floor` |
| `vanity_install` | Vanity install + counter | EA | powder=1, half=1, full=1, primary=2 | `vanity` |
| `fixtures_trim` | Fixtures + trim (faucet, toilet, accessories) | EA | matches `plumbing_rough` count | `fixtures_finish` |

**Critical waterproofing detail (per Christian, 2026-05-14):**
Shower waterproofing is non-negotiable in any remodel that touches a shower. Pre-slope + pan liner / sheet membrane (Schluter Kerdi, RedGard, Hydro Ban, etc.) + curb + wall-floor transitions. Quantity sums shower wall area + pan area + curb. The assumption text must mention "membrane, pan, and curb"; refine hint should mention steam shower / curbless / rolled-edge variations.

For `powder` and `half_bath` subtypes (no shower), `waterproofing.quantity = 0` and the assumption text reads: *"No shower in this subtype — waterproofing line preserved for audit but quantity is zero. Refine if a wet area was overlooked."*

**Provenance shape — identical to kitchen:** every line carries `line_id`, `scope_label`, `kb_lookup_key`, `quantity`, `uom`, `quantity_basis`, `quantity_assumption`, `materials_basis`, `materials_value`, `pricing_basis`, `range_low_cents`, `range_high_cents`, `range_uom`, `source_ref_ids`, `confidence: 'working_draft'`, `refine_hint`.

**Public API:**

```ts
export interface BathScaffold {
  readonly archetype: 'bath_remodel';
  readonly subtype: BathSubtype;
  readonly dimensions: BathDimensions | null;
  readonly materials: BathMaterials;
  readonly lines: readonly KitchenScaffoldLine[];  // reuse type; bath uses same shape
  readonly source_fragments: readonly string[];
}

export function instantiateBathScaffold(detection: BathArchetypeDetection): BathScaffold;
```

**Critical constraint (lift from kitchen, do not weaken):** NO project total computed anywhere. NO summation function. The test file MUST include a `no-project-total` invariant test.

**KB lookup:** mirror `buildKbQuery(slot, materials)` pattern. Map material slots to material values from `BathMaterials`. Use the existing `lookupCostKbSeed` from `v15-cost-kb-seed.ts` unchanged.

### 3.3 `src/examples/v15-vertical-slice/v15-bath-scaffold-html.ts`

Mirror `v15-kitchen-scaffold-html.ts`. Adapt header copy:

- pretitle: `Working draft detected`
- title: `Bath remodel · ${subtypeLabel} · ${L} × ${W}${ceiling}`
  - Subtype labels: `Powder room` / `Half bath` / `Full bath` / `Primary bath`
- Material chips: render whichever bath material slots are non-null (Floor, Shower walls, Vanity, Counter, Fixtures finish)
- Caveat: identical to kitchen (`Generated working draft · Review assumptions before pricing · No pricing authority · Ranges only, not quotes`)
- Line cards: identical structure (scope/qty header, assumption, qty/material/range pills, refine hint, debug overlay)
- Footnote: identical

**Reuse the kitchen CSS classes** (`.kerf-f35-scaffold__*`). No new CSS unless visual differentiation is desired; if so, scope tightly with `.kerf-f35-scaffold--bath` modifier.

---

## 4. Wire into `pages.ts`

In the `case 'draft-review':` block, **chain detection** after kitchen:

```ts
let scaffoldHtml = renderKitchenScaffoldFromActiveFixture(activeFixture);
if (scaffoldHtml === '') {
  scaffoldHtml = renderBathScaffoldFromActiveFixture(activeFixture);
}
```

Add the helper `renderBathScaffoldFromActiveFixture` next to the existing kitchen helper. Same shape:
1. Read transcript from `activeFixture.field_capture_input?.transcript_original ?? ''`
2. Call `detectBathArchetype(text)`
3. If null, return `''`
4. Call `instantiateBathScaffold(detection)`
5. Call `renderBathScaffoldSection(scaffold)`

**Coordination note:** Claude (integration lead) may have uncommitted persistence-layer work in `pages.ts` for `/api/projects/*` endpoints. If you see uncommitted changes in `pages.ts` when you start:
1. `git stash`
2. Complete the bath detection chain change in a clean branch
3. Flag merge conflicts at PR review for resolution

**You own `pages.ts` for this PR's detection chain change.**

---

## 5. Tests required — `tests/v15-bath-scope-scaffold.test.ts`

Mirror `tests/v15-kitchen-scope-scaffold.test.ts`. Target: **25–30 new tests**. Test count after merge should land **740–750**.

**Coverage required:**

- Archetype detection
  - Positive: each subtype keyword (`bath`, `powder room`, `half bath`, `primary bath`, `master bath`, `en-suite`) → correct subtype
  - Negative: no bath mention → null
  - Dimension parsing: same 5 formats as kitchen (`5 by 8`, `5x8`, `5'x8'`, `5 ft by 8 ft`, `5×8`)
  - Sanity bounds: 3 ft / 20 ft / 250 SF caps
  - Ceiling extraction: digits + spoken numerals
  - Materials extraction: all 6 material slots
- Scaffold instantiation
  - 11 slots emitted per subtype
  - Correct UoMs per slot
  - Correct quantity formulas for 5x8 full bath (40 SF floor, perimeter 26 LF)
  - Waterproofing fires 60 SF for full, 100 SF for primary, 0 for powder/half
  - Each subtype produces correct fixture counts
- Provenance preservation
  - Every line has all 4 basis fields populated
  - `confidence === 'working_draft'` on every line
  - `refine_hint` non-empty on every line
- KB lookup
  - Material-augmented (e.g., "tile floor" matches Flooring tile rows)
  - `pricing_basis === 'no_match'` when KB has no row (cabinetry-like miss — bath fixtures may not be in seed)
- **NO PROJECT TOTAL invariant**
  - Forbidden phrases (`project total | estimated total | grand total | total cost | sum of`) MUST NOT appear in rendered scaffold HTML
- **NO LLM IMPORT invariant**
  - `v15-bath-*.ts` files import no `groqChat`, `whisperTranscribe`, `openai`, `anthropic`, no `fetch(`
- Render
  - Hit/miss (null scaffold → empty string)
  - "Working draft detected" + dimensions + subtype label + material chips
  - "No pricing authority" + "Ranges only, not quotes" present
  - Assumption text + refine hint visible per line
- Subtype variants
  - Title displays correctly for all four subtypes

---

## 6. Pre-push gate (all must pass before opening PR)

```bash
npm run typecheck                              # must be clean
npm run demo:v15-vertical-slice:esbuild       # bundle must build
npm test                                       # all tests pass; count in 740–750
git diff --check                               # whitespace clean
```

---

## 7. Scope-check before push (zero hits required)

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/v15-bath-*.ts
rg "process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)" src/examples/v15-vertical-slice/v15-bath-*.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/examples/v15-vertical-slice/v15-bath-*.ts
rg "amount.*\.toFixed|cents\s*\*|cents\s*\/(?!100)" src/examples/v15-vertical-slice/v15-bath-*.ts
```

---

## 8. PR body template

```
feat(v15): bath archetype scope scaffold

Mirrors PR #156's kitchen pattern for bath_remodel archetype. Four
subtypes detected (powder / half_bath / full_bath / primary_bath) with
appropriate slot lists and quantity formulas. Same provenance shape as
kitchen scaffold; same "working draft" framing; same KB tier-1 lookup
augmented by transcript material callouts.

11-slot template — adds waterproofing as a non-skippable line for any
shower remodel (per Christian 2026-05-14: "waterproofing is critical
in a shower remodel, we can't skip that"). Quantity is 0 for powder
and half_bath subtypes (no shower) but the line stays visible for audit.

Architecture invariants preserved 1:1:
  - Deterministic only (regex + arithmetic; no LLM)
  - No project total computed (invariant test guards)
  - confidence locked to 'working_draft'
  - Per-line provenance: quantity_basis, materials_basis, pricing_basis
  - KB lookup material-augmented when transcript names a material

Tests: 715 -> ~740 (+~25). Bundle: 338.5kb -> ~355kb.
```

---

## 9. What NOT to do

- ❌ Do not generalize the archetype/scaffold types into a shared `Archetype<T>` abstraction. Duplicate; refactor only when 3+ archetypes exist and the pattern is clear.
- ❌ Do not add new CSS classes beyond what the kitchen scaffold uses (visual consistency is the goal). Use `.kerf-f35-scaffold--bath` modifier only if a clear product reason emerges.
- ❌ Do not add a project total, even labeled "estimated."
- ❌ Do not skip the waterproofing line in any subtype — preserve it at quantity 0 for powder/half so the operator can audit it was considered.
- ❌ Do not introduce a new `MediaRecorder` / audio path — voice capture is unchanged.
- ❌ Do not touch `f35-draft-review.ts` — the bath scaffold reuses the same F-35 wrapper section.
- ❌ Do not touch the Cost KB seed JSON.
- ❌ Do not edit kitchen scaffold files (`v15-kitchen-*.ts`) — bath is parallel, not a refactor.

---

## 10. Handoff back to integration lead

When CI is green, open the PR with the body above and include a self-review summary covering:

- Quantity formulas for each subtype (honest about heuristics; refine_hint text invites overrides)
- Material callouts coverage (which slots have which patterns)
- Slot list reasoning for waterproofing inclusion across all subtypes
- Test count delta vs target (740–750 range)

Claude (integration lead) routes to ChatGPT + Codex (back May 16) for second-opinion review before merge.
