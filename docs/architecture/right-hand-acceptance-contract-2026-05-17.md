# Right Hand Acceptance Contract

- **Date:** 2026-05-17 (early morning, mid-Sprint E)
- **Author:** Claude (Agent 8, integration lead) — drafted under Christian's review-of-post-mortem
- **Status:** **Active release gate** for Sprint E.1, E.2, E.3, and any future PR claiming to advance the Right Hand orchestrator.
- **Why this exists:** The post-mortem on 2026-05-17 named seven causes of the architectural drift. The 7th — *"we didn't encode agentic behavior as a release gate"* — is the meta-cause that let the other six compound. CI gates checked typecheck + tests + forbidden-surface invariants. Nothing checked **product shape**. This doc is the missing gate.

---

## How this contract is applied

Every PR that touches `src/agents/right-hand/*` OR claims to advance Sprint E **must**:

1. Reference this contract in the PR description by section heading
2. Demonstrate each criterion is met (link to test, code line, or recorded demo step)
3. If a criterion is partially met or deferred, name it explicitly with a follow-up
4. **Refuse to merge** until all applicable criteria pass

This is not a soft guideline. It's a release gate. PR authors (Claude or Cursor) self-audit against it before requesting review; the reviewer audits against it before approving.

---

## The six criteria

### 1. Whole-capture hypothesis happens BEFORE specialist invocation

**The criterion:** The orchestrator reads the full transcript and forms a hypothesis (project type, operator intent, transcription quality, ambiguity flags) **before** any specialist tool runs. Specialists are invoked based on the hypothesis, not unconditionally.

**How to verify:** Trace `runRightHandOrchestrator` execution order. The first action MUST be `runWholeCaptureHypothesis(...)`. The hypothesis's `transcription_quality` and `operator_intent` MUST be read by the decision tree before any `toolRegistry.*.invoke()` call.

**Failure modes to watch for:**
- Direct specialist invocation that bypasses hypothesis (e.g., a code path that calls `runFieldCapturePlay` outside the orchestrator)
- Specialist outputs that override the hypothesis's intent flag
- Hypothesis used only for logging, not for routing

**E.1 status:** ✅ Passes. `orchestrator.ts:181` is the hypothesis call; specialists at `:262+` are gated on hypothesis fields.

---

### 2. Garbled transcripts trigger semantic clarification, not fragment prompts

**The criterion:** When `transcription_quality === 'mostly_failed'` OR the hypothesis carries `garbled_segment_indices`, the operator-facing clarification asks about the **whole capture's intent + project**, NOT about individual unreadable words.

**How to verify:** Read every clarification prompt the orchestrator can emit. None can include verbatim garbled tokens (`tgkidgn`, `ascljsnd`). All must offer a hypothesis-shaped question like "Sounds like this might be a bath remodel — am I right?"

**Failure modes to watch for:**
- F-34-style "What should Kerf assume for 'X'?" where X is a garbled token
- Clarification copy that quotes the broken phrase back to the operator
- Multiple per-fragment prompts on one capture

**E.1 status:** ✅ Passes. `orchestrator.ts:220` emits a single hypothesis-shaped prompt; no fragment quotes. Test: `garbled transcript: skips specialists, emits clarification only`.

**E.2 status:** ⏳ The clarification UI must render orchestrator-derived prompts only. No fallback to parser-driven copy.

---

### 3. Right Hand returns exactly ONE `the_one_thing` per capture

**The criterion:** Every orchestrator response carries one `the_one_thing` string — the single top-priority surfaced output. Not a list of facts cards. Not a notification feed. **One headline.**

**How to verify:** `RightHandResponse.the_one_thing` is `string` (not array). Tests assert the field exists and matches expected operator-voice patterns per scenario.

**Failure modes to watch for:**
- Multiple "top priority" strings concatenated
- The string being a dump of all extracted facts
- Empty/undefined `the_one_thing` (must always be populated, even if "nothing actionable")

**E.1 status:** ✅ Passes. Single string field on every code path; tests verify non-empty.

**E.3 status:** ⏳ Right Hand Home renders `the_one_thing` in a SINGLE prominent panel above everything else. Not a list. Not a feed.

---

### 4. Tool invocation is reasoned, not mechanical

**The criterion:** The orchestrator's `tools_invoked` array names every tool considered + whether it ran + a one-sentence operator-voice reason. Tools are skipped (with reason) when the hypothesis or upstream tool outputs don't justify them.

**How to verify:** Read `tools_invoked` from any orchestrator response. Every entry has `tool_name`, `invoked` (bool), `reason` (non-empty). Mechanical "always run all four tools" patterns are forbidden.

**Failure modes to watch for:**
- Fixed pipeline that runs all specialists regardless of hypothesis
- Tools skipped without recorded reason (silent skips break the audit trail)
- Reasons that dump internal state instead of explaining the decision

**E.1 status:** ✅ Passes. Drift Watcher skipped when facts empty (with reason); Relay Surfacer skipped when no drift (with reason); Change Order Agent skipped when not wired (with reason). Test: `tools_invoked lists every tool the orchestrator considered, invoked or not`.

---

### 5. Right Hand Home renders `right_hand_response` as the primary experience

**The criterion:** The deployed UI's root route (`/` or `/home`) is **Right Hand Home**, not a flat dashboard. The page's primary panel is `the_one_thing`. Below it: reasoning trail (collapsible) + supporting cards (de-emphasized).

**How to verify:** Hit `https://kerf-v15-internal.fly.dev/` after deploy. The first thing the operator sees must be `the_one_thing`, not a route stack. Voice-canon copy ("Right Hand says...") prefixes the synthesis text.

**Failure modes to watch for:**
- Root route still rendering the proposal-first dashboard
- `the_one_thing` buried below other UI chrome
- Synthesis copy without voice-canon prefix where it should have one
- "Right Hand says..." prefix on text the orchestrator didn't produce (false agency)

**E.3 status:** ⏳ This is the criterion E.3 must demonstrably pass before merge.

---

### 6. The live path doesn't pretend heuristics are richer than they are

**The criterion:** When the orchestrator falls back to deterministic heuristics (no LLM client wired, OR LLM call failed), the reasoning trail says so explicitly. The operator-facing surface acknowledges the limitation. Confidence bands stay calibrated to actual confidence (low when heuristics are guessing).

**How to verify:** Inspect a `right_hand_response` where `hypothesis.hypothesis_authority === 'deterministic_fallback'`. The reasoning trail's hypothesis entry must include phrasing like "Heuristics only — LLM hypothesis not wired yet" OR equivalent. The_one_thing must not overstate confidence.

**Failure modes to watch for:**
- Reasoning trail entries that read identically whether LLM or fallback fired (provenance hidden)
- "I think this is definitely X" framing on low-confidence deterministic outputs
- UI that displays heuristic-derived hypotheses with the same authority as LLM-derived ones

**E.1 status:** ✅ Passes. `orchestrator.ts:215` appends "(Heuristics only — LLM hypothesis not wired yet)" when authority is deterministic. Test: hypothesis assertions verify `hypothesis_authority` field.

**Live LLM wiring status:** ⏳ Until Groq client routes through to orchestrator's `llmClient` param in production env, the deployed app runs in deterministic-fallback mode. Criterion 6 stays satisfied because we say so explicitly; it isn't met because the live path is RICH yet — it's met because the live path is HONEST about being thin.

---

## Sprint E sub-step gate matrix

| Sub-step | Criteria 1-6 required to pass |
|---|---|
| **E.1** (orchestrator skeleton) | 1, 2, 3, 4, 6 — all pass at PR #213 (commit `fa653b7`) |
| **E.2** (clarification UI rebuild) | 2 (the central criterion for E.2), plus 3, 4, 6 preserved |
| **E.3** (Right Hand Home) | 5 (the central criterion for E.3), plus 1, 2, 3, 4, 6 preserved |
| **Live LLM wiring** | 6 in particular — the criterion this PR shifts from "honest about being thin" to "actually rich" |

A Sprint E sub-step PR that fails any of its required criteria does not merge. Period.

---

## What this contract does NOT do

- It does NOT replace code-level CI gates (typecheck, tests, forbidden-surface invariants). Those stay.
- It does NOT automate the verification. The criteria are graded by a human (Christian, Codex review, or Claude self-audit). V2.0 may add LLM-graded evals against this contract.
- It does NOT extend beyond Sprint E. After Sprint E closes, this contract is referenced by Step F (modality routers for photo/LiDAR/plans) but those will have their own modality-specific contracts.

---

## Why this is in main, not in a session note

The drift happened because aspirational shape lived in docs while runtime code drifted. This contract is in main alongside the code so the asymmetry can't repeat. If a future contributor (human or agent) wants to advance Right Hand work, they read this contract from the codebase, not from session memory.

This is the missing release gate. It's in main now.
