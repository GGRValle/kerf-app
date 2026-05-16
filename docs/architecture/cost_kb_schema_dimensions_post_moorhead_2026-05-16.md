# Cost-KB Schema Dimensions — Findings from the Moorhead Pulse Test

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **Audience:** Christian, Codex (next review pass), downstream builders
- **Status:** Design proposal. **No code in this PR.** Captures the four schema dimensions surfaced by the first run of the Moorhead pulse test (operator-authored, see `Moorhead_Scope_PulseTest.md.gdoc`) before the details fade.
- **Pulse-test scope under test:** Moorhead Kitchen Remodel (San Diego), narrative prose → estimated price; ground truth = operator's internal pricing v3 xlsx + proposal v2 ($74,900 sell, $42,440 cost, 40.7% blended GM).

---

## 1. Why this exists

The Moorhead pulse test produced a 14.5% point-estimate miss (my $64k vs operator's $74,900) with the range bracketing correctly ($54k–$78k). The macro number was directionally fine. **What the test surfaced is that the cost_row schema today doesn't carry the dimensions the operator's working pricing model implicitly uses.** Without those dimensions explicit:

- The validator cannot compare rates apples-to-apples against KB ranges
- "In-range" / "out-of-range" checks are structurally noisy
- Frontier-model inference smooths over the missing dimensions in ways the deterministic core can't replicate

The deterministic-core-with-LLMs-at-edges architecture only delivers on its reliability promise when the schema carries enough resolution that lookups produce real signal. Today the schema doesn't. This doc pins what needs to be added.

**This is canon-shape work, not feature work.** It will land as a schema extension + a tier-1 backfill + a `lookupCostKbSeed` integration sketch + a `validateProposal` cross-check, all of which are subsequent PRs after Codex review.

---

## 2. The four dimensions surfaced

Each was a real-world category error during the Moorhead exercise where Claude (or the system, depending on how it would have been wired) compared values that lived in different conceptual cells without knowing they were different cells.

### 2.1 `scope_inclusion` — what's IN the price

**The miss:** Compared Moorhead's `$45/SF` quartzite line against tier-1 KB row CTP-005 `$57–$170/SF` and concluded the rate was "below the range — preferred fabricator override." Reality: the Moorhead line is **labor only** (owner provides slab); CTP-005 is **installed-full** (materials + fab + install). Different scopes, same trade. The rates aren't comparable.

**Allowlist values:**
```ts
export type ScopeInclusion =
  | 'materials_only'    // just the materials, no labor (e.g., walnut veneer $175/sheet)
  | 'labor_only'        // install/fab labor; materials provided by another party
                        // (e.g., Moorhead quartzite $45/SF, owner-provides slab)
  | 'installed_full'    // materials + labor (e.g., tier-1 CTP-005 quartzite range)
  | 'subscope';         // narrower than installed_full (e.g., fab only, no install)
```

**Tier-1 backfill implication:** All 13 existing cost_row entries need an explicit `scope_inclusion` value. The labels today imply a value but don't carry it. Founder review per row.

---

### 2.2 `delivery_mode` — WHO does the work

**The miss:** The Moorhead `$18/SF` backsplash labor-only rate is valid **if it's in-house GGR crew**. If subcontracted, the same physical work would cost ~$30/SF (sub-quoted) and sell at ~$46/SF (sub cost × markup). Same scope, same scope_inclusion, **same $/SF unit, three completely different price bands depending on who does the work.**

The system has to know the delivery mode to make the comparison.

**Allowlist values:**
```ts
export type DeliveryMode =
  | 'self_perform'        // GGR's own crew, internal loaded rate
  | 'valle_internal'      // Valle's shop, pass-through OR retail per business rule (§2.4)
  | 'hpg_internal'        // Heat Pump Guys — own brand, own crew
  | 'subcontracted'       // outside trade sub; sub cost + GGR markup
  | 'allowance';          // owner-allocated; pre-purchase budget; no markup
```

**Critical interaction with markup_basis (§2.3):** `subcontracted` lines mark up the sub's rate; `self_perform` lines apply the GGR margin to the GGR loaded cost. Different math.

---

### 2.3 `markup_basis` — HOW sell is derived from cost

**The miss:** Treated all GGR-side sell prices as `cost / (1 - 0.35)` (margin-based pricing). Reality: subcontracted lines use a different math — sub's invoiced rate × a markup multiplier (often ~1.35–1.5×, but not the same as margin). The same numerical result might land, but the **derivation matters** because it determines what changes when the underlying cost changes.

**Allowlist values:**
```ts
export type MarkupBasis =
  | 'margin'           // cost / (1 - gm_target); GGR self-perform standard
                       // Example: $1,000 cost / (1 - 0.35) = $1,538 sell
  | 'markup_on_sub'    // sub_cost × markup_multiplier; subcontracted lines
                       // Example: $1,000 sub cost × 1.45 = $1,450 sell
  | 'pass_through';    // sub_cost as-is; no markup (Valle Dunne-style)
                       // Example: $1,000 Valle internal cost = $1,000 sell
```

**Why this matters operationally:** when a sub raises their rate by 10%, a `markup_on_sub` line moves the sell by the same 10%; a `margin` line moves the sell by more than 10% (because margin compounds). The audit needs to know which derivation the operator used to surface the right "your sub raised; here's what changes" signal.

---

### 2.4 `business_unit_margin_pct` — margin canon per business unit

**The miss:** Treated Valle as pass-through-at-cost based on the Dunne fixture. Moorhead is Valle at **45% retail GM** (per the operator's internal pricing v3, row C9 of the Rates & Assumptions sheet). Two different conventions, same business unit (Valle), depending on project context. Without an explicit canon row stating which mode applies to which project class, the system has no way to choose correctly.

**Proposed canon rows (first concrete delivery):**

```ts
// Row 1
{
  cost_row_id: 'MGN-VALLE-001',
  source_layer: 'TENANT_MEMORY',
  authority_rank: 2,
  rule_kind: 'business_unit_margin',
  tenant_id: 'tenant_ggr',
  business_unit: 'Valle Custom Cabinetry',
  billing_mode: 'retail_45',
  gm_target: 0.45,
  applies_when: 'client_facing_proposal_with_valle_scope',
  notes: 'Valle direct retail GM. Standard convention for external client-facing
          GGR/Valle proposals. Distinct from MGN-VALLE-002 (pass-through context).',
  curator_review_status: 'APPROVED_CLIENT_VISIBLE',
  founder_review_required: true,
}

// Row 2
{
  cost_row_id: 'MGN-VALLE-002',
  source_layer: 'TENANT_MEMORY',
  authority_rank: 2,
  rule_kind: 'business_unit_margin',
  tenant_id: 'tenant_ggr',
  business_unit: 'Valle Custom Cabinetry',
  billing_mode: 'pass_through',
  gm_target: 0.0,
  applies_when: 'shared_ownership_internal_pricing',
  notes: 'Pass-through at cost for shared-ownership / favor-pricing contexts.
          Dunne-fixture convention. NOT default; explicit operator selection required.',
  curator_review_status: 'APPROVED_DOGFOOD',
  founder_review_required: true,
}

// Row 3
{
  cost_row_id: 'MGN-GGR-001',
  source_layer: 'TENANT_MEMORY',
  authority_rank: 2,
  rule_kind: 'business_unit_margin',
  tenant_id: 'tenant_ggr',
  business_unit: 'GGR design + remodeling',
  billing_mode: 'retail_35',
  gm_target: 0.35,
  applies_when: 'ggr_gc_scope_self_performed',
  notes: 'GGR self-perform GC scope standard margin. Applies to demo, framing,
          drywall, paint, electrical-coordination, PM. Matches Dunne cost sheet
          + Moorhead internal pricing.',
  curator_review_status: 'APPROVED_CLIENT_VISIBLE',
  founder_review_required: true,
}
```

These are the **first three canon rows** that emerge from tonight's pulse test. Smallest concrete delivery. Each is one row in a tier-2 batch ingestion through PR #186.

---

### 2.5 `implied_subscope_trigger` — bonus dimension (caught by operator, not by Claude)

**The miss:** Moorhead's narrative scope said "owner-provided refrigerator" and "expansion into the dining room for the refrigerator position." It did **not** say "needs water line." The operator's actual proposal v2 + internal pricing both carry a `$285 cap existing line + $395 new fridge line` plumbing scope. Claude missed it because the scope didn't name plumbing.

**A reliable system would carry an `implied_subscope_trigger` ruleset:**

```ts
// Example (one of many)
{
  cost_row_id: 'IMP-FRIDGE-001',
  source_layer: 'KERF_SEED',     // could also be TENANT_MEMORY for tenant-specific rules
  rule_kind: 'implied_subscope',
  trigger: 'refrigerator_relocation_or_install',
  implies: [
    'water_supply_line_to_new_position',
    'verify_cap_required_at_old_position',
  ],
  prompt_to_operator: 'Does the new refrigerator position need a water line for an
                       ice/water dispenser? Is there an existing line at the old
                       position that needs to be capped?',
  notes: 'Catches gap-detection misses where the named scope (fridge) implies
          unnamed subscope (water).',
  founder_review_required: true,
}
```

This dimension is less mature than the other four. Listed here as a **direction**, not yet a finished schema proposal. Belongs in a follow-up doc once 5-10 real triggers are catalogued from accumulated pulse-test runs.

---

## 3. Schema extensions to `cost_row`

Today's `KerfCostKbSeedRow` shape (in `src/examples/v15-vertical-slice/v15-cost-kb-seed.ts`) is missing the four dimensions in §2. Proposed extensions:

```ts
export interface KerfCostKbSeedRow {
  // ... existing fields (cost_row_id, trade, item_name, uom, range_low_cents,
  //                     range_high_cents, default_cost_cents, authority_rank,
  //                     pricing_basis_state, curator_review_status, etc.)

  // NEW FIELDS (post-Moorhead):
  readonly scope_inclusion: ScopeInclusion;            // §2.1
  readonly delivery_mode: DeliveryMode;                // §2.2
  readonly markup_basis: MarkupBasis;                  // §2.3
  /** Only meaningful when rule_kind === 'business_unit_margin'. */
  readonly business_unit?: string;
  readonly billing_mode?: string;
  readonly gm_target?: number;
  /** New row kind: rule rows live alongside trade rows. */
  readonly rule_kind?: 'trade_rate' | 'business_unit_margin' | 'implied_subscope';
  /** Schema migration: existing rows default to 'trade_rate'. */
}
```

### 3.1 Migration plan for existing tier-1 rows

All 13 current `KERF_SEED` rows need explicit values in the three new dimensions:

| Existing row | scope_inclusion | delivery_mode | markup_basis | Notes |
|---|---|---|---|---|
| FLR-001 LVP material | `materials_only` | n/a (no delivery) | n/a | Material price |
| CTP-005 Quartzite installed | `installed_full` | unspecified — needs founder ruling | n/a | The row that started the whole pulse-test thread |
| FLR-008 Old flooring tear-out | `labor_only` | `subcontracted` (typically) | `markup_on_sub` | |
| CTP-007 Old CT removal | `labor_only` | `subcontracted` | `markup_on_sub` | |
| INS-005 Insulation removal | `labor_only` | `subcontracted` | `markup_on_sub` | |
| (and 8 others) | TBD per founder review | TBD | TBD | |

Backfill is operator work — Christian reviews each existing row and assigns the dimensions. ~20-30 minutes for the 13 rows. Founder-review-required already a property of every row; this fits the existing curator gate.

---

## 4. Schema extensions to `ProposalLineItem`

`src/proposal/types.ts` `ProposalLineItem` carries `is_materials_taxable: boolean` today but no `scope_inclusion` or `delivery_mode` flags. Both should be added:

```ts
export interface ProposalLineItem {
  // ... existing fields ...

  readonly scope_inclusion: ScopeInclusion;
  readonly delivery_mode: DeliveryMode;
  readonly markup_basis: MarkupBasis;
  /** When the line is subcontracted, the sub's invoiced cost (informational). */
  readonly sub_cost_cents?: number;
  /** When markup_basis === 'markup_on_sub', the markup multiplier applied. */
  readonly sub_markup_multiplier?: number;
}
```

The `is_materials_taxable` field is orthogonal — it's about tax treatment, not scope or delivery. Keep it.

---

## 5. `lookupCostKbSeed` integration with `validateProposal`

Today these two layers don't talk:
- `lookupCostKbSeed(scaffoldLine)` returns a `LookupHit | LookupMiss` for the operator-facing decision card (cost KB tier-1 + tier-2 layered).
- `validateProposal(proposal)` enforces math + tenant + §7159 + state machine. **Does not consult the cost KB.**

**Proposed wiring (next PR after schema extensions land):**

```ts
function validateProposal(input: unknown): ValidationResult<ProposalArtifact> {
  // ... existing validation ...

  // NEW: for each line, look up matching-scope KB rows and emit a warning
  // if the line's unit_cents falls outside the band (NOT a hard block —
  // operator-asserted rates are allowed; out-of-range is informational).
  for (const division of proposal.divisions) {
    for (const section of division.sections) {
      for (const line of section.lines) {
        const hit = lookupCostKbSeed({
          trade: division.label, // or finer-grained trade extraction
          uom: line.uom,
          scope_inclusion: line.scope_inclusion,
          delivery_mode: line.delivery_mode,
        });
        if (hit.kind === 'no_matching_scope_row') {
          warnings.push(
            `${line.line_id}: no matching-scope KB row for (` +
            `${line.scope_inclusion} × ${line.delivery_mode}); ` +
            `operator-asserted rate, no cross-check possible.`
          );
        } else if (hit.kind === 'out_of_range') {
          warnings.push(
            `${line.line_id}: rate ${formatDollars(line.unit_cents)}/${line.uom} ` +
            `outside KB range ${formatDollars(hit.range_low)}–${formatDollars(hit.range_high)} ` +
            `for matching scope; confirm or document rationale.`
          );
        }
      }
    }
  }

  // Existing errors path...
}
```

The honest **third state** ("no matching-scope KB row exists") is what differentiates a reliable system from a system that pretends to validate. When the schema dimensions are explicit, this state surfaces naturally.

---

## 6. The "no matching-scope KB row" state — why it matters

A reliable system says one of three things on every line:

| State | Meaning | Operator action |
|---|---|---|
| ✅ **in-range** | Line within KB band for matching scope | None required |
| ⚠️ **out-of-range** | Line outside band for matching scope | Confirm or document rationale |
| ⚪ **no-matching-scope-row** | No KB row exists for this (scope_inclusion × delivery_mode) combination | Operator-asserted rate; system cannot validate; documentation falls to operator |

**The third state is the honest state for most lines on Moorhead today.** Until tier-2 KB carries labor-only / sub-quoted / valle-internal rows, most Moorhead lines have nothing to cross-check against. Telling the operator that clearly is more valuable than pretending to validate.

A system that **only** emits in-range / out-of-range — without the no-matching-scope-row state — is structurally biased toward false confidence. It will green-light lines whose scope simply doesn't have a comparable KB row, because the lookup falls through to "no signal" and the validator interprets no signal as no problem. That's the Pulse Point 4 failure mode the test surfaced tonight.

---

## 7. The thesis question (acceptance frame)

From `field_daily_workflow_design_2026-05-15.md` §12.6:

> *Can Kerf turn daily field behavior into office action with almost no extra typing?*

The Moorhead pulse test extends the thesis to the proposal layer:

> *Can Kerf produce a first-pass proposal estimate that lands inside the operator's trust range without frontier-model inference in the pricing path?*

Tonight: **no, not yet.** The pattern reached the range; the deterministic dimensions weren't carrying enough data to do it without inference.

After:
- §2.1–§2.4 schema dimensions land in cost_row + ProposalLineItem
- Tier-1 backfilled to carry explicit dimensional values
- Three Valle/GGR margin canon rows ingested (§2.4)
- Moorhead internal pricing v3 ingested as tier-2 actuals (operator's 30-min task)
- `lookupCostKbSeed` wired into `validateProposal` with the no-matching-scope-row state

→ **Yes, on the next kitchen-of-similar-scope project, with the deterministic core.**

That's the loop. Each pulse-test iteration closes one or two dimensions until the schema reaches the resolution where deterministic-first-pass is reliable.

---

## 8. What this doc does NOT include

- Code (this is design only)
- Final allowlist values (the lists in §2 are first drafts; Codex review may add or rename)
- Migration scripts for tier-1 backfill (operator-side ingestion through PR #186 once founder reviews each row)
- Granular tier-1 row-by-row classification (§3.1 starts the table; founder fills it in)
- `implied_subscope_trigger` schema (§2.5 is a direction, not a finished proposal — needs ~5-10 real triggers catalogued first)
- The "Moorhead pricing v3 → tier-2 ingestion" task (operator-side action, not in scope here)

---

## 9. Decision needed (post-Codex-review)

Three things needed from operator + Codex before schema work starts:

1. **Approve the four dimensions** (`scope_inclusion`, `delivery_mode`, `markup_basis`, `business_unit_margin_pct`) or refine the allowlist values
2. **Approve the three canon rows** for Valle 45% retail + Valle pass-through + GGR 35% (§2.4)
3. **Approve the lookup-validator wiring posture** — warning-only on out-of-range and no-matching-scope-row, not hard-block

Once these are locked, the implementation path is:
- Schema extension PR (cost_row + ProposalLineItem types + validators) — ~3h
- Tier-1 backfill (operator review × 13 rows) — ~30 min operator work
- Three canon rows ingested through PR #186 — ~15 min operator work
- `lookupCostKbSeed → validateProposal` wiring PR — ~2h
- Total: ~5-6h focused work + ~45 min operator review

The leverage: every subsequent pulse test runs against a sharper substrate. The structural gaps that surfaced tonight close once. The next gaps will be different — that's the iteration the operator described.

---

## 10. Provenance

This doc was synthesized from a live operator-Claude conversation on 2026-05-16 (post-midnight) running through:
- The Moorhead pulse test (`Moorhead_Scope_PulseTest.md.gdoc`)
- The operator's internal pricing v3 (`Moorhead_Kitchen_Internal_Pricing_v3.xlsx`)
- The operator's client-facing proposal v2 (`Moorhead_Kitchen_GGR_Proposal_v2.gdoc`)
- Operator clarifications on Valle margin convention (Dunne pass-through vs Moorhead 45% retail)
- Operator clarification on quartzite line being labor-only (not full-installed)
- Operator clarification on in-house vs subcontracted labor distinction

The pulse-test instrument did what it was built to do: surface structural schema gaps under load. This doc is the artifact of one run. Future runs will produce sibling docs.
