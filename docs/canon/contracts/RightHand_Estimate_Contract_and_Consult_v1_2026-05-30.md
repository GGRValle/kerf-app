# Right Hand · Estimate Information Contract + Consult Script · v1

**Date:** 2026-05-30 · **Status:** DRAFT for founder review · **Scope:** the estimate-producing path (GGR remodel/addition proposal). Build-facing.
**Companion:** `RightHand_Storage_Learning_Isolation_Canon_v1_2026-05-30.md` (the backend half).
**Grounded in:** the GGR/Valle estimating canon (19-phase structure, 35% embedded GM, fixture-exclusion-by-default, CA payment rules, confirmed rate overrides).

---

## 0. The pin — where the rigor lives

The owner speaks freely. Voice-led capture is the permissive front door (D-050) — nobody fills a rigid form. **The determinism lives in the output contract and the exit-door verification, not in how the user talks.** "Forcing intake through a typed schema" means the *sub-agents' returned field set* and the *persisted record* are typed and complete-checked — it does **not** mean the consult is a form. Read every field below as the agents' obligation, not the owner's.

This is the three-door model (D-049): permissive front · parse middle · strict exit. The estimate contract is the strict-exit shape; the consult and voice capture are the permissive front.

---

## 1. The four consumers — why the schema earns its keep

Every field must serve at least one of these four. **A field that serves none does not belong.** That is the honesty check on the whole artifact.

1. **The consult** — the conversational script the owner runs peer-to-peer at the walkthrough (Section 4). Each consult prompt exists to populate named fields.
2. **The proposal / cost-sheet generator** — every load-bearing field maps to an input the GGR proposal and internal cost sheet need (19-phase line items, allowances, exclusions, margin, payment schedule).
3. **The local-model training set** — every completed, well-formed record is a clean typed example. Determinism compounds: the better the contract is enforced now, the less the trained local agents drift later (validated by the 2026-05-30 isolation research — only content-free structure trains the shared models; tenant records train *that tenant's* Right Hand).
4. **The audit log** — every field carries provenance and state, so the chain is inspectable: which field, which source, which check passed. Trust the document, verify via the log.

---

## 2. The schema — column-shaped so the JSON is a mechanical extraction

Columns: **field** · **type** · **allowed values / shape** · **field state** (the per-field truth state) · **provenance class** (where the value came from) · **consumers** (1 consult · 2 generator · 3 training · 4 audit).

**Field-state vocab** (anchored to existing canon — gap-flag pattern, D-043 use-labels, lifecycle states):
`confirmed` (owner/Christian-set, authoritative) · `tenant_rule` (a standing GGR rule, e.g. fixture exclusion) · `market_verified` (web-checked, carries source+date) · `measured` (LiDAR/tape, carries a use-label: estimate-safe / verify-before-release / manual-required per D-043) · `allowance` (owner-to-select, subject to change) · `assumed` (default applied, flagged) · `stale` (past its freshness window) · `missing` (gap-flag — **blocks** proposal generation).

**Provenance class** (anchored to D-035 evidence-source-class): `owner_confirmed` · `tenant_rule` · `market_search` · `sub_quote` · `lidar_measure` · `client_stated` · `model_inferred`.

> **Every field and record also carries the universal stored-fact envelope** defined in the companion canon (`RightHand_Storage_Learning_Isolation_Canon_v1` §1): `tenant_id` · `locality` · `source_class` · `source_refs` · `state` · `freshness` · `visibility` · `consequence_tier` · `training_eligibility` · `schema_version` · `promotion_status`. The `state` and `source_class`/`source_refs` columns below ARE the estimate-path instance of that envelope. For estimate facts: `locality = tenant_private` (a tenant's prices/rates/scope never cross), `training_eligibility = tenant_private_only` (trains that tenant's Right Hand, never a shared model), `consequence_tier` follows the line item (a money-bearing `unit_cost` is `money`; the proposal send is `irreversible`). Note `source_class` here uses the **D-035 pricing ranking** (priced line items) — distinct from `PROJECT_EVIDENCE` (operational evidence); see the canon envelope §1.

### 2.1 Project & client (proposal header + client block)

| field | type | allowed values / shape | field state | provenance | consumers |
|---|---|---|---|---|---|
| `entity` | enum | GGR · Valle · both | confirmed | owner_confirmed | 1·2·3·4 |
| `project_type` | enum | remodel · addition · insurance_restoration · cabinet_only · full_kitchen · bath | confirmed | client_stated/owner_confirmed | 1·2·3·4 |
| `design_tier` | enum | budget · mid · high_end | confirmed/assumed | owner_confirmed | 1·2·3 |
| `client.name` | string | — | confirmed | client_stated | 2·4 |
| `client.address` | string | street/city/state/zip | confirmed | client_stated | 2·4 |
| `project.address` | string | — | confirmed | client_stated | 2·4 |
| `project.summary` | text | scope narrative (1 para) | model_inferred→confirmed | model_inferred | 2·3 |

### 2.2 Scope & measurements (drives line items)

| field | type | allowed values / shape | field state | provenance | consumers |
|---|---|---|---|---|---|
| `rooms[]` | list | room_type + dimensions | measured/missing | lidar_measure/client_stated | 1·2·3 |
| `rooms[].measurements` | object | SF · LF · ceiling_ht · counts | measured (+use-label) | lidar_measure | 2·3·4 |
| `scope_items[]` | list | per-phase work descriptions | confirmed/missing | client_stated/owner_confirmed | 1·2·3 |
| `scope_items[].phase` | enum | 01–19 (GGR phase labels) | confirmed | tenant_rule | 2·3 |
| `phasing_constraints` | text | sequencing notes | assumed | owner_confirmed | 2 |

### 2.3 Pricing & cost (internal cost sheet → sell price)

| field | type | allowed values / shape | field state | provenance | consumers |
|---|---|---|---|---|---|
| `line_items[]` | list | phase · description · qty · unit · raw_cost_cents · sell_price_cents | market_verified/confirmed/missing | market_search/sub_quote/owner_confirmed | 2·3·4 |
| `line_items[].line_type` | enum | `labor` · `material` · `product` · `allowance` · `subcontract` · `equipment` · `markup` · `fee` | confirmed | owner_confirmed/tenant_rule | 2·3·4 |
| `line_items[].unit_cost` | int cents | — | market_verified (source+date) **or** confirmed (override) | market_search/owner_confirmed | 2·3·4 |
| `labor_rates{}` | map | trade → rate | confirmed (e.g. tile $40/SF) else market_verified | tenant_rule/market_search | 2·3·4 |
| `margin.gm_pct` | number | GGR 35% · insurance 10/10 · Valle pass-through 0 | tenant_rule | tenant_rule | 2·4 |
| `pricing_provenance[]` | list | per unit cost: source + date | market_verified/stale | market_search | 4 |

> Money is integer **cents** everywhere (architecture lock). Margin is never a client-visible line.

> **`line_type` is issue-#0 foundation** (per the Houzz lessons analysis). It is the discriminator the downstream features depend on — per-line invoicing, Selections auto-promotion, CSI grouping, reconciliation. Behavior:
> - **Only `material` · `product` · `equipment` · `subcontract` lines may become Selections.** `labor` lines never promote to Selections. `allowance` lines have their own behavior (owner-to-select, subject to change — D-044).
> - **Invoicing: store cents, render percent.** `invoiced_amount_cents` is canonical; `invoiced_pct` is **derived for display only.** Percent-as-canonical leaks penny drift into reconciliation, the place trust is most fragile. (Same money-cents lock.)
> - `line_type` is orthogonal to `phase` (a phase 13 cabinetry line can be `product` or `labor`); both are carried.

### 2.4 Allowances, exclusions, terms

| field | type | allowed values / shape | field state | provenance | consumers |
|---|---|---|---|---|---|
| `allowances[]` | list | item · selection_note · amount_cents | allowance | owner_confirmed/market_search | 2·4 |
| `exclusions[]` | list | standard set + project-specific | tenant_rule | tenant_rule | 2·4 |
| `fixtures_owner_furnished` | bool | default **true** (GGR core rule) | tenant_rule | tenant_rule | 2·4 |
| `payment_schedule` | object | down (≤$1k or 10%) · progress draws · **final ≤5%** | tenant_rule | tenant_rule | 2·4 |
| `permits` | enum | included_line · excluded | confirmed/assumed | owner_confirmed | 2·4 |

---

## 3. The information contract — "complete enough to generate a proposal"

This is the centerpiece (per `feedback_dispatch_brief_name_deterministic_rules` — name the deterministic rule, don't fold it into "be thorough"). The estimate sub-agent is dispatched with an explicit obligation: **populate these fields, against the deterministic flow, because they feed the proposal.** Depth is *specified*, not hoped.

**REQUIRED to generate a GGR proposal (the pre-proposal check verifies all are present and none `stale`/`missing`):**

- `entity`, `project_type`, `design_tier`
- `client.name`, `client.address`, `project.address`
- at least one `rooms[]` with `measurements` (state `measured` or explicitly `allowance`-noted)
- `scope_items[]` covering every phase in scope, each tagged to a phase 01–19
- `line_items[]` for every scope item, each with a `unit_cost` in state `confirmed` or `market_verified` (a `market_verified` cost older than its freshness window flips to `stale` and re-blocks)
- `labor_rates{}` for every trade touched (confirmed override or market_verified)
- `margin.gm_pct` resolved per entity/project_type (35 / 10-10 / pass-through)
- `allowances[]` for every owner-select item in scope
- `exclusions[]` present, with `fixtures_owner_furnished` defaulted true unless owner overrode
- `payment_schedule` computed with final retention ≤ 5%

**The pre-proposal completeness check (deterministic, runs in the background during "Right Hand is drafting"):**
> For each required field: present? · state ∈ {confirmed, tenant_rule, market_verified(fresh), measured, allowance}? · if `missing`/`stale`/`unknown` → **do not generate**; surface a gap list ("I still need the shower measurements and a verified tile labor rate"). Gap-flagged is the correct answer when data is insufficient (`feedback_trust_first_precision_later`); a fabricated number is not.

This is what defeats the satisfice problem **architecturally**: the load-bearing retrieval is a structured contract fulfilled by sub-agents and verified deterministically — not a cloud agent asked to "go deep" and trusted to have done so. The cloud agent never gets the chance to satisfice on the load-bearing fields, because a deterministic check gates the proposal on the contract.

---

## 4. The consult script — mapped to the schema

The peer-to-peer walkthrough script the owner runs on site. Each prompt names the fields it fills. (This is a script the owner *speaks from*, not a form Right Hand makes the client fill.)

| Consult prompt (what the owner asks / observes) | Fills |
|---|---|
| "What are we doing here — which rooms, what's the vision?" | `project_type` · `design_tier` · `rooms[]` · `scope_items[]` |
| Walk + scan each room (LiDAR) | `rooms[].measurements` (with use-label) |
| "Walk me through what you want done in [room]." | `scope_items[]` (→ phases) |
| "Are you picking your own fixtures, or want us to handle them?" | `fixtures_owner_furnished` · `allowances[]` |
| "Any finishes you've already chosen, or should we set allowances?" | `allowances[]` · `design_tier` |
| "Anything off the table / not in scope?" | `exclusions[]` · `phasing_constraints` |
| Owner-side: confirm trade rates, margin, permit posture | `labor_rates{}` · `margin.gm_pct` · `permits` |
| Client info capture | `client.*` · `project.address` |

The consult fills the *front* of the contract; sub-agents (market pricing, takeoff, rate lookup) fill the *cost* fields in the background; the completeness check gates the proposal.

---

## 5. The visibility model (how it reaches the owner)

Background by default, inspectable by need (memory-exposure doctrine). The owner sees two things: **the produced document** (proposal / cost sheet) and, on demand, **the audit log** — which field, which source (with date), which state, which check passed. The sub-agents populating fields, the completeness check, the contract verification, Right Hand assembling inputs — all background, all during the "Right Hand is drafting" window. Agent names stay in the audit provenance, never in the operator copy (`feedback_agent_names_not_in_operator_copy`).

---

## 6. Next deliverable (mechanical)

The JSON Schema is a direct extraction from Section 2's column table — field name, type, allowed values, state enum, provenance enum, consumer tags become object properties. Generate it *from* this table so the canon doc and the machine schema never disagree (one source of truth). Do not hand-author the JSON separately.

---

## Cross-references
- Companion backend canon: `RightHand_Storage_Learning_Isolation_Canon_v1_2026-05-30.md`
- Estimating canon: GGR/Valle estimating skill (19-phase · 35% GM · fixture exclusion · CA payment rules)
- D-049 (draft/execution split) · D-050 (voice-led front door) · D-035 (source-class) · D-043 (LiDAR use-labels) · D-044 (payment milestones) · `feedback_dispatch_brief_name_deterministic_rules` · `feedback_trust_first_precision_later` · `feedback_agent_names_not_in_operator_copy`

*DRAFT v1, 2026-05-30. Contract explicit in v1 per founder call; doc-first with column table so JSON is a mechanical next step.*
