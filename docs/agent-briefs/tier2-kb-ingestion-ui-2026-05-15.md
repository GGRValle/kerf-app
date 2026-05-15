# Cursor Agent Brief — Tier-2 KB Ingestion UI

- **For:** Cursor agent, `GGRValle/kerf-app`
- **From:** Claude Code (Agent 8 / integration lead)
- **Date:** 2026-05-15 (refreshed for dispatch)
- **Reference PRs:** #153 (cost-KB seed loader at tier 1), #161 (material matcher), **#165–#171 (persistence stack — landed)**, **#176 (SourceRef tightening — landed)**, **#180 (Right Hand Home + Module Drawer canon — landed)**
- **Branch from:** `main` (latest)
- **Target branch:** `feature/v15-tier2-kb-ingestion-ui`
- **Target test count after merge:** +15 to +25
- **Estimated effort:** 4–6 hours

---

## ✅ DISPATCHABLE — persistence stack landed

This brief was originally gated on the persistence layer's HTTP endpoints. **Those endpoints landed on main on 2026-05-15** (PR #171 — see `scripts/serve-v15-vertical-slice.ts`). The serve script has been converted from `.mjs` → `.ts` via the `tsx` loader; reference it as `scripts/serve-v15-vertical-slice.ts` throughout your work.

You'll be adding a `POST /api/kb/ingestions` endpoint to that same TypeScript serve script (alongside the existing `POST /api/projects` / `POST /api/projects/<id>/captures` / `GET /api/projects` / `GET /api/projects/<id>` endpoints) and emitting `kb.ingested` events through the existing `eventStore.append()` path.

**Canon note (post-#180)**: Tier-2 KB ingestion is a **Right Hand module drawer destination** (Phase 1 drawer item: Cost KB / Money). It is NOT a top-nav route. The V1.5 spine still uses a flat top-nav for now (Step 6 will refactor to the drawer pattern), so for this brief: wire `/kb-ingestion` as a route that the future module drawer will link to. Don't add a nav entry to the V1.5 hamburger menu — the brief originally requested that, but post-#180 the cleaner path is "route exists, drawer will reach it."

---

## 1. Working agreement preamble (required, do not skip)

You are operating inside the Kerf / Right Hand / Obraki architecture for the **GGR/Valle internal release** (30-day target). NOT generic SaaS, NOT multi-tenant, NOT public launch.

**Architecture invariants — non-negotiable:**

- Deterministic core; LLMs at edges only
- All LLM output untrusted; schema/business-rule validation before side effects
- No autonomous pricing authority
- No autonomous money movement
- Money as integer cents
- Structured artifacts shared between agents (not giant prompts)

**Pricing-gate constraints (1:1 with `Pricing_Gate_v0_2`):**

- Ingested rows MUST carry `source_ref_id` (source-or-silent)
- Authority rank semantics: PROJECT_ACTUAL = 1, TENANT_MEMORY = 2 — operator-tagged at ingestion time
- `founder_review_required` defaults to TRUE on all ingested rows; UI lets operator clear ONLY rows they've reviewed
- `pricing_basis_state` defaults to `INTERNAL_DOGFOOD_ONLY` (not `CLIENT_VISIBLE`) until founder review

**Forbidden actions:** force push, hard reset, branch delete pre-merge, hook bypass, GPG bypass.

---

## 2. Task summary

Build a UI surface that lets the operator upload past GGR/Valle estimates as **tier-2 Cost KB rows** that preempt the tier-1 seed in `lookupCostKbSeed`. Two ingestion modes:

1. **xlsx upload** (matches the v0.6 seed loader pattern from PR #153)
2. **CSV paste** (operator copies from Numbers / Excel / Google Sheets into a textarea)

Ingested rows land in `.kerf/kb/tenant/<tenant_id>_actuals.jsonl` via the persistence layer's `kb.ingested` event and a new tier-2 lookup adapter.

**Operator can't bulk-edit ingested rows.** Each row is reviewed individually before being marked `APPROVED_DOGFOOD` (or `APPROVED_CLIENT_VISIBLE` later).

---

## 3. UI surface

### 3.1 `/kb-ingestion` — list + new upload

- Status of any prior ingestions (date, row count, source file, authority_rank, review status)
- "New ingestion" button → opens the upload form
- Operator picks: ingestion mode (xlsx / CSV paste), tenant (ggr / valle), authority rank (1 = PROJECT_ACTUAL, 2 = TENANT_MEMORY)
- Submit → POST `/api/kb/ingestions` → server parses + validates each row → emits `kb.ingested` event + writes rows to JSONL
- Validation errors return as per-row error list; operator fixes locally and re-uploads (no partial-import; all-or-nothing)

### 3.2 `/kb-ingestion/<ingestion_id>` — review queue

After ingestion, every row starts in `NEEDS_FOUNDER` curator status. Operator reviews row-by-row:

- Display: trade / line_item / unit / range_low / range_high / source_ref / notes
- Actions: "Approve for dogfood" / "Needs more source" / "Reject"
- Approved rows transition to `APPROVED_DOGFOOD` and become eligible for `clarification_range` use in `lookupCostKbSeed`

### 3.3 `/kb` — overall KB browser

(Optional for this brief — punt if time is tight)

- Filter by trade, authority rank, status
- Search by item_name

---

## 4. Files to create / modify

### 4.1 New: `src/persistence/kbIngestion.ts`

```ts
export interface IngestionRow {
  /** Same schema as KerfCostKbSeedRow from PR #153, plus operator-provided fields. */
  // (full type follows the same shape; reuse where possible)
}

export interface IngestionRequest {
  readonly tenant_id: PersistenceTenantId;
  readonly authority_rank: 1 | 2;  // PROJECT_ACTUAL or TENANT_MEMORY
  readonly source_file: string;     // operator-supplied filename (informational)
  readonly rows: readonly IngestionRow[];
}

export interface IngestionResult {
  readonly ingestion_id: string;
  readonly row_count: number;
  readonly written_to: string;       // file path
  readonly events_emitted: readonly string[]; // event_ids
}

export async function ingestKbRows(
  request: IngestionRequest,
  store: PersistenceEventStore,
  options: { kbFilepath: (tenant: string) => string },
): Promise<IngestionResult>;
```

Implementation: validates every row, throws AggregateError on validation fail (no partial writes), emits a `kb.ingested` event, appends rows to `.kerf/kb/tenant/<tenant>_actuals.jsonl`.

### 4.2 Modify: `src/examples/v15-vertical-slice/v15-cost-kb-seed.ts`

Extend `lookupCostKbSeed` so it consults the tier-2 file BEFORE the tier-1 seed. Tier-2 rows at `authority_rank: 1` (PROJECT_ACTUAL) preempt everything; rank 2 (TENANT_MEMORY) preempts seed (rank 5) but not project-actuals.

```ts
// Concept; refine for the actual current state of v15-cost-kb-seed.ts
async function loadAllAuthoritySources(tenant: string): Promise<KerfCostKbSeedRow[]> {
  // Read tier-2 file first; return prepended to tier-1 rows.
  // Sort by authority_rank ASC at lookup time (already done).
}
```

### 4.3 New: `POST /api/kb/ingestions` endpoint in `scripts/serve-v15-vertical-slice.ts`

The serve script is TypeScript now (PR #171 converted from `.mjs`). It already runs via `node --import tsx scripts/serve-v15-vertical-slice.ts` (see `package.json` `demo:v15-vertical-slice:serve` script).

Add the endpoint following the pattern of the existing handlers in the same file (`handleCreateProject`, `handleRecordCapture`, `handleListProjects`, `handleGetProject`):

- Accepts JSON body (for CSV-paste pre-parsed by the browser) OR multipart-form-data (for xlsx upload — defer multipart impl if you need to scope down; CSV-paste path alone is enough for V1.5 dispatch)
- Calls `ingestKbRows` for parse + validate + persist
- Emits `kb.ingested` event via the module-level `eventStore.append()` (already wired in the serve script)
- Returns IngestionResult `{ok: true, ingestion_id, row_count}` on success, `400` with `errors: string[]` array on validation failure

**Important — source_refs rule (PR #176 carryover)**: the `kb.ingested` event type is in `SOURCE_REFS_OPTIONAL_TYPES` (along with `project.created`), so empty `source_refs: []` is permitted. Do NOT synthesize a placeholder ref — pass empty.

Validate the request body against `PersistenceTenantId` (`'tenant_ggr' | 'tenant_valle'`) the same way the other endpoints do. The `authority_rank` field must be an integer in `[1, 7]` per the validator.

### 4.4 New: `src/examples/v15-vertical-slice/pages/kb-ingestion.ts`

Renders the upload + review-queue UI. Reuses scaffold-card styling for the per-row review tiles.

### 4.5 Modify: router + nav

Add `/kb-ingestion` route to V1.5 router; add nav entry (operator-only — single-tenant doesn't have role-gating yet).

### 4.6 Tests

- `tests/persistence-kb-ingestion.test.ts` (~10 tests)
  - Round-trip ingestion: write → read tier-2 file → lookup preempts tier-1
  - All-or-nothing validation: one bad row fails the whole batch
  - Authority-rank preservation per row
  - `kb.ingested` event emitted on success
  - Tier-2 PROJECT_ACTUAL preempts seed
  - Tier-2 TENANT_MEMORY preempts seed but not PROJECT_ACTUAL
- `tests/v15-kb-ingestion-route.test.ts` (~5 tests)
  - POST endpoint accepts JSON body
  - POST endpoint returns 4xx with errors on bad input
  - POST endpoint writes the tier-2 file
  - Empty array request returns 4xx

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
rg "fetch\(|XMLHttpRequest|axios|http\.request" src/persistence/kbIngestion.ts
rg "process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)" src/persistence/kbIngestion.ts
rg "sumLines|sumScaffold|projectTotal|grandTotal" src/persistence/kbIngestion.ts
rg -i "groqChat|whisperTranscribe|openai|anthropic" src/persistence/kbIngestion.ts
```

---

## 7. What NOT to do

- ❌ Do not auto-approve ingested rows. Every row starts `NEEDS_FOUNDER`; operator reviews individually.
- ❌ Do not bulk-edit ingested rows after they land. UI is single-row review.
- ❌ Do not make ingested rows `CLIENT_VISIBLE` without an explicit founder-review action.
- ❌ Do not skip the source-ref requirement. Every ingested row must carry source_ref_id; reject rows without it.
- ❌ Do not introduce LLM "fix this row" suggestions. Validation is deterministic + the operator fixes manually.
- ❌ Do not write directly to `.kerf/kb/seed/cost-kb-seed.json`. Tier-2 lands in a separate `.kerf/kb/tenant/<tenant>_actuals.jsonl`.
- ❌ Do not introduce paginated UI for the review queue beyond what fits naturally on one screen (we're at GGR/Valle scale; not enterprise).

---

## 8. Handoff back to integration lead

When CI is green:
1. Open PR with body summarizing the surface, the persistence event emitted, and the lookup precedence (tier-2 preempts tier-1)
2. Self-review summary covering:
   - Validation rules enforced at the row level
   - All-or-nothing batch semantics
   - Confirmation that ingested rows default to NEEDS_FOUNDER + INTERNAL_DOGFOOD_ONLY
   - Mobile smoke result for the upload form
3. Integration lead routes to ChatGPT + Codex for second-opinion review before merge.
