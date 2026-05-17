# Sprint E.3 PR 0 — Document Manager LLM extraction upgrade

- **Date:** 2026-05-16 (evening — written after manual dogfood caught a trust failure on a real bathroom-rough capture)
- **Author:** Claude (Agent 8, integration lead)
- **For:** Claude (Agent 8) implements. Codex reviews pre-merge.
- **Status:** Live brief. **Elevated priority — high care.**
- **Release gate:** [Right Hand Acceptance Contract](../architecture/right-hand-acceptance-contract-2026-05-17.md) — Criterion 7 binds (this PR ships a visible operator-facing improvement; the surface change is the corrected synthesis on `/field`). Criterion 6 binds (the new authority field carries provenance honestly).
- **Predecessors:**
  - [Sprint E brief 2026-05-16](./sprint-e-right-hand-orchestrator-2026-05-16.md)
  - [Sprint E.3 Home brief 2026-05-16](./sprint-e3-right-hand-home-2026-05-16.md) — **deferred until this PR lands; Home is a trust amplifier and the synthesis underneath it must be right first**

---

## 1. Standing rules (verbatim — preserve in handoff)

> You are working on GGRValle/kerf-app in the compressed F&F proposal-first push.
>
> Operating rules:
> - Base every branch on fresh main.
> - Keep PRs small and scoped.
> - Do not touch Policy Gate, schemas, fixtures, workflows, or EventLog unless your specific task says so.
> - Run the requested verification gate before reporting done.
> - Push your branch and open a PR if gh is available; otherwise push and report branch + commit.
> - Never rewrite frozen evidence under `src/examples/evidence/2026-05-02-w1` unless explicitly assigned.
> - No fetch, no Platform calls, no real auth, no backend writes unless explicitly assigned.
> - Report: branch, commit, files changed, tests run, what could break.

**Hard repo limits:** no force-push, no `git reset --hard`, no `clean -fd`, no `rm -rf`, no pre-merge branch deletion.

---

## 2. Why this PR exists

Manual /field dogfood on 2026-05-16 (live deploy) captured a real voice memo:

> *"Yeah, we did rough this bathroom out and the toilet was not installed. The sinks were installed and the shower door still needs to be installed. So progress looks to be about 80%. We noted that the tile looks like it needs to be reworked at the border of the dam. And the homeowner asked me if we could add another niche..."*

Right Hand replied:
> *"Henderson bath remodel — Completed: and the shower door still needs to be installed. Nothing here needs you right now."*

**Four errors in one synthesis:**
1. **Polarity inversion** — read "still needs to be installed" as a completion
2. **Missed owner-requested scope change** — "homeowner asked about another niche" → not flagged
3. **Missed quality flag** — "tile needs to be reworked at the border" → not flagged
4. **False calm** — "nothing here needs you right now" while a scope inquiry sits unanswered

The whole-capture hypothesis pass (LLM, live in main since 2026-05-16 evening) correctly classified this as `progress_update` on a `bath_remodel`, `clean` quality, `llm_inferred` authority. **The hypothesis layer is doing its job.**

The **specialists below the hypothesis** are still the deterministic B.4-era regex extractors. `src/persistence/dailyLogExtractor.ts` is a pure pattern-matching function that:
- Has no negation handling (matches "installed" without checking "still needs to be")
- Has no concept of `progress_pct`, `open_items`, or `quality_flags` as fact buckets
- Has a narrow keyword table for `scope_change_flags` that misses semantic owner-requested additions

Drift Watcher sits downstream of this and can only classify what extraction gives it. If extraction says "shower door completed," Drift never sees the open item. If extraction doesn't tag the niche question, Drift never gets the chance to fire scope-change-severity on it.

**Per Christian's diagnosis (2026-05-16):** *Drift Watcher is downstream of a lie. Fix extraction first; only LLM-ify Drift if it still misses after extraction is real.*

---

## 3. The polarity test — the heart of this PR

> **If the LLM extraction returns structurally valid JSON but polarity conflicts with obvious transcript language, the test suite must catch it with canonical fixtures.**

This is the bar. Not "can the LLM emit JSON." JSON output is the easy part. The hard part:

- *"the shower door still needs to be installed"* — must land in `open_items`, NOT `completed_work`
- *"we didn't get to the toilet"* — must land in `open_items`, NOT skipped
- *"we almost finished the tile"* — must land in `open_items`, NOT `completed_work`
- *"homeowner asked about another niche"* — must land in `scope_change_flags` (semantic owner-requested addition; no "change order" keyword needed)
- *"tile needs to be reworked at the border"* — must land in `quality_flags`
- *"have to pull it back and redo the border"* — must land in `quality_flags` (semantic rework; no "rework" keyword)

Fixture-driven test cases (section 8) prove these. **If any of these polarity assertions fails, the PR doesn't merge — we iterate on the prompt.**

---

## 4. What ships

### Files

**New:**
- `src/agents/right-hand/llm-config.ts` — shared LLM constants (extracted from `whole-capture-hypothesis.ts`)
- `src/agents/right-hand/document-manager-extraction.ts` — LLM extraction body, deterministic fallback, exported prompt + schema
- `tests/agents-right-hand-document-manager-extraction.test.ts` — 7 canonical fixtures + regression locks
- `tests/agents-right-hand-llm-config.test.ts` — verifies shared config exports the constants and they pass `checkHostingRoute()` (same semantic test pattern as #217)

**Modified:**
- `src/agents/right-hand/whole-capture-hypothesis.ts` — read constants from `llm-config.ts`, remove local definitions (keep re-export for one cycle to avoid churn? **see open question §13**)
- `src/agents/right-hand/tool-registry.ts` — `DocumentManagerTool.invoke` returns `Promise<DailyLogFactsExtractedEvent>` (was sync), DI accepts `llmClient` via registry constructor
- `src/agents/right-hand/orchestrator.ts` — `await toolRegistry.documentManager.invoke(...)`
- `src/persistence/events.ts` — `DailyLogFactsExtractedEvent` gains optional envelope provenance: `extraction_authority?: 'llm_inferred' | 'deterministic_fallback'` and `model_used?: string`
- `src/persistence/fieldCapture.ts` — accepts an optional `extractor` parameter (the new async LLM extractor); falls back to the existing `extractDailyLogFacts()` when not provided. **Keeps the existing sync signature for callers that don't need the LLM path.**
- `scripts/serve-v15-vertical-slice.ts` — wires the LLM-backed extractor into the tool registry (same `RIGHT_HAND_LLM_CLIENT` it already constructs)
- `tests/persistence-daily-log-extractor.test.ts` — **unchanged** (locks the deterministic extractor; that's our fallback)
- `tests/agents-right-hand-orchestrator.test.ts` — update stub document manager to async; assertions unchanged
- `tests/agents-right-hand-whole-capture-hypothesis.test.ts` — update references to renamed constants

### Schema diff — `DailyLogExtractedFacts`

```diff
 export interface DailyLogExtractedFacts {
+  // Percentage progress when the operator stated it explicitly. Null
+  // when not stated. The LLM does NOT infer this from other signals.
+  readonly progress_pct: number | null;
+
   readonly completed_work: readonly string[];
+
+  // Items the operator mentioned but did NOT mark as done, with no stated
+  // blocker. ("Still needs to be installed", "didn't get to", "almost
+  // finished".) Items with an explicit blocker go to `blocked_work`.
+  readonly open_items: readonly string[];
+
   readonly blocked_work: readonly { description: string; blocker: string }[];
   readonly schedule_status: 'on_track' | 'behind' | 'ahead' | 'unknown';
   readonly new_task_candidates: readonly string[];
   readonly scope_change_flags: readonly string[];
+
+  // Existing work that needs to be redone, reworked, or corrected.
+  // Detected semantically — keyword "rework" not required.
+  readonly quality_flags: readonly string[];
+
   readonly money_risk_flags: readonly string[];
   readonly client_decision_flags: readonly string[];
   readonly materials_needed: readonly string[];
   readonly inspection_notes: readonly string[];
   readonly safety_notes: readonly string[];
 }
```

Three new fields, ten preserved. `EMPTY_EXTRACTED_FACTS` constant updated to include `progress_pct: null, open_items: [], quality_flags: []`. Deterministic fallback leaves the three new fields empty/null (regex extractor doesn't infer them).

### Schema diff — `DailyLogFactsExtractedEvent` envelope

```diff
 export interface DailyLogFactsExtractedEvent extends BasePersistenceEvent {
   readonly type: 'daily_log.facts_extracted';
   readonly entry_id: string;
   readonly facts: Readonly<Record<string, unknown>>;
+
+  // Provenance — added Sprint E.3 PR 0. Optional for backward compat with
+  // events persisted before this PR. Readers tolerate absence; emitters
+  // always stamp going forward.
+  readonly extraction_authority?: 'llm_inferred' | 'deterministic_fallback';
+  readonly model_used?: string;
 }
```

Optional fields → existing JSONL events without these keys remain valid. Forward, every emission stamps both.

### `llm-config.ts`

```ts
/**
 * Shared LLM endpoint + model for Right Hand agents (hypothesis pass +
 * Document Manager extraction). Single source of truth so the (endpoint,
 * model) pair drifts in exactly one place when it drifts.
 *
 * Per Christian's 2026-05-16 ruling: name for the role it serves now, not
 * a generic LLM_ENDPOINT. These constants are scoped to Right Hand's LLM
 * use — they are not a general-purpose model selector for the rest of the
 * app.
 */
export const RIGHT_HAND_LLM_ENDPOINT = 'groq://llama-70b' as const;
export const RIGHT_HAND_LLM_MODEL = 'llama-3.3-70b-versatile' as const;
```

The hypothesis module's existing `HYPOTHESIS_LLM_ENDPOINT` / `HYPOTHESIS_LLM_MODEL` exports become re-exports of these for one cycle to keep the test surface stable, OR get renamed in lockstep. **See §13.**

---

## 5. Prompt (full text, locked in `document-manager-extraction.ts`)

```
You are extracting structured facts from a contractor project manager's
voice memo at the end of a workday. The memo describes work completed,
work in progress, observations about quality, and conversations with the
client. Your job is to organize these into a strict schema.

CRITICAL: pay attention to negation and polarity. The single most
important thing this extraction must get right is whether work was
completed or remains open.

Examples of polarity:
  - "we pulled the tub surround"             → COMPLETED
  - "we installed the sinks"                 → COMPLETED
  - "the shower door still needs to be installed" → OPEN ITEM
  - "we didn't get to the toilet"            → OPEN ITEM
  - "we almost finished the tile"            → OPEN ITEM
  - "we have to pull the border tile back and redo it" → QUALITY FLAG
  - "tile needs to be reworked at the border"   → QUALITY FLAG
  - "homeowner asked if we could add another niche" → SCOPE CHANGE FLAG
  - "owner wants the wine fridge moved to the island" → SCOPE CHANGE FLAG
  - "we're about 80% done"                   → progress_pct = 80
  - "still waiting on the inspector"         → BLOCKED WORK
  - "Carlos hurt his hand on the saw"        → SAFETY NOTE

Distinctions that matter:
  - OPEN ITEM = not done, no stated blocker (e.g., "still needs to be").
  - BLOCKED WORK = not done because of a stated blocker (e.g., "waiting on
                   the inspector"). Always pairs with a blocker phrase.
  - QUALITY FLAG = existing work that has to be redone, reworked, or
                   corrected. Different from open work — this is rework.
  - SCOPE CHANGE FLAG = owner-requested addition or modification to the
                        project scope. Detect SEMANTICALLY. Do not require
                        the words "change order" or "scope." "Homeowner
                        asked about X," "owner wants to add Y," "they want
                        us to also do Z" all count.

Output ONLY JSON matching this schema. No prose. No markdown fences.

{
  "progress_pct": <number 0-100 or null>,
  "completed_work": [<short phrase>...],
  "open_items": [<short phrase>...],
  "blocked_work": [{"description": <string>, "blocker": <string>}, ...],
  "schedule_status": "on_track" | "behind" | "ahead" | "unknown",
  "new_task_candidates": [<short phrase>...],
  "scope_change_flags": [<short phrase>...],
  "quality_flags": [<short phrase>...],
  "money_risk_flags": [<short phrase>...],
  "client_decision_flags": [<short phrase>...],
  "materials_needed": [<short phrase>...],
  "inspection_notes": [<short phrase>...],
  "safety_notes": [<short phrase>...]
}

Rules:
  - Use empty array [] (not null) when no items match a list field.
  - progress_pct is null when not stated; do NOT infer from other signals.
  - Short phrases ≤ 8 words; quote the operator's words when possible.
  - Do not invent items not present in the transcript.
  - schedule_status defaults to "unknown" if no language suggests pace.
  - Output JSON only.
```

**Prompt-engineering notes for the implementer:**
- The polarity examples are not decorative. They calibrate the model against the exact failure mode that triggered this PR.
- "Output ONLY JSON. No markdown fences." mirrors what the hypothesis prompt says. Llama 3.3 70B still occasionally wraps output in fences anyway — the fence-stripping cleanup in `whole-capture-hypothesis.ts:322-328` is the proven workaround. **Reuse that exact pattern.**
- Temperature: 0.1 (same as hypothesis). Higher temperatures hurt structured extraction.
- maxTokens: ~600 (more than hypothesis since output is longer). Verify against the largest fixture's expected output before locking.

---

## 6. Fallback behavior — the contract

```
LLM call success + valid JSON + required fields present
  → extraction_authority = 'llm_inferred'
  → model_used = 'groq-llama-3.3-70b-versatile'
  → facts from LLM output

LLM call returns !ok (route_rejected, http_error, network_error, etc.)
  → console.warn('[doc_manager] LLM extraction call failed (kind=..., reason=...) — falling back')
  → extraction_authority = 'deterministic_fallback'
  → model_used = 'deterministic_fallback'
  → facts from extractDailyLogFacts() (existing regex extractor)
  → progress_pct = null
  → open_items = []
  → quality_flags = []

LLM call ok but content not valid JSON
  → console.warn('[doc_manager] LLM returned non-JSON content (...) — content preview: ...')
  → fall back as above

LLM call ok, JSON parseable, but missing required schema fields
  → console.warn('[doc_manager] LLM returned JSON missing required fields — got keys: ...')
  → fall back as above

LLM call ok, JSON valid, schema valid, but a field has wrong type
  → log + fall back
```

The orchestrator reasoning trail should reflect provenance. When `extraction_authority === 'deterministic_fallback'`, add a line like *"Document Manager pulled facts via deterministic heuristics — the LLM extraction didn't reach this capture."* Same honesty pattern as criterion 6.

This means: even if Groq has a 10-hour outage, the system still works the way it does today. **The LLM path is a strict upgrade, not a critical dependency.**

---

## 7. Backward compatibility (the persistence event log)

`DailyLogFactsExtractedEvent`'s new envelope fields (`extraction_authority`, `model_used`) are **optional readonly fields on the interface**. Existing JSONL events written before this PR landed do not carry them.

Readers:
- `eventStore` JSONL parser: needs no change (it's loose `unknown`-typed read; consumers narrow downstream).
- Projection layer / `field-daily-capture.ts` UI: must handle `extraction_authority === undefined` as equivalent to `'deterministic_fallback'` (the only mode that existed when those events were written). One-line guard.
- Any new event written by this PR's code path: always stamps both fields. Verify with a test.

The validator (`validatePersistenceEvent`) needs a quick check — confirm it doesn't reject events with new optional fields it doesn't know about. (Pre-PR: the validator is boundary-focused; optional unknown fields pass through. Verify in the PR.)

---

## 8. Test fixtures — the 7 canonicals

Co-locate as `const FIXTURES = [...]` at the top of `tests/agents-right-hand-document-manager-extraction.test.ts`. Each fixture = `{ name, transcript, entry_kind, expected_facts_partial }`. The test framework runs each fixture twice: once with a stub LLM that returns the expected facts as JSON (verifies the parse path) and once with no LLM injected (verifies the deterministic fallback returns a sensible-but-reduced shape).

**Fixture roles** (Christian's 2026-05-16 ruling):
- **Primary fixtures (1, 2, 5, 6, 7)** — the polarity / semantic / scope / rework / progress pressure points. These are the calibration targets. A regression in any of these = PR doesn't merge.
- **Secondary regression fixtures (3, 4)** — garbled and calm. They guard against different failure modes than the polarity tests: garbled tests "don't hallucinate," calm tests "don't over-react." Both are real trust bugs even though they're not the sharpest extraction failures.

### Fixture 1 — Bathroom rough (THE polarity test) — *primary*
```
Yeah, we did rough this bathroom out and the toilet was not installed.
The sinks were installed and the shower door still needs to be installed.
So progress looks to be about 80%. We noted that the tile looks like it
needs to be reworked at the border of the dam. And the homeowner asked
me if we could add another niche. I'm not sure if that's possible, but
let's ask the tile guy if he can do it. Thank you.
```
Expected (LLM path):
- `progress_pct: 80`
- `completed_work: includes("sinks installed")` (or similar phrasing)
- `open_items: includes("toilet not installed") AND includes("shower door")`
- `quality_flags: includes("border tile rework")` (or similar)
- `scope_change_flags: includes("homeowner asked about another niche")` (or similar)
- `schedule_status: 'unknown'`

### Fixture 2 — Henderson clean (legacy regression target) — *primary*
```
Kevin here at Henderson — we pulled the tub surround and there's
galvanized all the way back to the main. Gotta replace about 8 feet.
Bumping you on the CO.
```
Expected (LLM path):
- `completed_work: includes("pulled the tub surround")`
- `money_risk_flags: includes("galvanized")`
- `scope_change_flags: at least one entry mentioning galvanized scope`
- `schedule_status: 'behind'`
- `materials_needed: includes a phrase with "8 feet"`
- `open_items: []` (nothing explicitly left open)

### Fixture 3 — Garbled partial — *secondary regression (don't hallucinate)*
```
hey we ascljsnd jklsjdn xkznvk the tub thing
```
Expected: facts MOSTLY EMPTY — LLM should NOT hallucinate items from garbled tokens. Acceptable shape: `completed_work: []`, `open_items: []`, possibly one entry about "tub" in some bucket. **Hallucination = test failure.**

### Fixture 4 — Calm progress — *secondary regression (don't over-react)*

Calm transcripts must produce calm extractions. Over-extraction here would feed Drift Watcher false signals and surface false urgency on Right Hand Home — a real trust bug even though it's not a polarity failure. Christian's note: "false urgency is a trust bug; over-extraction can poison downstream drift classification."
```
Got the demo finished today. Tub surround is out, drywall is back to the
studs. Trash haul tomorrow morning. Will pick up plumbing rough on
Thursday once the wall is dry.
```
Expected:
- `completed_work: includes("demo finished") AND includes("tub surround out")` (or similar)
- `new_task_candidates` may include the Thursday plumbing rough
- `open_items: []` — Thursday's plumbing rough is planned, not open right now
- `schedule_status: 'on_track' or 'unknown'`
- No scope/money/quality flags

### Fixture 5 — Negation edge cases (the prompt's calibration target) — *primary*
```
We almost finished the tile in the main bath. Didn't get to the toilet
install — water shutoff was still tagged. And the vanity is still
sitting on pallets in the garage. Should be able to wrap it tomorrow.
```
Expected:
- `open_items` contains the tile (almost finished ≠ done), the toilet (didn't get to), and the vanity (still sitting)
- `blocked_work` may pair the toilet with "water shutoff tagged" if the LLM reads that as a blocker
- `completed_work: []` (nothing was actually completed in this transcript)

### Fixture 6 — Owner-asked scope addition (no CO keyword) — *primary*
```
Spoke with the homeowner today — they mentioned they'd want to upgrade
the recessed lights to dimmable LEDs while we're already in the ceiling.
Also asked about adding USB outlets in the master. I told them we'd
think about it.
```
Expected:
- `scope_change_flags` contains both: the dimmable LED upgrade AND the USB outlets
- No `client_decision_flags` (the PM said they'd think about it; this is open scope inquiry, not pending owner decision)
- No "change order" keyword appears anywhere in the transcript — the LLM must detect semantically

### Fixture 7 — Rework without 'rework' keyword — *primary*
```
The tile guy is going to have to pull the border back and redo it. The
mortar set unevenly along the long edge and you can see it under raking
light. Same crew, just a couple hours of rework.
```
Expected:
- `quality_flags` contains the border rework
- `schedule_status: 'unknown'` (or `'behind'` if "couple hours of rework" reads as a small slip)
- No safety, money, or new-task flags

### Regression locks (must still pass)
- All tests in `tests/persistence-daily-log-extractor.test.ts` — locks the deterministic extractor unchanged
- All tests in `tests/agents-right-hand-orchestrator.test.ts` — locks the orchestrator's decision tree (stub doc manager goes async; assertions unchanged)
- All tests in `tests/agents-right-hand-whole-capture-hypothesis.test.ts` — must still pass after the constants are renamed/moved

---

## 9. Acceptance — the end-to-end proof

After this PR merges and deploys:

1. Run the bathroom-rough transcript (Fixture 1) through the live `/api/projects/proj_henderson_bath/daily-log/entries` endpoint
2. The orchestrator's response carries:
   - `right_hand_response.tools_invoked[0].output_event_type === 'daily_log.facts_extracted'`
   - The facts event's `extraction_authority === 'llm_inferred'`
   - `facts.open_items` contains a phrase about the shower door AND the toilet
   - `facts.scope_change_flags` contains a phrase about the niche question
   - `facts.quality_flags` contains a phrase about the border tile
3. The Right Hand `the_one_thing` should now say something like one of:
   - *"Homeowner asked about another niche — review scope before closeout."*
   - *"Bathroom about 80% complete, but border tile needs rework and there's an owner scope question."*
4. **NOT "Nothing here needs you right now."**

The PR description must include the actual curl + response showing the corrected synthesis. Criterion 7 evidence.

---

## 10. Out of scope

- LLM-ifying Drift Watcher. Let extraction improve first; we revisit Drift only if it still misses on the new clean fact substrate.
- LLM-ifying Relay Surfacer. Same reasoning.
- LLM-ifying Change Order Agent. Separate. D.1.1 (PR #211) wires the deterministic CO agent first.
- Right Hand Home (E.3 PR 1). **Deferred until this lands.**
- Changing the prompt for the hypothesis pass. The hypothesis is working; don't co-edit.
- Adding new event types or projection layers. Schema extensions on existing events only.
- Refactoring `dailyLogExtractor.ts`. **Do not touch it.** It is the fallback. Its determinism is its job.

---

## 11. Reporting (required for PR description)

When the PR is ready:

- **Branch:** `feature/v15-doc-manager-llm-extraction-e3-pr0`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `npm run typecheck`, `npm test` (count + pass/fail). New extraction test file run separately too.
- **What could break:** honest list — backward compat with old JSONL events, the async signature change on `DocumentManagerTool.invoke`, any prompt sensitivity discovered during build.
- **Open questions for Christian:** anything unresolved during build (especially prompt calibration findings).

### Before/after evidence — REQUIRED at two levels (criterion 7)

The PR description must include a table showing the corrected behavior on at least **two transcripts** — Fixture 1 (bathroom rough, the trust-failure case) and one of Fixture 5/6/7 (your pick of the polarity/scope/rework primaries). Two levels per transcript:

**Level 1 — extracted facts (old vs. new)**

| Transcript | Deterministic facts (today, main) | LLM facts (this PR) |
|---|---|---|
| Bathroom rough | `completed_work: ['and the shower door still needs to be installed'], schedule_status: 'unknown', open_items: <field doesn't exist>, quality_flags: <field doesn't exist>, scope_change_flags: []` | `progress_pct: 80, completed_work: ['sinks installed'], open_items: ['toilet not installed', 'shower door not installed'], quality_flags: ['border tile needs rework'], scope_change_flags: ['homeowner asked about another niche']` |

**Level 2 — Right Hand synthesis (old vs. new `the_one_thing`)**

| Transcript | Old synthesis (today, main) | New synthesis (this PR) |
|---|---|---|
| Bathroom rough | "Completed: and the shower door still needs to be installed. Nothing here needs you right now." | (whatever this PR actually produces — e.g., "Homeowner asked about another niche; border tile needs rework before close-out. Bathroom ~80% complete.") |

**This closes the loop back to criterion 7 and the trust-amplifier point.** A PR that only proves the extraction improved is incomplete — what matters is whether the operator's eye sees a better answer at the top of the synthesis. If extraction is correct but `the_one_thing` is unchanged, that's a finding worth reporting (the synthesis layer needs follow-up too) — not a reason to merge.

Generate the table by running the same transcript through:
1. `main` (before this PR) — record extracted facts + `the_one_thing`
2. This branch (after) — record extracted facts + `the_one_thing`

If running against the live deploy: redeploy on this branch to a staging Fly app, OR run locally with `npm run dev` and curl against `localhost:8010`. The redeploy path is preferred — it proves the wiring is correct end-to-end.

---

## 12. If anything in this brief is wrong, stop and ask

The previous three Sprint E sub-tasks each surfaced a bug because somebody actually tried the thing (deploy-smoke caught #216; dogfood-smoke caught #217; manual click-through caught this PR's reason for existing). The same vigilance applies here.

Specifically, **stop and ask if:**
- The bathroom-rough fixture produces a result the LLM is confident about but you suspect is still wrong — that's a prompt-engineering finding worth my eyes before you adjust silently
- A fixture's "expected" output feels wrong on second reading — better to fix the spec than to game the test
- The orchestrator's reasoning-trail copy needs to change to honestly describe the new authority field — that's a coordinated edit
- The async signature change on `DocumentManagerTool` cascades into a place not listed in §4 — surface the cascade before changing it

---

## 13. Open question for Christian: rename or re-export?

The shared LLM config replaces `HYPOTHESIS_LLM_ENDPOINT` / `HYPOTHESIS_LLM_MODEL` with `RIGHT_HAND_LLM_ENDPOINT` / `RIGHT_HAND_LLM_MODEL`. Two options for the transition:

**A) Hard rename.** Update every callsite + every test in this PR. Cleanest. The old names disappear.

**B) Re-export for one cycle.** Keep `HYPOTHESIS_LLM_ENDPOINT` as a re-export of `RIGHT_HAND_LLM_ENDPOINT` for backward compat through the PR; a follow-up PR removes the re-exports.

Recommend **A**. The only callers are inside `kerf-app`, the rename is mechanical, and re-exports tend to outlive their "one cycle" intent. This PR is the right moment to consolidate.

Unless you disagree, I'll proceed with A.
