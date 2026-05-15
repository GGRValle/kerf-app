# Cursor Agent Brief — Deck Archetype Scope Scaffold + Outdoor-Structure Taxonomy

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PRs:** #156 (kitchen), #159 (bath) — mirror this pattern
- **Branch from:** `main` (latest, after PR #159 — `f9b52b3` or newer)
- **Target branch:** `feature/v15-deck-scope-scaffold`
- **Target test count after merge:** ~775–790 (was 745 at #159; this brief adds ~30 + 3 taxonomy tests)
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

**Product framing:** *"Here is my working draft — refine it."*

---

## 2. Task summary

Two related changes in one PR:

1. **Add the `deck` archetype** to the project-type taxonomy in `src/projects/types.ts:62` (the gap I've flagged three times in May dogfood — Christian's transcripts have repeatedly described deck scopes that fell through to `addition` because no `deck` slot existed).

2. **Build the deck archetype scope scaffold** mirroring kitchen + bath patterns.

The Cost KB seed already has 10 `Decking` rows that pass the gate (`DECK-001` through `DECK-010` after filter). Tier-1 lookups will hit on this archetype.

---

## 3. Archetype taxonomy expansion — first

Before building the scaffold, expand `PROJECT_TYPE_TAGS` in `src/projects/types.ts:62`:

**Current state:**

```ts
export const PROJECT_TYPE_TAGS = [
  'kitchen_remodel',
  'primary_bath_remodel',
  'secondary_bath_remodel',
  'multi_room_remodel',
  'whole_home_remodel',
  'addition',
  'adu',
  'targeted_remodel',
  'cabinetry_only',
  'millwork_only',
  'vanity_only',
] as const;
```

**Add three outdoor-structure entries:**

```ts
  'deck',
  'outdoor_kitchen',
  'patio_or_hardscape',
```

**Why three at once:**
- `deck` is this PR's archetype
- `outdoor_kitchen` is the parallel outdoor-kitchen brief (`docs/agent-briefs/outdoor-kitchen-scope-scaffold-2026-05-15.md`) — adding now prevents a later PR-conflict on the same single file
- `patio_or_hardscape` reserves the slot for future expansion (no scaffold built yet, but the taxonomy entry exists)

**Tests required for the taxonomy expansion** (3 small tests in a new file `tests/projects-types-outdoor-structures.test.ts`):

```ts
test('PROJECT_TYPE_TAGS includes deck archetype', () => {
  expect(PROJECT_TYPE_TAGS).toContain('deck');
});

test('PROJECT_TYPE_TAGS includes outdoor_kitchen archetype', () => {
  expect(PROJECT_TYPE_TAGS).toContain('outdoor_kitchen');
});

test('PROJECT_TYPE_TAGS includes patio_or_hardscape archetype', () => {
  expect(PROJECT_TYPE_TAGS).toContain('patio_or_hardscape');
});
```

(Use `assert` not `expect` since the repo uses node:test, not vitest. Match existing test idioms.)

---

## 4. Three new scaffold files

### 4.1 `src/examples/v15-vertical-slice/v15-deck-archetype.ts`

Mirror `v15-bath-archetype.ts` shape.

```ts
export type DeckSubtype =
  | 'ground_level'      // <30" off grade, no railing required, no posts/beams
  | 'raised_attached'   // raised + ledger to house, posts/beams/railing
  | 'raised_freestanding' // raised, no ledger, posts/beams/railing
  | 'multi_level';      // multiple platforms + stairs between

export interface DeckDimensions {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly floor_sf: number;
  readonly perimeter_ft: number;
  readonly height_off_grade_ft: number | null;
  readonly raw_match: string;
}

export interface DeckMaterials {
  readonly decking_board: string | null;   // "composite" (Trex/TimberTech) | "pressure-treated" | "cedar" | "redwood" | "Ipe" | "tropical hardwood"
  readonly railing_material: string | null;// "wood" | "aluminum" | "composite" | "cable" | "glass panel"
  readonly stair_material: string | null;  // typically matches decking_board
  readonly substructure: string | null;    // "PT lumber" | "steel" | "composite framing"
}

export interface DeckArchetypeDetection {
  readonly archetype: 'deck';
  readonly subtype: DeckSubtype;
  readonly dimensions: DeckDimensions | null;
  readonly materials: DeckMaterials;
  readonly source_fragments: readonly string[];
}

export function detectDeckArchetype(text: string): DeckArchetypeDetection | null;
```

**Detection rules:**

- Trigger: `\b(deck|decking|deck remodel|deck rebuild)\b` (case-insensitive)
- Subtype heuristic (more specific first):
  - mentions "multi[- ]level" OR "multiple levels" OR "two levels" → `multi_level`
  - mentions "freestanding" OR "detached" OR "free standing" → `raised_freestanding`
  - mentions "ledger" OR "attached to (?:the )?house" → `raised_attached`
  - mentions "ground level" OR "low deck" OR "ground[- ]level" → `ground_level`
  - default: `raised_attached` (most common residential remodel)
- Dimensions: same `DIMENSION_PATTERN` as kitchen/bath; sanity bounds **6 ft minimum, 50 ft maximum per side, <2000 SF total**
- Height off grade: parse `\b(\d+)\s*(?:'|\s*(?:ft|feet|foot))\s+(?:off\s+(?:the\s+)?(?:ground|grade)|above grade|raised)\b`; null when not stated
- Materials:
  - `decking_board`: `\bcomposite\b`, `\btrex\b`, `\btimbertech\b`, `\bpressure[- ]treated\b`, `\bPT (?:wood|lumber|deck)\b`, `\bcedar\b`, `\bredwood\b`, `\bipe\b`, `\btropical hardwood\b`
  - `railing_material`: `\bcable rail(?:ing)?\b`, `\baluminum rail(?:ing)?\b`, `\bglass panel\b`, `\bcomposite rail(?:ing)?\b`, `\bwood rail(?:ing)?\b`
  - `stair_material`: typically inferred from `decking_board` if not separately mentioned
  - `substructure`: `\bsteel framing\b`, `\bcomposite framing\b`, `\bPT framing\b`, `\bpressure[- ]treated framing\b`

### 4.2 `src/examples/v15-vertical-slice/v15-deck-scaffold.ts`

Mirror `v15-bath-scaffold.ts`. **Reuse `KitchenScaffoldLine` + shared basis types.**

**11-slot template:**

| slot_id | scope_label | UoM | Quantity formula | Material slot |
|---|---|---|---|---|
| `site_prep` | Site prep / grading | SF | `floor_sf` | none |
| `footings` | Footings (concrete piers or sonotubes) | EA | ground_level=`max(4, floor_sf/64)`; raised=`max(4, floor_sf/48)`; multi_level=`max(6, floor_sf/40)` | none |
| `ledger_or_beam` | Ledger / beam attachment | LF | raised_attached=`length_ft`; freestanding=0; multi_level=`length_ft`; ground_level=`length_ft` | none |
| `posts` | Posts (4x4 / 6x6) | EA | `Math.ceil(floor_sf/64)` for raised; 0 for ground_level | `substructure` |
| `joists_beams` | Joists + beams structure | LF | `floor_sf * 1.5` (LF of framing per SF of deck — conservative) | `substructure` |
| `decking_surface` | Decking surface (boards) | SF | `floor_sf` | `decking_board` |
| `railing` | Railing (including post caps) | LF | ground_level=0; raised=`perimeter_ft - length_ft` (subtract ledger side); multi_level=`perimeter_ft - length_ft + 4` (interior step rail) | `railing_material` |
| `stairs` | Stairs (treads + risers + stringers) | EA | ground_level=`(height_off_grade_ft ?? 0 < 0.5) ? 0 : 3`; raised/multi=`(height_off_grade_ft ?? 3) * 1.3` (estimator rule: ~1 step per 7" rise, rounded up to whole flights) | `stair_material` |
| `flashing_drainage` | Flashing + drainage at ledger / deck-to-house joint | LF | raised_attached=`length_ft`; multi_level=`length_ft`; others=0 | none |
| `finish_seal` | Stain / seal (PT/wood only; not for composite) | SF | composite=0; PT/cedar/redwood/Ipe=`floor_sf + (perimeter_ft * 3)` (deck surface + railing surface area) | none |
| `permits` | Permits + inspections | LS | 1 (estimator_default — most jurisdictions require) | none |

**Critical detail (same posture as bath waterproofing + outdoor-kitchen substrate):**
- **Flashing / drainage** at the ledger-to-house joint is non-skippable for `raised_attached` and `multi_level` subtypes. Water intrusion at ledger is the #1 cause of deck-house failure. Line stays visible for audit even when not separately mentioned in the transcript.
- **Permits** stays visible across all subtypes. Most jurisdictions require deck permits ≥30" off grade and structural changes regardless of height. Refine hint should mention the operator's actual jurisdiction.

**Quantity formulas — heuristics for a 12×16 deck (192 SF, perimeter 56 LF, raised_attached):**
- Footings: `max(4, 192/48)` = 4 piers
- Ledger: 12 LF (one side attached to house)
- Posts: `ceil(192/64)` = 3 posts
- Joists/beams: 192 × 1.5 = 288 LF
- Decking surface: 192 SF
- Railing: 56 − 12 = 44 LF
- Stairs: assume 3 ft rise → ~4 EA (one flight of ~4 steps)
- Flashing: 12 LF
- Finish/seal: composite=0; PT/wood: 192 + (56 × 3) = 360 SF

**Provenance shape — identical to kitchen/bath/outdoor-kitchen:** every line carries the full provenance set; `confidence === 'working_draft'`; `refine_hint` non-empty.

**Public API:**

```ts
export interface DeckScaffold {
  readonly archetype: 'deck';
  readonly subtype: DeckSubtype;
  readonly dimensions: DeckDimensions | null;
  readonly materials: DeckMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  readonly source_fragments: readonly string[];
}

export function instantiateDeckScaffold(detection: DeckArchetypeDetection): DeckScaffold;
```

**KB lookup:** the seed has 10 `Decking` rows. `TRADE_KEYWORDS` in `v15-cost-kb-seed.ts` already routes deck keywords (`deck`, `decking`, `composite deck`, `trex`, `timbertech`, `pressure-treated decking`, `ipe`). Material-augmented lookup will narrow once PR for material matcher lands.

### 4.3 `src/examples/v15-vertical-slice/v15-deck-scaffold-html.ts`

Mirror `v15-bath-scaffold-html.ts`. Adapt header copy:

- pretitle: `Working draft detected`
- title: `Deck remodel · ${subtypeLabel} · ${L} × ${W}${heightSuffix}`
  - Subtype labels: `Ground-level deck` / `Raised deck (attached)` / `Raised deck (freestanding)` / `Multi-level deck`
  - heightSuffix: ` (${height_off_grade_ft} ft above grade)` when known; empty otherwise
- Material chips: render non-null slots from `DeckMaterials`
- Caveat: identical to bath/kitchen
- Footnote: *"Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Deck work has jurisdiction-specific code requirements (permit thresholds, railing height, footing depth for frost line) — refine with your AHJ before pricing."*

**Reuse the kitchen CSS classes.** No new CSS unless visual differentiation is desired.

---

## 5. Wire into `pages.ts`

In the `case 'draft-review':` block, **extend the detection chain**:

```ts
let scaffoldHtml = renderKitchenScaffoldFromActiveFixture(activeFixture);
if (scaffoldHtml === '') {
  scaffoldHtml = renderBathScaffoldFromActiveFixture(activeFixture);
}
if (scaffoldHtml === '') {
  scaffoldHtml = renderOutdoorKitchenScaffoldFromActiveFixture(activeFixture);
}
if (scaffoldHtml === '') {
  scaffoldHtml = renderDeckScaffoldFromActiveFixture(activeFixture);
}
```

If the outdoor-kitchen agent has not landed by the time you push, your detection chain will only have kitchen + bath + deck (outdoor-kitchen entry is missing). That's fine; the integration lead handles chain re-merging at PR review.

**You own `pages.ts` for this PR's detection chain change + `src/projects/types.ts` for the taxonomy expansion.**

---

## 6. Tests required — `tests/v15-deck-scope-scaffold.test.ts`

Mirror `tests/v15-bath-scope-scaffold.test.ts`. Target: **25–30 new tests** + 3 taxonomy tests in `tests/projects-types-outdoor-structures.test.ts`.

**Coverage required:**

- Archetype detection
  - Positive: each subtype keyword → correct subtype
  - Negative: no deck mention → null
  - Dimensions: same parsing formats
  - Height off grade: `"3 feet off the ground"`, `"24" raised"`
  - Sanity bounds: 6/50/2000
  - Materials: all 4 material slots, including composite-brand detection (Trex, TimberTech)
- Scaffold instantiation
  - 11 slots per subtype
  - Footing count formulas correct per subtype
  - Railing fires 0 for ground_level (per code <30")
  - Stairs fires 0 for ground_level <6" off grade
  - Flashing fires for raised_attached + multi_level only
  - Finish/seal fires 0 for composite material; non-zero for PT/cedar/redwood/Ipe
- Provenance + KB invariants identical to kitchen/bath/outdoor-kitchen
- **NO PROJECT TOTAL** + **NO LLM IMPORT** invariants
- Render: subtype labels, height suffix when known, "dimensions pending" when null

---

## 7. Pre-push gate

```bash
npm run typecheck
npm run demo:v15-vertical-slice:esbuild
npm test                                # all tests pass; count in 775–790
git diff --check
```

---

## 8. Scope-check before push

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/v15-deck-*.ts
rg "process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)" src/examples/v15-vertical-slice/v15-deck-*.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/examples/v15-vertical-slice/v15-deck-*.ts
rg --pcre2 "amount.*\.toFixed|cents\s*\*|cents\s*\/(?!100)" src/examples/v15-vertical-slice/v15-deck-*.ts
rg -i "groqChat|whisperTranscribe|openai|anthropic" src/examples/v15-vertical-slice/v15-deck-*.ts
```

If `rg` isn't on PATH, note in PR description.

---

## 9. PR body template

```
feat(v15): deck archetype scope scaffold + outdoor-structure taxonomy

Two changes:

1) PROJECT_TYPE_TAGS expansion (src/projects/types.ts):
   adds 'deck', 'outdoor_kitchen', 'patio_or_hardscape' — closes
   the outdoor-structure archetype gap flagged in May dogfood. The
   outdoor_kitchen slot is reserved for the parallel outdoor-kitchen
   scaffold PR; patio_or_hardscape is reserved for future expansion.

2) Deck archetype scaffold mirroring PR #156 (kitchen) and #159 (bath).
   Four subtypes detected (ground_level / raised_attached /
   raised_freestanding / multi_level) with appropriate slot lists and
   quantity formulas.

11-slot template includes ledger-flashing and permits as non-skippable
lines for raised + multi-level subtypes. Water intrusion at ledger is
the #1 cause of deck-house failure; the line preserves the
consideration in audit.

Cost KB seed has 10 Decking rows (DECK-001 to DECK-010); tier-1 hits
fire on this archetype.

Architecture invariants preserved 1:1:
  - Deterministic only (regex + arithmetic; no LLM)
  - No project total computed (invariant test guards)
  - confidence locked to 'working_draft'
  - Per-line provenance preserved

Tests: 745 -> ~778 (+~33: 30 scaffold + 3 taxonomy).
Bundle: 362.6kb -> ~385kb.
```

---

## 10. What NOT to do

- ❌ Do not generalize archetype types into a shared abstraction.
- ❌ Do not add new CSS unless visual differentiation has a clear product reason.
- ❌ Do not add a project total.
- ❌ Do not skip the permits line — most jurisdictions require permits for any deck remodel.
- ❌ Do not skip flashing on `raised_attached` / `multi_level` (water-intrusion risk).
- ❌ Do not introduce jurisdiction-specific code lookups (frost-line depth, permit thresholds) — that's design-first work for a later PR.
- ❌ Do not build the `outdoor_kitchen` scaffold here — it's in the parallel outdoor-kitchen brief. You just add the taxonomy entry.
- ❌ Do not build the `patio_or_hardscape` scaffold here — taxonomy entry only.
- ❌ Do not touch `f35-draft-review.ts`, kitchen/bath/outdoor-kitchen scaffold files, Cost KB seed JSON.

---

## 11. Coordination notes

- **Taxonomy file `src/projects/types.ts` is shared with the outdoor-kitchen agent.** Both this PR and the outdoor-kitchen PR add entries. If outdoor-kitchen lands first, your PR rebases trivially (no conflict — different lines in the array). If you land first, outdoor-kitchen rebases.
- **`pages.ts` is shared.** Detection chain order: kitchen → bath → outdoor-kitchen → deck. Stage as the brief instructs; integration lead resolves chain order at PR review if races occur.
- **No conflict with material matcher PR.** That touches only `v15-cost-kb-seed.ts`.

---

## 12. Handoff back to integration lead

When CI is green:
1. Open the PR with the body above
2. Self-review summary covering:
   - Quantity formulas for each subtype (honest about heuristics)
   - Material callouts coverage
   - Permit + flashing slot rationale
   - Test count delta vs ~778 target (3 taxonomy + ~30 scaffold)
   - Whether you ran the §8 scope-check `rg` commands

Integration lead routes to ChatGPT + Codex (Codex back May 16) for second-opinion review before merge.
