# Cursor Agent Brief — Material-Specific Tier-1 Matcher

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15
- **Reference PRs:** #153 (cost-KB seed loader), #156 (kitchen scaffold using the lookup)
- **Branch from:** `main` (latest, after PR #157)
- **Target branch:** `feature/v15-material-specific-tier1-matcher`
- **Target test count after merge:** ~735–745 (was 715; bath PR adds ~30 → ~745 → this PR adds ~10 = ~755)
- **Estimated effort:** 2–3 hours

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

**Pricing-gate constraints (1:1 with `Pricing_Gate_v0_2`):**
- Only rows passing the existing `allowedPricingStatesFor()` filter are eligible
- `founder_review_required` is preserved per-row
- Material narrowing must NEVER widen pricing authority; if narrowing produces zero eligible rows, fall back to the trade-level result (current behavior)

---

## 2. Task summary

Narrow `lookupCostKbSeed` from trade-level to **material-level** when the operator's transcript names a specific material that matches a row's `item_name`. This is a single-file logic change in the lookup function, plus extended tests.

**The pain it solves:** Christian's 2026-05-13 dogfood read a transcript that mentioned "LVP flooring" and "quartzite countertops" but the F-34 / F-35 surfaces returned aggregate ranges across ALL flooring rows ($1–$165/SF, spanning vinyl plank to tropical hardwood) and ALL countertop rows. Material-specific narrowing tightens the operator-facing range from "useless" to "actionable."

---

## 3. The change in one paragraph

After the existing trade match in `lookupCostKbSeed`, scan the matched rows' `item_name` field for substrings that intersect with material-vocabulary terms appearing in the query's `scope_text`. When at least one row matches a named material, return ONLY those rows (then authority-sort + aggregate as today). When no material is named OR no row's `item_name` matches the named material(s), fall back to the current trade-level behavior.

**Critical:** narrowing must be conservative. Wrong narrowing produces a tighter but wrong range, which is worse for operator trust than a wider correct range. The fallback to trade-level on miss is the safety net.

---

## 4. Files to modify

### 4.1 `src/examples/v15-vertical-slice/v15-cost-kb-seed.ts`

In the existing `lookupCostKbSeed` function, between the trade-level filter and the authority sort, insert a material-narrowing pass.

Add a new top-level constant `MATERIAL_VOCAB` mapping canonical material terms to their detection patterns (case-insensitive). The vocabulary must cover materials already used in kitchen + bath scaffolds plus a few common GGR/Valle scopes:

```ts
// Per-trade material vocabulary. Patterns match BOTH the scope_text AND
// the row's item_name; a row is "material-matched" when at least one
// pattern from at least one named material matches its item_name AND
// that material is named in scope_text.
const MATERIAL_VOCAB: Record<string, readonly RegExp[]> = {
  // Flooring
  'LVP':                  [/\bLVP\b/i, /\bluxury vinyl(?:\s*plank)?\b/i, /\bvinyl plank\b/i],
  'hardwood':             [/\bhardwood\b/i, /\bsolid oak\b/i, /\bwhite oak floor\b/i],
  'engineered hardwood':  [/\bengineered (?:wood|hardwood)\b/i],
  'tile flooring':        [/\btile floor(?:ing)?\b/i, /\bceramic floor tile\b/i, /\bporcelain floor tile\b/i],
  // Countertops
  'quartzite':            [/\bquartzite\b/i],
  'quartz':               [/\bquartz(?!ite)\b/i],
  'granite':              [/\bgranite\b/i],
  'marble':               [/\bmarble\b/i],
  'soapstone':            [/\bsoapstone\b/i],
  'butcher block':        [/\bbutcher block\b/i],
  'laminate':             [/\blaminate\b/i],
  'solid surface':        [/\bsolid surface\b/i, /\bcorian\b/i],
  // Decking
  'composite decking':    [/\bcomposite (?:deck|decking)\b/i, /\btrex\b/i, /\btimbertech\b/i],
  'pressure-treated':     [/\bpressure[- ]treated\b/i, /\bPT (?:deck|decking)\b/i],
  'cedar':                [/\bcedar\b/i],
  'redwood':              [/\bredwood\b/i],
  'tropical hardwood':    [/\bipe\b/i, /\bcumaru\b/i, /\btigerwood\b/i, /\btropical hardwood\b/i],
  // Roofing
  'asphalt shingle':      [/\basphalt shingle\b/i, /\barchitectural shingle\b/i],
  'metal roof':           [/\bmetal roof\b/i, /\bstanding seam\b/i],
  'tile roof':            [/\btile roof\b/i, /\bclay tile\b/i, /\bconcrete tile roof\b/i],
};
```

Add a helper:

```ts
/**
 * Identify which canonical materials appear in `scope_text`. Returns the
 * set of material keys (e.g., {"LVP", "quartzite"}) named in the text.
 * Empty set when no known material is mentioned.
 */
function materialsNamedInScope(scopeText: string): ReadonlySet<string> {
  const named = new Set<string>();
  for (const [material, patterns] of Object.entries(MATERIAL_VOCAB)) {
    for (const p of patterns) {
      if (p.test(scopeText)) {
        named.add(material);
        break;
      }
    }
  }
  return named;
}

/**
 * For a candidate row, does its `item_name` match any of the named
 * materials? A material is considered to match the row when at least one
 * of its detection patterns matches the row's item_name.
 */
function rowMatchesNamedMaterials(
  row: KerfCostKbSeedRow,
  namedMaterials: ReadonlySet<string>,
): boolean {
  if (namedMaterials.size === 0) return false;
  const itemName = row.item_name ?? '';
  if (itemName.length === 0) return false;
  for (const material of namedMaterials) {
    const patterns = MATERIAL_VOCAB[material];
    if (patterns === undefined) continue;
    for (const p of patterns) {
      if (p.test(itemName)) return true;
    }
  }
  return false;
}
```

Modify the body of `lookupCostKbSeed` so that after the existing trade-level filter (the loop that builds `matches`), it does:

```ts
// PR #158 (planned): material-specific narrowing. When the scope text
// names a known material AND at least one matched row's item_name
// matches that material, narrow to just those rows. When narrowing
// produces zero rows, fall back to the trade-level matches (safety net
// per the brief: a tighter-but-wrong range is worse than a wider correct
// range for operator trust).
const namedMaterials = materialsNamedInScope(query.scope_text);
let narrowedMatches: KerfCostKbSeedRow[] = matches;
let materialNarrowed = false;
if (namedMaterials.size > 0) {
  const materialOnly = matches.filter((r) => rowMatchesNamedMaterials(r, namedMaterials));
  if (materialOnly.length > 0) {
    narrowedMatches = materialOnly;
    materialNarrowed = true;
  }
}
// Then the existing authority-rank sort + aggregation runs against
// `narrowedMatches` instead of `matches`.
```

Extend `KerfCostKbLookupHit` with a new field so downstream consumers (debug overlay, future audit) can surface the narrowing decision:

```ts
export interface KerfCostKbLookupHit {
  // ...existing fields...
  /**
   * True when material-specific narrowing fired (one or more named
   * materials in scope_text matched at least one row's item_name).
   * False when the result reflects the trade-level set (no material
   * named OR no row's item_name matched the named material).
   * Used by debug overlays and future audit; NOT used to widen pricing
   * authority.
   */
  readonly material_narrowed: boolean;
  /**
   * The named materials that drove the narrowing decision. Empty when
   * material_narrowed is false. Sorted alphabetically for stable output.
   */
  readonly narrowed_materials: readonly string[];
}
```

Populate these fields in the return statement.

Also update `formatDebugOverlayForHit` to include the narrowing info:

```ts
export function formatDebugOverlayForHit(hit: KerfCostKbLookupHit): string {
  const refs = hit.source_ref_ids.slice(0, 3).join(', ');
  const more = hit.source_ref_ids.length > 3 ? ` +${hit.source_ref_ids.length - 3}` : '';
  const conf = hit.max_confidence.toFixed(2);
  const matBadge = hit.material_narrowed
    ? `·mat=${hit.narrowed_materials.join(',')}`
    : '';
  return `tier1·${hit.trade}·${hit.rows.length}row·conf=${conf}${matBadge}·refs=${refs}${more}`;
}
```

### 4.2 `tests/v15-cost-kb-seed.test.ts`

Extend the existing test file with ~10 new tests. Cover:

- **Narrowing fires:** when scope_text contains "LVP flooring" and the seed has Flooring rows whose `item_name` matches LVP patterns, the hit's `rows` should ONLY include those rows. `material_narrowed === true`. `narrowed_materials` contains `"LVP"`.
- **Narrowing fires on multiple materials:** when scope_text mentions both "quartzite" and "LVP" (different trades), each separate `lookupCostKbSeed` call (per trade) narrows correctly.
- **Fallback on miss:** when scope_text contains "purpleheart flooring" (a material NOT in `MATERIAL_VOCAB`), the result reflects the trade-level set (current behavior) and `material_narrowed === false`.
- **Fallback when no row matches:** when scope_text contains a known material (e.g., "marble flooring") but the seed has no Flooring row with "marble" in item_name, fall back to trade-level. `material_narrowed === false`.
- **No material named:** when scope_text contains no `MATERIAL_VOCAB` term, behavior is unchanged from PR #153. `material_narrowed === false`, `narrowed_materials` is empty.
- **Authority-rank sort still applies after narrowing:** when narrowing returns multiple rows, they're still sorted by `authority_rank` ascending. (Today the seed is all KERF_SEED rank 5; this test locks the contract for when tenant project-actual rows arrive at rank 1.)
- **Pricing-state gate still applies after narrowing:** a BLOCKED row that would otherwise match the material MUST NOT be returned. (Existing synthetic-manifest test pattern.)
- **`formatDebugOverlayForHit` includes `mat=...` segment when narrowed:** check the debug overlay string contains the named materials.
- **`formatDebugOverlayForHit` omits `mat=` segment when not narrowed:** the existing debug overlay format is preserved when narrowing doesn't fire.

---

## 5. Pre-push gate (all must pass)

```bash
npm run typecheck
npm run demo:v15-vertical-slice:esbuild
npm test                                # all tests pass; count ~755
git diff --check
```

---

## 6. Scope-check before push (zero hits required)

```bash
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/examples/v15-vertical-slice/v15-cost-kb-seed.ts
rg "process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)" src/examples/v15-vertical-slice/v15-cost-kb-seed.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/examples/v15-vertical-slice/v15-cost-kb-seed.ts
```

---

## 7. PR body template

```
feat(v15): material-specific tier-1 cost-KB matcher

Narrows lookupCostKbSeed from trade-level to material-level when the
scope_text names a known material that matches a row's item_name.

Concrete impact on Christian's 2026-05-13 dogfood transcript:
  Before: "LVP flooring" → range across ALL flooring rows ($1-$165/SF)
  After:  "LVP flooring" → range across LVP rows only (~$5-$15/SF)

Conservative narrowing: when narrowing produces zero rows, falls back
to trade-level (a wider correct range > a tighter wrong range for
operator trust). Pricing-state gate + authority-rank sort + founder-
review-required preservation are unchanged.

Two new fields on KerfCostKbLookupHit: material_narrowed (bool) and
narrowed_materials (string[]) — used by debug overlay and future audit.
formatDebugOverlayForHit appends "mat=<materials>" segment when fired.

Scope:
  - One product file: v15-cost-kb-seed.ts
  - Tests extended in v15-cost-kb-seed.test.ts (~10 new)
  - No new files, no new endpoints, no schema migration
  - Material vocabulary covers kitchen + bath + decking + roofing today;
    extend in future PRs as new archetypes land

Tests: ~745 -> ~755 (+10). Bundle: minimal delta (text-only addition).
```

---

## 8. What NOT to do

- ❌ Do not add an LLM-based material classifier. The match is deterministic regex over a vocabulary; that's it.
- ❌ Do not modify the `MATERIAL_VOCAB` for any material not currently in the kitchen + bath archetype detectors PLUS the four trades above (decking, roofing, etc.). Material vocab grows with archetype coverage; don't pre-seed.
- ❌ Do not change the public signature of `lookupCostKbSeed` beyond the additive fields on `KerfCostKbLookupHit`.
- ❌ Do not modify the cost-KB seed JSON file.
- ❌ Do not introduce a new debug-overlay format string; extend the existing one.
- ❌ Do not touch `v15-kitchen-*` or `v15-bath-*` files — they consume `lookupCostKbSeed` and benefit automatically.
- ❌ Do not generalize into a separate "material classifier module." Keep it inline in `v15-cost-kb-seed.ts`.

---

## 9. Coordination notes

- **No file conflict with bath PR.** Bath touches `v15-bath-*.ts`, `pages.ts`, `tests/v15-bath-*.test.ts`. This PR touches `v15-cost-kb-seed.ts` and `tests/v15-cost-kb-seed.test.ts`. Both can ship in either order.
- **Bath consumes this automatically once it lands.** When narrowing fires, bath's tier-1 grounding tightens immediately (no bath-side changes needed).
- **Kitchen consumes this automatically too** — same channel, same benefit.

---

## 10. Handoff back to integration lead

When CI is green:
1. Open the PR with the body above
2. Self-review summary covering:
   - Material vocab coverage (which materials × patterns × trades are in)
   - Test count delta vs ~755 target
   - Confirmation that narrowing falls back to trade-level on miss (the safety contract)
3. Ping back; integration lead routes to ChatGPT + Codex (Codex back May 16) for second-opinion review before merge

If you find that the existing seed JSON has zero rows for any narrowed material (e.g., LVP rows missing from Flooring entirely), flag in the PR body — that's a seed-data gap, not a logic bug, and the fallback handles it gracefully but it's worth noting for the curator queue.
