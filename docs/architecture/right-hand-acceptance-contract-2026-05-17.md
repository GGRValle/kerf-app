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

**The criterion:** The deployed UI's root route (`/` or `/home`) is **Right Hand Home**, not a flat dashboard. The page's primary panel is `the_one_thing`. Below it: one suggested next action, then reasoning trail (collapsible) + supporting cards (de-emphasized). The page shows **one primary response, one next action, calm supporting detail underneath** — not "more information, better organized."

**The feel test (acceptance line from Christian, 2026-05-17):**
> *"When I open `/`, I should immediately understand what Right Hand thinks matters, without clicking into transcript, audit, or route navigation."*

If a viewer's first reaction to the root route is "where do I look?" or "what's important here?" — the page fails this criterion regardless of how organized it is.

**How to verify:** Hit `https://kerf-v15-internal.fly.dev/` after deploy. The first thing the operator sees must be `the_one_thing`, not a route stack. Voice-canon copy ("Right Hand says...") prefixes the synthesis text. The next action (single button or single link) is visible without scrolling. Reasoning trail is collapsed by default.

**Failure modes to watch for:**
- Root route still rendering the proposal-first dashboard
- `the_one_thing` buried below other UI chrome
- **Page overload — more information, better organized, instead of one primary response + one next action + calm supporting detail** (Christian's specific warning on E.3)
- Multiple competing "this is important" panels (defeats the "one thing" rule)
- Synthesis copy without voice-canon prefix where it should have one
- "Right Hand says..." prefix on text the orchestrator didn't produce (false agency)
- Reasoning trail rendered expanded by default (dumps state on first impression)

**E.3 status:** ⏳ This is the criterion E.3 must demonstrably pass before merge. **The feel test is the primary gate** — automated tests verify shape; the human reviewer verifies the feel test.

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

### 7. No backend-only PRs from this point forward

**The criterion:** Every PR that modifies `src/persistence/*`, `src/agents/*`, `src/altitude/*`, or `scripts/serve-v15-vertical-slice.ts` MUST also modify an operator-facing surface (`src/examples/v15-vertical-slice/pages/*`, `src/i18n/*` strings the operator reads, or equivalent) — OR explicitly justify in the PR description why a backend-only change produces a visible operator-facing behavior change.

This rule binds **from this point forward.** Not "after Sprint E closes." Not "once the orchestrator is mature." Now.

**Why this exists:** The 2026-05-17 post-mortem named seven causes of architectural drift. The 7th was *"we didn't encode agentic behavior as a release gate."* This criterion IS that gate. The deeper failure mode it prevents: backend-heavy work that doesn't immediately project into an operator-facing wireframe surface compounds into smarter internals and dumber product behavior.

**Permissible exceptions** (must be named explicitly in the PR description):
- Substrate that changes what an existing surface renders (e.g., LLM wiring flips a disclaimer + improves hypothesis quality the operator sees)
- Bug fixes to substrate where the surface is unchanged but produces correct output
- Test-only or doc-only PRs

**Any backend-only exception MUST show a visible before/after effect on an existing operator surface in the PR description.** Screenshots, transcript examples, or rendered HTML diffs. This prevents *"trust me, this helps later"* from sneaking back in.

**Not permissible:** "lay the groundwork for a future surface." If the surface isn't built in this PR (or a tightly-stacked follow-up PR that lands within 24 hours), the groundwork doesn't ship.

**How to verify:** PR reviewer audits the file diff. If only backend files changed and no exception is named with before/after evidence, the PR fails this criterion and does not merge.

**Failure modes to watch for:**
- Substrate PRs that promise UI in a "next PR" that never comes
- Generator / lookup / adapter modules shipped without a surface that consumes them
- "Refactor to enable future X" without X also landing
- Backend tests that pass but no operator can see the effect

**E.2 status (this PR):** ✅ Passes — modifies `pages/field-daily-capture.ts` (operator-facing render) + the i18n strings the operator reads.

---

## Sprint E sub-step gate matrix

| Sub-step | Criteria required to pass |
|---|---|
| **E.1** (orchestrator skeleton) | 1, 2, 3, 4, 6 — all pass at PR #213 (commit `fa653b7`). Criterion 7 not applicable (predates the rule.) |
| **E.2** (clarification UI rebuild — PR #214) | 2 (central), plus 3, 4, 6 preserved, plus 7 |
| **Live LLM wiring** | 6 (central — flips "honest about being thin" → "actually rich"), plus 7 (must show before/after) |
| **E.3 Right Hand Home** (PR 1 of E.3 sprint) | 5 (central), plus 1, 2, 3, 4, 6 preserved, plus 7 |
| **CO draft artifact surface** (PR 2 of E.3 sprint, stacked on E.3 Home) | 5, plus 7 (the visible artifact IS the surface change) |
| **Sprint F (modality routers)** | 7 binds every PR; per-modality central criteria added when the sprint is scoped |

A PR that fails any of its required criteria does not merge. Period.

---

## What this contract does NOT do

- It does NOT replace code-level CI gates (typecheck, tests, forbidden-surface invariants). Those stay.
- It does NOT automate the verification. The criteria are graded by a human (Christian, Codex review, or Claude self-audit). V2.0 may add LLM-graded evals against this contract.
- Criteria 1-6 are Sprint-E-shaped (orchestrator behavior, clarification, the_one_thing, reasoning trail, Home surface, honesty about authority). Step F will add per-modality criteria.
- **Criterion 7 is the universal rule and binds every PR going forward, not just Sprint E.** It's the meta-gate that prevents the bottom-up drift that triggered Sprint E in the first place.

---

## Why this is in main, not in a session note

The drift happened because aspirational shape lived in docs while runtime code drifted. This contract is in main alongside the code so the asymmetry can't repeat. If a future contributor (human or agent) wants to advance Right Hand work, they read this contract from the codebase, not from session memory.

This is the missing release gate. It's in main now.
