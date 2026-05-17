# Sprint E — Right Hand Orchestrator (architectural correction)

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **For:** Cursor SDK + Claude (mixed-ownership sprint)
- **Status:** Live brief. Corrective pivot. Pauses Sprint D.1 (CO pricing pipeline) mid-flight to fix a deeper architectural drift surfaced by external code review on 2026-05-16.
- **Trigger:** Pair-review finding (full text in commit message + Christian's 2026-05-16 conversation): *"The current build has strong substrate and good safety bones, but the thing you actually experience is still too much like a response system. That is a real architectural drift."*

---

## 1. Standing rules (verbatim — preserve in every worker handoff)

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

## 2. Why Sprint E exists — the drift named

The external review's five findings, paraphrased:

| # | Severity | Finding |
|---|---|---|
| 1 | P1 | The user experiences workflow screens, not the **Right Hand surface**. |
| 2 | P1 | Clarification loop is **fragment-local parsing**, not whole-capture hypothesis-driven. |
| 3 | P1 | Plays are composed mechanically (pipeline), not under **named agent orchestration**. |
| 4 | P2 | No runtime `src/agents/` tree — agents live in canon, fixtures, comments, but not executable code. |
| 5 | P2 | Fixture / projection / demo infrastructure has **outpaced product behavior**. |

**The diagnosis:** the substrate is good. The safety spine is good. **The orchestrating surface is missing.** Plays-and-Policy-Gate is the bottom 60% of Kerf; what makes Kerf feel like Kerf is the top 40% — the Right Hand orchestrator that names the next thing that matters, asks the better question, composes across modalities. We built the substrate first. The orchestrator never showed up.

**Sprint E corrects this by building the orchestrator.** Not as a "future agent" — as the runtime layer that names the plays and surfaces the synthesis.

Per the Charter v1.0 framing (Christian's 2026-05-16 paste): the agent classes are **Right Hand (orchestrator), Sentry (compliance), Curation (KB writer), Auditor (governance)**. The specialists (Drift Watcher, Document Manager, Change Order Agent, etc.) are scoped tools the Right Hand invokes. **Sprint E builds the Right Hand class.**

---

## 3. What's kept, re-pointed, and new

### Kept (unchanged on main)
- `src/persistence/*` — event log, projections, persistence types, validators
- `src/altitude/*` — Policy Gate V1-V18 (Auditor body — already correct)
- `src/proposal/*` — ProposalArtifact, CSI divisions, §7159 validator
- All B.1-B.7 + C.1 + C.2 substrate work — these are tools the orchestrator will invoke
- The deployed app at `kerf-v15-internal.fly.dev` — substrate continues to serve

### Re-pointed (moved under orchestrator ownership without code change)
| Substrate file | Becomes | Reason |
|---|---|---|
| `src/persistence/fieldCapture.ts` | Field Hand surface intake → Right Hand orchestrator | Field Hand routes to orchestrator |
| `src/persistence/dailyLogExtractor.ts` | Document Manager body (filing/tagging) | Doc Mgr owns input filing per Charter v1.0 |
| `src/persistence/driftAdapter.ts` | Drift Watcher body (severity classifier) | Drift Watcher is Drift Watcher |
| `src/persistence/relayCardSurfacer.ts` | Right Hand orchestrator inner rule (which signals reach operator) | This is orchestrator logic |
| `src/persistence/fieldDailyToCoDraftPlay.ts` | Change Order Agent T2-draft body | Change Order Agent owns CO drafts |
| Scheduler block in `serve-v15-vertical-slice.ts` | **REPLACED** by Right Hand orchestrator call | Pipeline becomes orchestration |

No code moves in Sprint E. The namespace migration is a separate refactor PR after V1.5 launches. **The plays stay where they are; the orchestrator imports them as named tools.**

### New (Sprint E ships)
- `src/agents/right-hand/orchestrator.ts` — the runtime entry point
- `src/agents/right-hand/whole-capture-hypothesis.ts` — LLM-driven first-pass semantic read
- `src/agents/right-hand/tool-registry.ts` — explicit naming of specialists + I/O contracts
- `src/agents/right-hand/clarification-prompts.ts` — hypothesis-driven operator copy
- `src/agents/right-hand/voice-canon.ts` — "Right Hand says: ..." synthesis (final lock with Christian's voice canon brief)
- `src/examples/v15-vertical-slice/pages/right-hand-home.ts` — Right Hand Home UI ("The One Thing")

---

## 4. Three sub-steps (~10-14h total)

### E.1 — Whole-capture hypothesis + orchestrator skeleton (~4-6h, Claude)

**Files (new):**
- `src/agents/right-hand/orchestrator.ts`
- `src/agents/right-hand/whole-capture-hypothesis.ts`
- `src/agents/right-hand/tool-registry.ts`
- `tests/agents-right-hand-orchestrator.test.ts`
- `tests/agents-right-hand-whole-capture-hypothesis.test.ts`

**Whole-capture hypothesis pass:**
```ts
export interface WholeCaptureHypothesis {
  readonly project_type_hypothesis:
    | 'kitchen_remodel' | 'bath_remodel' | 'outdoor_kitchen'
    | 'deck' | 'addition' | 'unclear';
  readonly project_type_confidence: 'high' | 'medium' | 'low';
  readonly transcription_quality:
    | 'clean' | 'partial_failure' | 'mostly_failed';
  readonly garbled_segment_indices: readonly number[];
  readonly operator_intent:
    | 'progress_update' | 'blocker_report' | 'scope_change'
    | 'safety_note' | 'estimate_request' | 'unclear';
  readonly ambiguity_flags: readonly string[]; // free-text
  readonly model_used: string; // 'groq-llama-70b' or 'deterministic_fallback'
}

export function runWholeCaptureHypothesis(
  transcript: string,
  projectContext: { project_type?: string; recent_entry_kinds?: string[] },
  options?: { llmClient?: GroqClient }
): WholeCaptureHypothesis;
```

Tier-1: Groq Llama 70B (already wired in `src/altitude/modelAdapter/groqClient.ts`).
Fallback: if LLM unavailable, deterministic heuristic returns `unclear` for hypotheses and `clean` for transcription quality — orchestrator proceeds with specialists running on the raw transcript.

**Orchestrator:**
```ts
export interface RightHandResponse {
  readonly the_one_thing: string; // operator-facing top priority
  readonly reasoning_trail: readonly string[]; // why this surfaces
  readonly tools_invoked: readonly ToolInvocation[];
  readonly hypothesis: WholeCaptureHypothesis;
  readonly events_to_append: readonly PersistenceEvent[];
  readonly clarification_prompts: readonly ClarificationPrompt[]; // populated when ambiguity_flags non-empty
}

export function runRightHandOrchestrator(input: {
  capturedEvent: DailyLogEntryCapturedEvent;
  projectContext: ProjectContext;
  toolRegistry: ToolRegistry; // specialists available to invoke
}): Promise<RightHandResponse>;
```

**Orchestrator decision flow:**
1. Run whole-capture hypothesis (LLM or deterministic fallback)
2. If `transcription_quality === 'mostly_failed'` → skip specialist invocation; clarification_prompts populated with project-type-hypothesis question
3. If `project_type_hypothesis === 'unclear'` AND `operator_intent === 'unclear'` → clarification first
4. Else → invoke appropriate specialists from tool registry:
   - `operator_intent === 'progress_update'` → Document Manager (extract facts) + Drift Watcher (classify drift)
   - `operator_intent === 'scope_change'` → Document Manager + Change Order Agent (draft CO)
   - `operator_intent === 'blocker_report'` → Document Manager + Drift Watcher (severity high)
   - etc.
5. Compose specialists' outputs into `the_one_thing` + `reasoning_trail`
6. Return events to append + clarification prompts (if any)

**Tool registry:**
```ts
export interface ToolRegistry {
  readonly documentManager: DocumentManagerTool;
  readonly driftWatcher: DriftWatcherTool;
  readonly changeOrderAgent: ChangeOrderAgentTool;
  readonly relaySurfacer: RelaySurfacerTool;
}

// Each tool has a typed input/output contract:
export interface DocumentManagerTool {
  readonly invoke: (input: { transcript: string; entry_kind: string }) => DailyLogExtractedFacts;
}
// ...
```

**Wires into the daily-log endpoint REPLACING the scheduler block.** The endpoint becomes:
```ts
const response = await runRightHandOrchestrator({ capturedEvent, projectContext, toolRegistry });
for (const event of response.events_to_append) {
  await eventStore.append(validation pass first);
}
jsonResponse(res, 201, {
  event: capturedEvent,
  right_hand_response: response,  // full orchestrator output
  projection,
});
```

**Tests (~15 tests):**
- Whole-capture hypothesis: clean transcript → high-confidence project type
- Garbled transcript → `mostly_failed` quality flag
- Mixed transcript → `partial_failure` + garbled_segment_indices populated
- LLM unavailable → deterministic fallback returns `unclear` cleanly
- Orchestrator: progress_update intent → invokes Doc Mgr + Drift Watcher
- Orchestrator: scope_change intent → invokes Doc Mgr + Change Order Agent
- Orchestrator: mostly-failed quality → no specialist invocation; clarification only
- Orchestrator: composes the_one_thing from specialist outputs
- Orchestrator: reasoning_trail names every tool invoked + decision
- Henderson canonical: end-to-end orchestrator response includes drift block + Change Order draft + the_one_thing = "Henderson: galvanized discovery, CO drafted at $560 (2 LF plumbing), needs your review before send"
- Tool registry: each tool's contract enforced by type system
- Forbidden-surface invariant

---

### E.2 — Clarification loop rebuilt as orchestrator behavior (~3-4h, Claude)

**Files:**
- `src/agents/right-hand/clarification-prompts.ts` (new)
- Updates to F-34 clarification UI (existing surface) to render orchestrator-derived prompts instead of fragment-local prompts

**Scope:**
- Clarification prompts come FROM the orchestrator's `clarification_prompts` field, not from fragment parsing
- Prompt shape: `{ question: string; hypothesis: string; option_a: string; option_b: string; allow_freeform: boolean }`
- Operator sees: *"I think this is a bath remodel. The 'ascljsnd' fragment around the upper area is likely transcription failure. Am I right about the project type? If yes, what was the upper-area scope?"*  — NOT: *"What should Kerf assume for 'ascljsnd'?"*

**Tests (~6):**
- Garbled transcript → prompt includes project-type hypothesis question
- Clean transcript with ambiguity → prompt asks about specific scope ambiguity
- High-confidence transcript → no clarification prompts (orchestrator proceeds with specialist invocation)
- Operator answer feeds back into a `transcript.reviewed` event (existing surface)
- Prompt copy goes through i18n keyspace (no hardcoded strings)
- Orchestrator with refined transcript on second pass produces stable hypothesis

---

### E.3 — Right Hand Home UI / "The One Thing" surface (~3-4h, Cursor)

**Files:**
- `src/examples/v15-vertical-slice/pages/right-hand-home.ts` (new)
- `src/examples/v15-vertical-slice/router.ts` (modify — make `/` and `/home` route here instead of flat dashboard)
- `src/i18n/keys.ts` + en.ts + es.ts (`rh.home.*` keyspace)
- `tests/v15-right-hand-home.test.ts` (new, ~6 tests)

**Scope:**
- Header: `KERF · RIGHT HAND`
- **"The One Thing" panel** (top of page, prominent): the orchestrator's top-priority surfaced output. Renders the most-recent `right_hand_response.the_one_thing` from any project across all tenants.
- **Reasoning trail** (collapsible, below The One Thing): which specialists were invoked, which sources were checked, why this surfaces above others.
- **Voice canon copy**: "Right Hand says: ..." prefix on synthesized copy (voice canon block still active for "Right Hand says" tone — but the synthesis text itself comes from orchestrator output)
- **Secondary list** (below): other open relay cards, less prominent. The flat `/relay` list still exists as `/relay/all` for full view.
- **§13 audit deep-link** on every surfaced item

**What this REPLACES on the deployed UX:**
- `/dashboard` becomes a redirect to `/home` (or just becomes the new Right Hand Home)
- The flat nav still works but isn't the primary entry point

**Tests (~6):**
- The One Thing component renders the orchestrator's top output
- Reasoning trail shows specialist invocations
- Voice canon prefix present where synthesis copy renders
- Secondary list shows other relay cards
- §13 audit link present
- No "Right Hand says" text without orchestrator-derived content (no premature voice copy)

---

## 5. The acceptance demo for Sprint E

After all three sub-steps land + deploy:

> Christian opens `https://kerf-v15-internal.fly.dev/` on his laptop. The page renders **Right Hand Home**, not a dashboard.
>
> The One Thing panel (top, prominent):
> *"Right Hand says: Henderson found galvanized in the tub-surround replacement — drafted Change Order at $560 (2 LF plumbing, tier-2 actuals) before this slows the schedule. Needs your review before send. [View draft] [Audit trail →]"*
>
> Reasoning trail (collapsible):
> *"Whole-capture hypothesis: bath_remodel project, progress_update intent, clean transcript. Document Manager extracted: completed_work=['pulled the tub surround'], money_risk=['galvanized'], scope_change=['galvanized all the way back to the main'], schedule=behind. Drift Watcher classified: block (3 signals firing). Change Order Agent drafted: 2-line CO @ $560 via Curation Agent's tier-2 KB lookup. Surfacing rule: block-severity drift with CO draft → top priority."*
>
> Kevin captures a second voice memo, this one garbled: *"hey we got the tgkidgn done on the upper ascljsnd."* Right Hand Home does NOT surface a parsing prompt. The clarification panel shows:
> *"Right Hand says: I think this is the Henderson bath remodel based on your recent captures. The transcript has degraded segments around 'upper area' — can you tell me what scope you wrapped up there?"*
>
> Christian responds. Orchestrator re-runs with refined input. The One Thing updates with the new synthesis.

**That's the demo.** Not "voice → list of facts cards." Not "clarification asks about fragments." **Right Hand making sense of the work and bringing forward the next thing that matters.**

---

## 6. Out of scope for Sprint E

- LLM-driven CO line-item drafting (separate Model Router work — D.1.x with orchestrator-invoked Change Order Agent uses existing deterministic CSI mapping for now)
- Multi-tenant orchestration (single-tenant V1.5)
- Photo / LiDAR / plan-upload modality routers (later Sprint F — same orchestrator pattern, different tools)
- Voice playback for "Right Hand says..." (synthesis text first; audio is V2.0)
- HOME/JOB/LOG/ME bottom-nav shell for Field Hand (separate)
- Namespace migration of `src/persistence/*` → `src/agents/*` (separate refactor PR after V1.5)
- The Sentry compliance class (separate sprint)
- The Curation Agent watcher loops (V1.5+ per Charter)

---

## 7. Sequencing notes

- **E.1 must land first** — it defines the orchestrator output shape that E.2 (clarification) and E.3 (UI) consume
- **E.2 and E.3 are parallel-safe** once E.1 lands — Claude on E.2, Cursor on E.3
- **D.0 and D.1.x re-emerge AFTER E** — as orchestrator-invoked tools, not standalone work
- **Architecture v3.5 §8 reconciliation** (Chief of Staff → Right Hand rename, add Sentry + Curation Agent rows, switch flat list to Charter class framing) lands as a separate canon-drift PR opportunistically

---

## 8. Reporting (required for each sub-step PR)

When each sub-step is ready, report in this exact shape:

- **Branch:** `feature/...`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `<commands + pass/fail counts>`
- **What could break:** `<honest list — even small risks>`

If you discover the design needs to deviate from this brief, **STOP and report before coding**. PR #198's canon-drift audit showed how spec drift creates downstream tax. Sprint E itself is a correction; let's not stack more drift on the correction.

---

## 9. The June 13 connection

Sprint E is what makes the V1.5 internal release demo feel like **Kerf** rather than a regex pipeline with a notification feed. Without Sprint E, the June 13 acceptance criterion ("Right Hand surfaces drift card with severity, click reviewed → closes loop") technically works on engineered input but doesn't feel agentic.

**With Sprint E, the same acceptance demo runs differently:** Kevin's iPhone captures voice → orchestrator hypothesizes project type + intent → invokes specialists → composes "The One Thing" → Christian's laptop shows Right Hand surfacing the synthesized priority with reasoning trail. Same chain, different surface, completely different felt experience.

The substrate built through Step B + Step C + (paused) D.1 is what makes this work. Sprint E is the layer those plays were always waiting for.
