# Field Daily Step B — UI loop (B.4 + B.5 + B.6)

**Date:** 2026-05-16
**Sprint:** V1.5 Field Daily vertical slice, Step B
**Predecessors (substrate, ALREADY LANDED on stacked PRs):**
- B.1 — Field Capture play handler (PR #193) — `src/persistence/fieldCapture.ts`
- B.2 — Deterministic 9-fact extractor (PR #194) — `src/persistence/dailyLogExtractor.ts`
- B.3 — Drift adapter (PR #195) — `src/persistence/driftAdapter.ts`

The orchestrator (Claude) reserves B.7 (end-to-end test on the Henderson golden fixture) — Cursor builds B.4 → B.6.

---

## Standing rules (verbatim — read before scoping)

> You are working on GGRValle/kerf-app in the compressed F&F proposal-first push.
>
> Operating rules:
> - Base every branch on fresh main.
> - Keep PRs small and scoped.
> - Do not touch Policy Gate, schemas, fixtures, workflows, or EventLog unless your specific task says so.
> - Run the requested verification gate before reporting done.
> - Push your branch and open a PR if gh is available; otherwise push and report branch + commit.
> - Never rewrite frozen evidence under src/examples/evidence/2026-05-02-w1 unless explicitly assigned.
> - No fetch, no Platform calls, no real auth, no backend writes unless explicitly assigned.
> - Report: branch, commit, files changed, tests run, what could break.

---

## Why this work

Step B's substrate (B.1–B.3) is locked. The Field Daily flow now exists as:

```
Operator captures daily log entry
  → POST /api/projects/<id>/daily-log/entries   (already shipped, PR #188)
  → daily_log.entry_captured event
  → Field Capture play (B.1) runs
  → daily_log.facts_extracted event (with 9-field facts from B.2)
  → Drift adapter (B.3) classifies
  → daily_log.drift_detected event (or null)
```

What's missing is the **operator-facing UI loop**:

- A `/field` surface for the field operator to capture the entry
- A `/relay` surface for the office operator (PM / owner) to see what was captured + what drift fired
- A review endpoint to mark a relay card reviewed

Once these three PRs land, the orchestrator runs B.7 — an end-to-end test that walks the Henderson golden fixture from `/field` POST through to `/relay` review and asserts the event chain.

**Critical context — read before coding:**

1. **NOT the full Field Hand shell.** Step B's `/field` is a single-purpose capture surface, NOT the HOME/JOB/LOG/ME bottom-nav shell (that's Step D). Don't build tabs. Don't fall into the shell-before-substrate trap that triggered the vertical-slice pivot.

2. **Voice canon dependency.** The `/relay` UI must NOT include operator-facing "Right Hand says..." voice copy. Mark every place voice copy would go with `[voice canon pending — placeholder]` markers. Substrate ships; voice ships separately (Field Daily §9.6).

3. **§13 disclosure pattern.** Relay cards show a small "audit trail" link that deep-links to the event lineage. NO top-nav Audit tab (canon: audit is one click deep, never first-class).

4. **Naming collision to avoid.** There is an existing `/field-capture` route in `src/examples/v15-vertical-slice/router.ts` that serves the proposal-first scaffold flow. The new B.4 route is a different surface — daily log entry capture, not proposal capture. Use a distinct route: **`/field`** (no `-capture` suffix) to keep these separate. Same pattern for `/relay`.

---

## Reference docs

- `docs/agent-briefs/field-daily-step-b-vertical-slice-2026-05-16.md` — Step B master brief
- `docs/architecture/field_daily_workflow_design_2026-05-15.md` §7 (UI surfaces), §9.6 (voice canon block), §10 (plays vs agents)
- `docs/architecture/right_hand_home_module_drawer_2026-05-15.md` — Right Hand surface canon (the /relay surface inherits these patterns)
- `src/persistence/events.ts` — the canonical event shapes for `daily_log.entry_captured`, `daily_log.facts_extracted`, `daily_log.drift_detected`, `relay_card.surfaced`, `relay_card.reviewed`
- `src/persistence/fieldCapture.ts` — the play handler (B.1) — your /field POST will trigger this
- `src/persistence/driftAdapter.ts` — the drift adapter (B.3) — your /relay UI surfaces what this emits
- `scripts/serve-v15-vertical-slice.ts` lines 575–890 — the existing `handleCreateDailyLogEntry` endpoint (Step A — PR #188) — your /field UI POSTs to this

---

## Task structure — three sequential PRs

Land in order. Each PR stacks on the previous one.

### B.4 — Minimal `/field` capture surface (~2h)

**Branch:** `feature/v15-field-daily-ui-field-route`
**Base:** fresh main
**Files:**
- `src/examples/v15-vertical-slice/pages/field-daily-capture.ts` (new)
- `src/examples/v15-vertical-slice/router.ts` (modify — add `/field` route)
- `src/examples/v15-vertical-slice/app.ts` (modify — wire the new page)
- `src/examples/v15-vertical-slice/pages.ts` (modify if pages are exported through here)
- `tests/v15-field-daily-capture.test.ts` (new — ~5 tests)

**Scope:**
- Brand header: `KERF · FIELD` (matches FRAME 2 wireframe at `docs/wireframes/kerf_wireframes_mobile_v2.html`)
- Project switcher dropdown (uses existing `GET /api/projects` to populate)
- Big voice record button (reuse `src/examples/v15-vertical-slice/v15-record-button.ts` if compatible; otherwise document why a fresh component was needed)
- Submit handler POSTs to `/api/projects/<id>/daily-log/entries` with body:
  - `tenant_id`: 'tenant_ggr' (single-tenant V1.5)
  - `entry_kind`: 'progress_update'
  - `actor`: from existing operator-context module if available; otherwise hardcode `{ id: 'browser_operator', role: 'field_super' }`
  - `transcript_text`: from voice transcript (or a textarea fallback for testing — clearly labeled "TYPE TRANSCRIPT (testing only)" — voice path can come in Step C if MediaRecorder/Whisper integration needs more time)
  - `source_refs`: synthesized per PR #176 rule — at least one ref pointing at the recording URI
- On 2xx response: render confirmation block showing `event_id` + first 200 chars of transcript
- On 4xx/5xx: render error block with `error` + `reason` fields from the response

**Do NOT build:**
- HOME / JOB / LOG / ME bottom nav tabs (Step D)
- Operator selector / role switching UI (single operator V1.5)
- Multiple tenants — `tenant_ggr` hardcoded for V1.5
- Photo capture (D-043 substrate, separate Step)
- LiDAR (post-V1.5)

**i18n hard rule:** every user-facing string MUST go through an i18n key (Field Daily §9.5). Use the `field.*` keyspace. English values only for now; Spanish lands V2.1. Hardcoded strings = retrofit debt = NO.

**Tests (~5 tests):**
1. HTML builder returns expected shape with `KERF · FIELD` header
2. Project switcher fetches `/api/projects` and renders options
3. Voice button mounts (or textarea fallback if voice deferred)
4. Submit handler calls correct endpoint with correct body shape
5. Confirmation block renders after successful POST

**Verification gate:**
- `npm run typecheck`
- `node --import tsx --test tests/v15-field-daily-capture.test.ts`
- `npm test` (full suite — must stay green, currently 1161/1161 once #193–#195 merge)

---

### B.5 — Minimal `/relay` surface (~2h)

**Branch:** `feature/v15-field-daily-ui-relay-route` (off main; will rebase after B.4 merges)
**Files:**
- `src/examples/v15-vertical-slice/pages/relay.ts` (new)
- `src/examples/v15-vertical-slice/router.ts` (modify — add `/relay` + `/relay/<entry_id>` routes)
- `src/examples/v15-vertical-slice/app.ts` (modify — wire the new pages)
- `tests/v15-relay-surface.test.ts` (new — ~6 tests)

**Scope (list view at `/relay`):**
- Header: `KERF · RIGHT HAND · RELAY`
- List today's relay cards. **Source of truth: query `/api/projects` and aggregate `relay_card.surfaced` events grouped by project (single tenant V1.5).** If a relay-card surfacing flow doesn't exist yet (it doesn't — B.6 wires review, but card-surfacing on facts-extracted is also gated by play scheduling that's Step C), **use the existing `daily_log.facts_extracted` events as the proxy data source for the list**: each fact-extraction is a "would-be" relay card. Note this clearly in the file's doc comment.
- Each list item: project name, entry timestamp, drift severity badge (if `daily_log.drift_detected` event exists for the entry), one-line summary from the facts (e.g., "completed_work[0]" or "Schedule: behind" or similar — first non-empty fact category)
- Click → navigate to `/relay/<entry_id>`

**Scope (detail view at `/relay/<entry_id>`):**
- Source transcript (collapsible block)
- Photos section (empty — D-043 substrate, placeholder)
- Extracted facts table — 9 rows, one per category, empty arrays render as `—` (em dash)
- Drift signal chip when `daily_log.drift_detected` exists: shows severity (info / caution / warn / block) with appropriate color + the description text
- **§13 audit trail link:** small text link at the bottom: "Audit trail →" — for now, deep-links to `/audit/<entry_id>` (route doesn't have to fully work yet; just the link presence is part of the canon)
- "Mark reviewed" button — wires to B.6 endpoint (POSTs to `/api/relay-cards/<id>/review`)
- **Voice canon block:** any place you'd put operator-facing "Right Hand says: ..." copy, insert a `<div data-voice-canon-pending>[voice canon pending — placeholder]</div>` marker. Test 6 asserts no premature voice copy slipped in.

**Do NOT build:**
- Multi-tenant filtering (single-tenant V1.5)
- Real-time updates / SSE (poll on page load is fine)
- Card-surfacing logic (Step C wires the play scheduler)
- "Right Hand says ..." copy in any form

**i18n hard rule:** every user-facing string through `rh.*` keyspace (Right Hand keyspace per Field Daily §9.5).

**Tests (~6 tests):**
1. List view shape: header + card list container present
2. Card list renders one item per facts-extracted event (or relay_card.surfaced, whichever data path is used — document in test name)
3. Drift signal chip appears when drift event exists; severity-color mapping matches the four-tier vocab (info / caution / warn / block)
4. Detail view fact-table renders all 9 category rows, empty ones as `—`
5. §13 audit-trail link present in detail view
6. Forbidden-content: detail view source contains the literal `[voice canon pending` marker AND does NOT contain any "Right Hand says" string

**Verification gate:** same as B.4 (typecheck + test file + full suite).

---

### B.6 — `POST /api/relay-cards/<id>/review` endpoint (~1h)

**Branch:** `feature/v15-relay-card-review-endpoint` (off main; rebases on B.5)
**Files:**
- `scripts/serve-v15-vertical-slice.ts` (modify — add the new endpoint)
- `tests/persistence-relay-card-review-endpoint.test.ts` (new — ~5 tests)

**Scope:**
- New endpoint: `POST /api/relay-cards/:relay_card_id/review`
- Request body:
  - `tenant_id`: 'tenant_ggr' | 'tenant_valle'
  - `reviewer`: non-empty string (operator id)
  - `outcome`: 'acknowledged' | 'actioned' | 'dismissed' (per `RelayCardReviewOutcome` in `src/persistence/events.ts`)
- Validation:
  - `tenant_id` in allowlist
  - `outcome` in allowlist (above three values)
  - `reviewer` non-empty
  - `relay_card_id` exists in the event log as a prior `relay_card.surfaced` event — return 404 with `{ error: 'relay_card_not_found' }` if not. Look up via the existing projection cache pattern from `handleCreateDailyLogEntry`.
- On success:
  - Emit `relay_card.reviewed` event (use `appendPersistenceEvent` pattern from the existing handler)
  - Include `correlation_id` and `actor` propagated from the source `relay_card.surfaced` event
  - `reviewed_at` = ISO now
  - source_refs: propagate from the surfaced event (PR #176 carry-through)
  - Return 200 with `{ event_id, type: 'relay_card.reviewed', outcome, reviewed_at }`
- On invalid body: 400 with `{ error, reason }` per the existing handler pattern

**Do NOT build:**
- Cross-tenant lookup (single-tenant V1.5)
- Bulk-review endpoint
- Undo / revoke endpoint (canon: reviewed is terminal per Field Daily §7.3)

**Tests (~5 tests):**
1. Happy path: POST with valid body → 200 + event written to log + appears in projection
2. 404 when `relay_card_id` doesn't exist in event log
3. 400 when `outcome` not in allowlist (e.g., "rejected")
4. 400 when `reviewer` empty
5. correlation_id + actor + source_refs propagation from `relay_card.surfaced` → `relay_card.reviewed`

**Verification gate:** same as B.4/B.5.

---

## Reporting (required for each PR)

When each PR is ready, report in this exact shape:

- **Branch:** `feature/...`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `<commands + pass/fail counts>`
- **What could break:** `<honest list — even small risks>`

If you discover the design needs to deviate from this brief (e.g., a referenced module doesn't exist, an existing module shape conflicts with a scope item), **STOP and report before coding**. Don't silently work around a spec gap — that's how canon drift starts.

---

## Out of scope (Cursor must NOT do these)

- B.7 (end-to-end test on Henderson golden) — **orchestrator reserves this**; do not write it
- Touching `src/persistence/fieldCapture.ts`, `src/persistence/dailyLogExtractor.ts`, `src/persistence/driftAdapter.ts`, or `src/persistence/events.ts` (substrate is locked)
- Touching `src/altitude/`, `src/workflows/`, fixtures, or frozen evidence
- The Right Hand voice canon (queued separately; this brief explicitly blocks UI from including "Right Hand says ..." copy)
- HOME/JOB/LOG/ME bottom-nav tabs (Step D)
- Photo / LiDAR (D-043, separate substrate)
- Card-surfacing logic from extracted facts (Step C wires the play scheduler)

---

## Why this scope is right (a note for Cursor)

Step B is the vertical slice on `progress_update`. After these three PRs + B.7, we'll be able to demo:

> "Mike at Henderson speaks his daily log into `/field`. The transcript reaches the office's `/relay` surface within seconds, classified with severity `block` because galvanized was found AND schedule slipped AND scope expanded. The office operator clicks 'Mark reviewed → Actioned' and the audit trail threads from voice capture → extraction → drift → review."

That's the end-to-end demo that proves the substrate's hypothesis: **Kerf turns daily field behavior into office action with almost no extra typing.**

Don't over-build. The 4 PRs together (B.4 + B.5 + B.6 + B.7) close the loop. Step C+ expand it.
