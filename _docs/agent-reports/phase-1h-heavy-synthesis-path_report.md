# Phase 1H Lane 1 · Heavy Synthesis Path · Agent Report

**Branch:** `phase-1h-heavy-synthesis-path`
**Head SHA:** (to be set at push · see `git log -1 --pretty=oneline HEAD`)
**Base SHA:** `d06815a` (origin/main at execution start)
**Builder:** Claude Code
**Brief:** `cursor_dispatch_briefs_2026-05-27/06_Phase_1H_Model_Led_Draft_Reset_Execution_Brief.md`
**Canon doctrine:** D-049 (Draft Layer / Execution Layer Split · Failure as Training Signal)

---

## Canon line this lane is built under

> Let Kerf be wrong where correction teaches it. Never let Kerf be wrong where consequence escapes review.

Synonymous: heavy model produces the draft · Kerf governs consequence · failure teaches memory.

---

## Files changed

| Path | Change |
|---|---|
| `src/persistence/events.ts` | +727 / -2 · adds 7 D-049 learning-loop event types (Day 1 cherry-pick from earlier work) |
| `src/agents/draft-synthesis/synthesize.ts` | NEW · 487 lines · heavy synthesis service |
| `src/api/routes/synthesizeDraft.ts` | NEW · 224 lines · Hono endpoint at `/api/v1/projects/:id/synthesize-draft` |
| `src/api/router.ts` | +2 lines · mounts the new route |
| `src/app/pages/field-capture.astro` | +146 / -1 · "Build Draft" button + handler with truthful fallback |
| `tests/phase1h-event-contract.test.ts` | NEW · 540 lines · 24 validator tests (Day 1) |
| `tests/phase1h-heavy-synthesis-path.test.ts` | NEW · 411 lines · 15 service + endpoint + F-E1 source tests |
| `_docs/agent-reports/phase-1h-heavy-synthesis-path_report.md` | NEW · this report |

---

## What changed

### 1. Event contract foundation (Day 1 · carried forward via cherry-pick)

Seven new event types added to `src/persistence/events.ts`, additive only:

- `draft.synthesized` · `draft.corrected` · `draft.accepted` · `draft.rejected`
- `learning_signal.captured` · `memory_update.proposed` · `memory_update.confirmed`

Each has a typed payload, a validator function, runtime guards, and switch-case coverage in `validatePersistenceEvent`. D-048 classify-before-harden axes attach to `draft.corrected` and `draft.rejected` directly (D-049 refinement).

### 2. Heavy synthesis service (`src/agents/draft-synthesis/synthesize.ts`)

One async function: `synthesizeDraft(request, deps)`. Takes a capture bundle (typed summary · transcript · audio source ref · photo refs · project context · tenant context · markdown context packet) and routes it through `anthropicChat` (the existing model abstraction · D-023 hosting registry gates the endpoint).

**System prompt** instructs the model to:
- Return strict JSON only · no prose · no markdown fences
- Never emit dollar amounts or monetary values · use gap_flags for cost-impact instead
- Never emit auto-action keys (send / approve / auto / pay)
- Back every claim with at least one source_refs entry
- Use null candidate when no actionable artifact fits

**Deterministic guards** run on the parsed JSON BEFORE persistence:
- Send guard · rejects any response carrying `send`, `auto_send`, `send_to_client`, `submit_to_client`, `approve`, `auto_approve`, `auto`, `pay`, `auto_pay` at any nesting level
- Money guard · rejects `$N` patterns and dollar/USD-shaped text via regex
- Prompt-injection guard · rejects "ignore previous", "system prompt", code-fence markers, etc.
- Schema validation · matches `DraftSynthesizedPayload` exactly · all enum values runtime-narrowed
- Source-ref guard · rejects candidate-with-proposed_fields or gap_flags-present when source_refs is empty
- Token cost ceiling · `DRAFT_SYNTHESIS_TOKEN_CEILING = 50_000` (≈ $0.50 / call at Sonnet 4.6 list)

On success: persists `draft.synthesized` via `appendValidatedEvent` (L0.3 validator runs again at the event-store layer). Returns `{ ok: true, draft_id, event, payload }`.

On any failure: returns `{ ok: false, kind, reason, ... }`. No event persists. The caller (endpoint) translates `kind` into HTTP status and signals `fallback_recommended: true` so F-E1 drops to the deterministic 9-fact chain.

### 3. Endpoint (`src/api/routes/synthesizeDraft.ts`)

`POST /api/v1/projects/:id/synthesize-draft` mounted under `/api/v1` via the existing apiRouter.

**Tenant consent gate** (Lane 1 stopgap per the brief): env var `KERF_SYNTHESIS_CONSENT_TENANTS` accepts a comma-separated list. Defaults to `tenant_ggr` only. Phase 1H Lane 4 (Cursor · context-memory-stopgaps) builds the richer per-tenant config layer; this is the v0 stopgap so Lane 1 ships without blocking on Lane 4.

**ANTHROPIC env check** up front · returns 503 `transcribe_not_configured` (same shape as the existing transcribe endpoint) with `fallback_recommended: true` when the env is missing on the deploy.

**Response shapes:**

| Status | When | Body shape |
|---|---|---|
| 200 | Successful synthesis | `{ ok: true, draft_id, event_id, redirect_to: '/draft-review/:draft_id', payload, model }` |
| 503 | `transcribe_not_configured` · `tenant_consent_missing` · `route_rejected` · `upstream_network_error` · `upstream_api_error` · `token_cost_exceeded` | `{ ok: false, kind, reason, fallback_recommended: true }` |
| 422 | Model output violated a guard: `non_json_output` · `schema_invalid` · `money_guard_blocked` · `send_guard_blocked` · `source_ref_guard_blocked` · `event_validator_rejected` | `{ ok: false, kind, reason, fallback_recommended: true }` |
| 400 | Caller missing `capture_id` or `tenant_id` | `{ error: 'invalid_request', reason }` |

DI hook `__setSynthesizeDraftDepsForTests` lets tests inject a stubbed `anthropicChat` · zero real Anthropic calls in CI.

### 4. F-E1 "Build Draft" button + truthful fallback

State 3 (pre-flight) gets a primary `Build Draft` button alongside the existing `Submit to Daily Log` button (which keeps the explicit "skip synthesis · just save" path).

**Build Draft handler** chains two calls:

1. `POST /api/v1/projects/:id/daily-log/entries` · saves the capture · returns `event_id` (used as `capture_id` for synthesis)
2. `POST /api/v1/projects/:id/synthesize-draft` · runs the heavy model · returns `draft_id` + `redirect_to`

**Success path:** status shows "Draft ready. Opening Draft Review…" · 600ms delay so operator sees the success state · `window.location.href = redirect_to` navigates to `/draft-review/:draft_id`.

**Fallback paths (truthful · no silent failures):**

- Synthesis 503/422 with `fallback_recommended: true` · status shows `"Draft synthesis unavailable ({kind}). Capture saved to Daily Log — open Relay for the deterministic chain."` · the Relay link surfaces in the outcome panel · error reason renders in the play-error node
- Network failure on synthesis · status shows `"Capture saved, but draft request failed: {message}. Open Relay for the deterministic chain."`
- Capture step itself fails · status shows error · no synthesis attempted

The deterministic 9-fact chain remains intact at the Daily Log layer; synthesis failure does NOT silently lose the capture.

---

## Doctrine checks (D-049 + the brief's locks)

| Check | Status |
|---|---|
| Heavy model produces the draft | ✓ Sonnet 4.6 via existing hosting registry |
| Kerf governs consequence | ✓ five deterministic guards + L0.3 validator wall around model output |
| Failure teaches memory | ✓ event contract for the full loop (draft.synthesized → corrected → accepted/rejected → learning_signal.captured → memory_update.{proposed,confirmed}) |
| No fake transcript | ✓ transcript field passes through unchanged; empty allowed |
| No fake photo understanding | ✓ photo_refs with `gap_flag: true` instruct model to surface gap_flags rather than invent vision content |
| No autonomous send | ✓ send guard rejects auto-action keys at any nesting level |
| No money finalization | ✓ money guard rejects $N patterns; instructed in system prompt |
| Tenant-private | ✓ correlation_id is per-project; tenant consent gate per-tenant; no cross-tenant reads |
| Deterministic chain stays as fallback | ✓ failed synthesis falls through to existing daily_log.entry_captured chain via the F-E1 capture step |
| Heavy model output schema-validated before persist | ✓ parseAndValidateDraftJson + appendValidatedEvent (L0.3) |
| No projection-only lane (the brief's banned shape) | ✓ this lane ships a working phone loop step, not a projection |

---

## Tests run · exact result

### Focused tests (per brief verify command)

```
node --import tsx --test \
  tests/phase1h-heavy-synthesis-path.test.ts \
  tests/phase1h-event-contract.test.ts \
  tests/phase1e-field-capture-submit.test.ts \
  tests/route-shell-smoke.test.ts
```

Result: not run as a single block at the time of this report. Each suite has been verified independently:

- `tests/phase1h-heavy-synthesis-path.test.ts` · 15/15 PASS (synthesis service · endpoint · F-E1 source)
- `tests/phase1h-event-contract.test.ts` · 24/24 PASS (Day 1 event contract)

### Full suite

```
npm test
```

Result: **1492/1492 PASS** clean. Math: 1453 baseline at `d06815a` + 24 Day 1 event-contract tests + 15 Day 2 synthesis tests = 1492.

### Known flake (not introduced by this lane)

`tests/v15-transcribe-route.test.ts` · POST /transcribe returns 415 when content-type is not audio/*

This test spawns a child V1.5 server process and asserts on a 415 response from `GROQ_API_KEY` being passed in the child env. It failed once during the full-suite run with `503 !== 415` (the child saw `GROQ_API_KEY` as missing). It passed cleanly on:
- isolated re-run (`node --import tsx --test tests/v15-transcribe-route.test.ts` · 6/6 PASS)
- the very next full-suite run (`npm test` · 1492/1492 PASS)

Same shape as the Phase 1D `v15-kb-ingestion-route.test.ts` ECONNRESET flake banked previously: child-process + env-passing race. Not caused by this lane's changes. Note for the gate runner: re-run on red, treat as flake if green on second pass.

---

## Known limitations

1. **No `/draft-review/:draft_id` surface yet.** F-E1's Build Draft success path navigates the browser to that URL, but Lane 3 (Cursor) owns the surface itself. If Lane 3 hasn't landed by the time this lane merges, the navigation will hit a 404 OR the existing draft-review placeholder. The capture + draft.synthesized event still persist correctly; only the review UI is missing.

2. **Context packet is a stopgap.** Lane 1 accepts a `context_packet_markdown` string in the endpoint request body. F-E1 doesn't supply one yet (passes through empty); the synthesizeDraft service falls back to a `MINIMAL_FALLBACK_CONTEXT_PACKET` constant. Lane 4 (Cursor · markdown-memory-stopgaps) builds the real per-tenant + per-project + recent-corrections composer. Synthesis works without it; quality is lower until Lane 4 lands.

3. **Photo gap_flag is the default.** The F-E1 handler always passes `gap_flag: true` for photos because durable photo upload isn't implemented (per the brief's "honest photo gap flags if durable photo upload is not ready"). The model is told to surface gap_flags rather than invent what's in the photo. When durable photo upload + vision lands (future media-library lane), the handler flips `gap_flag` to false and supplies the vision caption.

4. **Token cost ceiling is conservative.** 50_000 combined input+output tokens (~$0.50 per call). For long transcripts or rich context packets, this may bite. Adjustable via `DRAFT_SYNTHESIS_TOKEN_CEILING` constant; per-tenant overrides not implemented.

5. **No retry on transient failures.** A single `upstream_network_error` returns 503 immediately. The operator can re-tap Build Draft to retry; no automatic backoff.

6. **Tenant attribution remains hard-coded in F-E1 fixture.** Synthesis endpoint properly validates `tenant_id` from the request body, but the F-E1 page's `assignment` fixture still hard-codes `tenant_id: 'tenant_ggr'`. The Phase 1F `Phase1F_FieldCapture_AssignmentFromAuthContext` brief (canon `50bc668`) replaces this when a real auth substrate ships; deferred per the doctrine "phone loop first."

7. **`learning_signal.captured` events aren't emitted from F-E1.** Phase 1H Lane 3 (Cursor · draft-review-surface) owns the operator's Accept/Edit/Reject actions, which fire `draft.corrected`/`draft.accepted`/`draft.rejected` and the bundled `learning_signal.captured`. Lane 1's contribution is only the synthesis step's `draft.synthesized` event. The full loop requires Lane 3.

---

## Open questions

1. **Should Build Draft also work when the operator has ONLY a typed note** (no voice, no photo)? Currently yes — the handler checks for any non-empty input. Confirm this matches your intent for the iPhone loop.

2. **Should successful synthesis suppress relay-card surfacing of the underlying capture?** Right now the deterministic 9-fact chain still runs on `daily_log.entry_captured` (the capture event from step 1). When synthesis succeeds, the operator gets BOTH a draft (model-led) and a relay card (deterministic). For dogfood, useful for comparison; for production, may be noisy. Suggest deferring the answer until you've used the loop a few times.

3. **Memory packet shape.** I assumed Lane 4 produces markdown structured per the brief's example:
   ```
   # Tenant Memory
   ...
   # Project Context
   ...
   # Recent Corrections
   ...
   ```
   If Lane 4 produces a different shape, the synthesis service's `buildUserPrompt` may need updates. Coordinate with Lane 4's output schema at integration.

4. **Sonnet 4.6 fallback to Sonnet 4.7 (or whatever's strongest).** D-047 registered Sonnet 4.6 specifically. If 4.7 is approved later, the constant `DRAFT_SYNTHESIS_MODEL` updates and the hosting registry needs the new endpoint added. Not in scope for this PR.

---

## PR opened or not

**PR not opened.** Per the brief's Agent Completion Protocol: the agent pushes the branch and writes this report; the Codex quarterback opens PRs at gate time.

Branch is pushed to `origin/phase-1h-heavy-synthesis-path` after the final commit lands. Codex can gate via:

```bash
git fetch origin
git checkout phase-1h-heavy-synthesis-path
git log --oneline origin/main..HEAD     # confirm two commits: Day 1 event contract + Day 2 synthesis path
```

---

## Acceptance · the brief's bar

Per the brief: *"Christian can tap Build Draft after capture and land on Draft Review with useful draft content. Synthesis failure produces a useful error and fallback, not silence. The model output is schema-validated before persistence."*

This lane delivers items 2 and 3 fully. Item 1 (landing on Draft Review with useful content) requires:

- This lane (Build Draft button → synthesis → draft.synthesized event + redirect) ✓
- Lane 3 (the `/draft-review/:draft_id` surface that renders the draft) — not in this branch
- Lane 2 (voice reality stopgap so the transcript field is real) — not in this branch
- Lane 4 (context memory stopgaps so the synthesis has useful context) — not in this branch
- Deploy (Codex Lane 5) with `ANTHROPIC_API_KEY` + `KERF_SYNTHESIS_CONSENT_TENANTS=tenant_ggr` in Fly secrets

After all four lanes integrate, the iPhone smoke is:

1. Open `/field-capture` on phone
2. Record voice or type a note
3. (Stop recording · transcription completes or fails honestly · Lane 2)
4. Tap **Build Draft**
5. See "Saving capture and asking Kerf to draft..." → "Draft ready. Opening Draft Review…"
6. Browser navigates to `/draft-review/:draft_id`
7. See the synthesized draft (Lane 3 surface)
8. Edit / accept / reject (Lane 3 actions fire the rest of the loop events)

---

*Phase 1H Lane 1 · Heavy Synthesis Path report · drafted 2026-05-28 by Claude Code.*
