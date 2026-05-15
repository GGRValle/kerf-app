# Cursor Agent Brief — Outdoor Kitchen Archetype Scope Scaffold

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PRs:** #156 (kitchen scope scaffold), #159 (bath scope scaffold) — mirror this pattern
- **Branch from:** `main` (latest, after PR #159 — `f9b52b3` or newer)
- **Target branch:** `feature/v15-outdoor-kitchen-scope-scaffold`
- **Target test count after merge:** ~775–785 (was 745 at #159; this brief adds ~30)
- **Estimated effort:** 4–6 hours

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

**Product framing:** *"Here is my working draft — refine it."* (PR #156 kitchen + #159 bath both prove the pattern.)

---

## 2. Task summary

Build an **outdoor kitchen archetype scope scaffold** mirroring the kitchen + bath pattern. Three new files + one wire-in into `pages.ts`. Deterministic detection (regex + arithmetic; no LLM). Per-line provenance. Working-draft framing. No project total.

The Cost KB seed already has 6 `Outdoor Kitchens` rows that pass the gate (`OUTK-001` through `OUTK-006` after gate filter, originally `OUTK-001` through `OUTK-010` in the source xlsx). Tier-1 lookups will hit on this archetype, so range framing will be operative.

**Christian's 2026-05-13 dogfood mentioned this archetype literally:** *"griddle, grill fire pit, pizza oven, outdoor cabinetry, countertops, poured-in-place concrete."* That transcript is what the scaffold must handle on first dispatch.

---

## 3. Three files to create

### 3.1 `src/examples/v15-vertical-slice/v15-outdoor-kitchen-archetype.ts`

Mirror `v15-bath-archetype.ts` / `v15-kitchen-archetype.ts` shape.

```ts
export type OutdoorKitchenSubtype =
  | 'compact_grill_island'   // ~6-10 LF, single grill, no pizza oven
  | 'standard_outdoor_kitchen' // ~10-16 LF, grill + side burner + counter + storage
  | 'full_outdoor_kitchen';  // 16+ LF, grill + pizza oven + side burner + sink + fridge

export interface OutdoorKitchenDimensions {
  /** Linear feet of the bar/counter run (the operator usually describes this rather than a rectangular footprint). */
  readonly counter_run_ft: number | null;
  /** Optional rectangular substrate footprint when given (e.g., "10 by 12 patio for outdoor kitchen"). */
  readonly substrate_length_ft: number | null;
  readonly substrate_width_ft: number | null;
  readonly substrate_sf: number | null;
  readonly raw_match: string;
}

export interface OutdoorKitchenMaterials {
  readonly counters: string | null;          // "granite" | "concrete" | "soapstone" | "porcelain slab" | "tile"
  readonly cabinetry: string | null;         // "stainless steel" | "cement board" | "teak" | "stone veneer cladding"
  readonly substrate: string | null;         // "poured-in-place concrete" | "pavers" | "existing slab" | "decking"
  readonly cladding: string | null;          // "stone veneer" | "stucco" | "tile" | "smooth stucco"
  readonly grill_type: string | null;        // "built-in grill" | "drop-in grill" | "kamado" | "smoker"
  readonly pizza_oven: string | null;        // "wood-fired pizza oven" | "gas pizza oven" | "modular pizza oven"
}

export interface OutdoorKitchenArchetypeDetection {
  readonly archetype: 'outdoor_kitchen';
  readonly subtype: OutdoorKitchenSubtype;
  readonly dimensions: OutdoorKitchenDimensions | null;
  readonly materials: OutdoorKitchenMaterials;
  readonly source_fragments: readonly string[];
}

export function detectOutdoorKitchenArchetype(text: string): OutdoorKitchenArchetypeDetection | null;
```

**Detection rules:**

- Trigger: `\b(outdoor kitchen|BBQ island|grill island|outdoor BBQ|outdoor grill)\b` (case-insensitive)
- Subtype heuristic (more specific first):
  - mentions both "pizza oven" AND ("sink" OR "refrigerator" OR "fridge") → `full_outdoor_kitchen`
  - mentions "pizza oven" alone OR "side burner" → `standard_outdoor_kitchen`
  - mentions just "grill" / "BBQ" with no side appliances → `compact_grill_island`
  - default → `standard_outdoor_kitchen` (most common)

- **Dimensions parsing — different from kitchen/bath:**
  - **Counter run LF:** parse patterns like `\b(\d+)\s*(?:'|\s*(?:ft|feet|foot))\s+(?:long|of\s+(?:counter|bar|island|outdoor kitchen))\b` OR `\bouterdoor kitchen.*?(\d+)\s*(?:'|\s*(?:ft|feet))\s+(?:long|run)\b`. Sanity bound: 4-40 LF.
  - **Substrate footprint** (rectangular): same `DIMENSION_PATTERN` as kitchen/bath when given in the form "10 by 12 patio" / "10x14 outdoor area" near the outdoor-kitchen keywords. Sanity bound: 4-30 ft per side, <600 SF.
  - **Either or both may be null.** The scaffold handles null dimensions per existing pattern.

- Materials — pattern-based, more-specific-first ordering:
  - `counters`: `\bgranite\b`, `\bsoapstone\b`, `\bporcelain slab\b`, `\bconcrete counter\b`, `\boutdoor[- ]rated tile\b`
  - `cabinetry`: `\bstainless(?:\s*steel)?\s*cabinetry?\b`, `\bcement board cabinetry?\b`, `\bteak cabinetry?\b`
  - `substrate`: `\bpoured[- ]in[- ]place concrete\b`, `\bconcrete slab\b`, `\bpavers?\b`, `\bexisting (?:slab|patio)\b`, `\bdeck(?:ing)?\s+substrate\b`
  - `cladding`: `\bstone veneer\b`, `\bstucco\b`, `\boutdoor tile\b`
  - `grill_type`: `\bbuilt[- ]in grill\b`, `\bdrop[- ]in grill\b`, `\bkamado\b`, `\bsmoker\b`, `\bgriddle\b`
  - `pizza_oven`: `\bwood[- ]fired pizza oven\b`, `\bgas pizza oven\b`, `\bmodular pizza oven\b`, `\bpizza oven\b` (fallback)

### 3.2 `src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold.ts`

Mirror `v15-bath-scaffold.ts` exactly. **Reuse `KitchenScaffoldLine` + the shared basis types** — direct import, no abstraction. Same `lookupCostKbSeed` import path.

**11-slot template (substrate is non-skippable — same posture as bath waterproofing):**

| slot_id | scope_label | UoM | Quantity formula | Material slot |
|---|---|---|---|---|
| `site_prep` | Site prep / excavation | SF | `substrate_sf ?? 0` (renders 0 if no substrate dims; estimator_default) | none |
| `substrate` | **Substrate (poured-in-place concrete OR pavers)** | SF | `substrate_sf ?? null` (uses counter_run × 4 as fallback when no substrate dims: ~4 ft depth zone) | `substrate` |
| `gas_water_rough` | Gas line + water rough-in | EA | compact=1 (gas only), standard=1 (gas only), full=2 (gas + water for sink) | none |
| `electrical_rough` | Electrical rough (GFCI, outdoor lighting, appliance circuits) | EA | compact=2, standard=4, full=6 | none |
| `island_framing` | Island framing / cabinetry shell | LF | `counter_run_ft ?? null` | `cabinetry` |
| `counters` | Countertops (granite / concrete / porcelain slab) | SF | `counter_run_ft * 2.08` when known; null otherwise. Note: outdoor counters often 25-30" deep; use 2.08 ft default to match kitchen | `counters` |
| `grill_install` | Built-in grill install | EA | compact=1, standard=1, full=1 | `grill_type` |
| `pizza_oven_install` | Pizza oven install | EA | compact=0, standard=0 (line stays at 0 for audit), full=1 | `pizza_oven` |
| `appliance_install` | Side burner / refrigerator / cooler install | EA | compact=0, standard=1 (side burner), full=3 (side burner + fridge + sink) | none |
| `cladding` | Island cladding (stone veneer / stucco / tile) | SF | `counter_run_ft * 3` (~3 ft tall × LF; null when no LF) | `cladding` |
| `seal_finish` | Sealants + outdoor finish (food-safe stone seal, grout, cabinetry seal) | LS | 1 (estimator_default — typical lump sum for an outdoor kitchen) | none |

**Critical substrate detail (same posture as bath waterproofing):**
Outdoor kitchens MUST have a structural substrate or they fail in the first freeze-thaw cycle. The `substrate` line is non-skippable; even when the operator doesn't name a substrate material, the line emits with `materials_basis: 'unknown'` and a refine hint pointing at *"poured-in-place slab, pavers on prepared base, or existing slab — confirm before pricing"*.

**Quantity formulas — key heuristics for an outdoor kitchen:**
- Default counter depth: 25" / 2.08 ft (matches indoor kitchen convention; outdoor counter depth varies but 25" is a reasonable typical)
- Default cabinetry height for cladding calc: 36" / 3 ft (typical island height)
- Substrate fallback when no rectangular dims given: `counter_run_ft × 4` (assumes a 4-ft-deep work zone in front of the island; conservative)

**Provenance shape — identical to kitchen/bath:** every line carries `line_id`, `scope_label`, `kb_lookup_key`, `quantity`, `uom`, `quantity_basis`, `quantity_assumption`, `materials_basis`, `materials_value`, `pricing_basis`, `range_low_cents`, `range_high_cents`, `range_uom`, `source_ref_ids`, `confidence: 'working_draft'`, `refine_hint`.

**Public API:**

```ts
export interface OutdoorKitchenScaffold {
  readonly archetype: 'outdoor_kitchen';
  readonly subtype: OutdoorKitchenSubtype;
  readonly dimensions: OutdoorKitchenDimensions | null;
  readonly materials: OutdoorKitchenMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  readonly source_fragments: readonly string[];
}

export function instantiateOutdoorKitchenScaffold(detection: OutdoorKitchenArchetypeDetection): OutdoorKitchenScaffold;
```

**Critical constraint (lift from kitchen/bath, do not weaken):** NO project total computed. NO summation. Tests MUST include `no-project-total` and `no-LLM-import` invariants.

**KB lookup:** the seed has 6 `Outdoor Kitchens` rows. The trade-matcher in `v15-cost-kb-seed.ts` already routes outdoor-kitchen keywords correctly via `TRADE_KEYWORDS` (added in PR #153). Material-augmented lookup ("granite countertop outdoor kitchen") will hit when the material-matcher PR (companion brief, docs/agent-briefs/material-specific-tier1-matcher-2026-05-15.md) lands.

### 3.3 `src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold-html.ts`

Mirror `v15-bath-scaffold-html.ts`. Adapt header copy:

- pretitle: `Working draft detected`
- title: `Outdoor kitchen · ${subtypeLabel} · ${dimsLabel}`
  - Subtype labels: `Compact grill island` / `Standard outdoor kitchen` / `Full outdoor kitchen`
  - Dims label: `${counter_run_ft} LF counter` when counter_run_ft is known; if substrate dims are also known, add ` · ${L} × ${W} substrate`; when both null, `dimensions pending`
- Material chips: render non-null slots from `OutdoorKitchenMaterials` (Counters, Cabinetry, Substrate, Cladding, Grill, Pizza oven)
- Caveat: identical to bath/kitchen
- Line cards: identical structure
- Footnote: adapt slightly — *"Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Outdoor work has weather + code dependencies (gas line permits, drainage, freeze-thaw) that aren't captured in the scaffold; refine with site conditions before producing a draft."*

**Reuse the kitchen CSS classes** (`.kerf-f35-scaffold__*`). No new CSS unless a clear product reason emerges; if so, scope with `.kerf-f35-scaffold--outdoor-kitchen` modifier.

---

## 4. Wire into `pages.ts`

In the `case 'draft-review':` block, **extend the detection chain**:

```ts
let scaffoldHtml = renderKitchenScaffoldFromActiveFixture(activeFixture);
if (scaffoldHtml === '') {
  scaffoldHtml = renderBathScaffoldFromActiveFixture(activeFixture);
}
if (scaffoldHtml === '') {
  scaffoldHtml = renderOutdoorKitchenScaffoldFromActiveFixture(activeFixture);
}
```

Add the helper `renderOutdoorKitchenScaffoldFromActiveFixture` next to the existing kitchen + bath helpers. Same shape as the existing two.

**Coordination note:** Claude (integration lead) may have uncommitted persistence-layer work in `pages.ts`. If you see uncommitted changes in `pages.ts`:
1. `git stash`
2. Complete the outdoor-kitchen detection chain change in a clean branch
3. Flag merge conflicts at PR review for resolution

**You own `pages.ts` for this PR's detection chain change.**

---

## 5. Tests required — `tests/v15-outdoor-kitchen-scope-scaffold.test.ts`

Mirror `tests/v15-bath-scope-scaffold.test.ts` / `tests/v15-kitchen-scope-scaffold.test.ts`. Target: **25–30 new tests**. Test count after merge should land **775–785**.

**Coverage required:**

- Archetype detection
  - Positive: each subtype keyword combination → correct subtype
  - Negative: no outdoor-kitchen mention → null
  - Counter run LF parsing: `"12 ft of bar"`, `"12' of counter"`, `"12 feet long island"`
  - Substrate footprint parsing: `"10 by 12 patio"` near the outdoor-kitchen mention
  - Christian's 2026-05-13 dogfood phrase: *"griddle, grill fire pit, pizza oven, outdoor cabinetry, countertops, poured-in-place concrete"* → detection returns non-null with `substrate: 'poured-in-place concrete'`
  - Sanity bounds: counter run 4-40 LF; substrate 4-30 ft per side, <600 SF
  - Materials extraction: all 6 material slots
- Scaffold instantiation
  - 11 slots emitted per subtype
  - Correct UoMs per slot
  - Correct quantity formulas for 12 LF counter run, full_outdoor_kitchen subtype
  - Substrate fires for all subtypes (non-skippable; renders fallback `counter_run × 4` when no substrate dims)
  - Pizza oven install fires 0 for compact/standard, 1 for full
- Provenance preservation: every line has all 4 basis fields; `confidence === 'working_draft'`; `refine_hint` non-empty
- KB lookup: at least one line hits the seed's Outdoor Kitchens rows; material-augmented when materials named
- **NO PROJECT TOTAL invariant** — forbidden phrases (`project total | estimated total | grand total | total cost | sum of`) MUST NOT appear in rendered scaffold HTML
- **NO LLM IMPORT invariant** — `v15-outdoor-kitchen-*.ts` files import no `groqChat`, `whisperTranscribe`, `openai`, `anthropic`, no `fetch(`
- Render: hit/miss; "Working draft detected" + "No pricing authority" + "Ranges only, not quotes" copy
- Subtype variants render in the title correctly

---

## 6. Pre-push gate (all must pass before opening PR)

```bash
npm run typecheck
npm run demo:v15-vertical-slice:esbuild
npm test                                # all tests pass; count in 775–785
git diff --check
```

---

## 7. Scope-check before push (zero hits required)

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/v15-outdoor-kitchen-*.ts
rg "process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)" src/examples/v15-vertical-slice/v15-outdoor-kitchen-*.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/examples/v15-vertical-slice/v15-outdoor-kitchen-*.ts
rg --pcre2 "amount.*\.toFixed|cents\s*\*|cents\s*\/(?!100)" src/examples/v15-vertical-slice/v15-outdoor-kitchen-*.ts
rg -i "groqChat|whisperTranscribe|openai|anthropic" src/examples/v15-vertical-slice/v15-outdoor-kitchen-*.ts
```

If you don't have `rg` on PATH (the bath agent didn't), say so in the PR description and integration lead will run them.

---

## 8. PR body template

```
feat(v15): outdoor kitchen archetype scope scaffold

Mirrors PR #156 (kitchen) and #159 (bath) patterns for the
outdoor_kitchen archetype. Three subtypes detected (compact_grill_
island / standard_outdoor_kitchen / full_outdoor_kitchen) with
appropriate slot lists and quantity formulas.

11-slot template includes substrate (poured-in-place concrete /
pavers / existing slab) as a non-skippable line. Outdoor work without
proper substrate fails first freeze-thaw cycle; the line preserves
the consideration in audit even when no specific material is named.

Christian's 2026-05-13 dogfood transcript ("griddle, grill fire pit,
pizza oven, outdoor cabinetry, countertops, poured-in-place concrete")
triggers detection correctly.

Architecture invariants preserved 1:1:
  - Deterministic only (regex + arithmetic; no LLM)
  - No project total computed (invariant test guards)
  - confidence locked to 'working_draft'
  - Per-line provenance: quantity_basis, materials_basis, pricing_basis
  - Tier-1 KB lookup hits the seed's 6 Outdoor Kitchens rows

Tests: 745 -> ~775 (+~30). Bundle: 362.6kb -> ~385kb.
```

---

## 9. What NOT to do

- ❌ Do not generalize the archetype/scaffold types into a shared `Archetype<T>` abstraction. Duplicate; refactor only when 4+ archetypes exist and the pattern is clear.
- ❌ Do not add new CSS classes beyond what the existing scaffold uses. Visual consistency is the goal.
- ❌ Do not add a project total, even labeled "estimated."
- ❌ Do not skip the substrate line for compact/standard subtypes — preserve it visibly at the inferred quantity (or fallback `counter_run × 4`) so audit captures that substrate was considered.
- ❌ Do not introduce a new `MediaRecorder` / audio path.
- ❌ Do not touch `f35-draft-review.ts`, kitchen scaffold files, bath scaffold files, or the Cost KB seed JSON.
- ❌ Do not introduce gas-line permit logic or code-jurisdiction lookups — that's design-first work for a later PR.

---

## 10. Coordination notes

- **Material matcher brief is shipping in parallel** (`docs/agent-briefs/material-specific-tier1-matcher-2026-05-15.md`). Once it lands, your outdoor-kitchen scaffold automatically benefits from narrowed lookups (e.g., "granite countertop outdoor kitchen" narrows to granite-only rows). No bath-side change needed.
- **No file conflict with bath or kitchen PRs.** Outdoor-kitchen touches `v15-outdoor-kitchen-*.ts`, `pages.ts` (detection chain), `tests/v15-outdoor-kitchen-*.test.ts`.
- **The only shared file is `pages.ts`** — append your detection chain entry after the existing kitchen + bath entries. If a future archetype agent (deck brief) is racing this PR, last-merger updates the chain.

---

## 11. Handoff back to integration lead

When CI is green:
1. Open the PR with the body above
2. Self-review summary covering:
   - Quantity formulas for each subtype (honest about heuristics; refine_hint text invites overrides)
   - Material callouts coverage
   - Substrate slot rationale across subtypes
   - Test count delta vs ~775–785 target
   - Whether you ran the §7 scope-check `rg` commands (note in PR if not)

Integration lead routes to ChatGPT + Codex (Codex back May 16) for second-opinion review before merge.
