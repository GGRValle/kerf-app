# Sprint E.3 — Right Hand Home (PR 1)

- **Date:** 2026-05-16 (evening — written after E.1/E.2/LLM-wiring all landed + dogfooded)
- **Author:** Claude (Agent 8, integration lead)
- **For:** Cursor SDK
- **Status:** ⏸ **DEFERRED — waiting on Sprint E.3 PR 0 (Document Manager LLM extraction upgrade) to land first.**
  Manual /field dogfood on 2026-05-16 caught a trust failure on a real bathroom-rough capture: the synthesis got polarity wrong, missed an owner scope inquiry, and falsely said "nothing needs you right now." Root cause is upstream of Home — the Document Manager's deterministic fact extractor is the bottleneck. Home is a trust amplifier; shipping it on top of a wrong synthesis would make the wrongness more legible. See [Sprint E.3 PR 0 brief](./sprint-e3-pr0-document-manager-llm-extraction-2026-05-16.md). This brief unparks once PR 0 ships.
- **Predecessor:** [Sprint E brief 2026-05-16](./sprint-e-right-hand-orchestrator-2026-05-16.md) (section 4.3 sketched E.3; this brief replaces it with what we now know is real)
- **Release gate:** [Right Hand Acceptance Contract](../architecture/right-hand-acceptance-contract-2026-05-17.md) — **Criterion 5 is central; Criterion 7 binds.**

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

## 2. What's already live (DO NOT rebuild — consume)

Three sub-steps shipped into main and are deployed at `https://kerf-v15-internal.fly.dev/`:

| Sub-step | What it gives you | Where it lives |
|---|---|---|
| **E.1** | `runRightHandOrchestrator()` returning a `RightHandResponse` with `the_one_thing`, `reasoning_trail`, `hypothesis`, `tools_invoked`, `clarification_prompts` | `src/agents/right-hand/orchestrator.ts` |
| **E.2** | `buildRightHandResponseHtml(t, response, eventId, transcript)` — renders the orchestrator output inline on `/field` as either a synthesis panel OR a clarification panel | `src/examples/v15-vertical-slice/pages/field-daily-capture.ts` |
| **LLM-wiring** | Whole-capture hypothesis is now LLM-driven (Groq Llama 3.3 70B Versatile) when env is configured; deterministic fallback otherwise | `src/agents/right-hand/whole-capture-hypothesis.ts` |

**The orchestrator output is real and verified.** Three dogfood transcripts captured on 2026-05-16 against the live deploy:
- Clean Henderson → `llm_inferred`, high-confidence bath_remodel, `the_one_thing = "Stop and review — Henderson bath remodel: Money risk: galvanized."`
- Garbled → `mostly_failed` quality, semantic clarification ("Sounds like this might be a bath remodel — am I right?")
- Calm progress → `the_one_thing = "Henderson bath remodel — Completed: demo finished today. Nothing here needs you right now."`

**Your job is to bring those responses to the operator's eye on `/` — not to regenerate them.**

---

## 3. What this PR ships

### The single criterion this PR exists to pass

**Criterion 5 from the Acceptance Contract:** *"Right Hand Home renders `right_hand_response` as the primary experience."*

The feel test (Christian, 2026-05-17):
> **"When I open `/`, I should immediately understand what Right Hand thinks matters, without clicking into transcript, audit, or route navigation."**

That's the bar. Everything in this PR exists to clear it.

### Files

**New:**
- `src/examples/v15-vertical-slice/pages/right-hand-home.ts` — page renderer
- `tests/v15-right-hand-home.test.ts` — shape + criterion checks

**Modified:**
- `scripts/serve-v15-vertical-slice.ts` — wire the `/` route to render this page (currently `/` serves a flat dashboard; redirect to or replace with Home)
- `src/i18n/keys.ts` + `en.ts` + `es.ts` — `rh.home.*` keyspace

### Shape

```
┌────────────────────────────────────────────────────────────┐
│  KERF · RIGHT HAND                                          │
├────────────────────────────────────────────────────────────┤
│                                                             │
│   [THE ONE THING — prominent, primary panel]                │
│   "Right Hand says: <the_one_thing text>"                   │
│   [Next action button — single]                             │
│                                                             │
│   ▸ Show Right Hand's reasoning   (collapsed by default)    │
│                                                             │
│   ───────────────────────────────────────                   │
│   Quiet metadata: project · entry_id · captured 14m ago     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

**That's the entire above-the-fold experience.** No secondary list. No tabs. No nav rail. **One primary response, one next action, calm supporting detail.**

---

## 4. What "Home" shows

Home renders **the most-recent `daily_log.entry_captured` event for the current tenant** (single-tenant V1.5 = `tenant_ggr`), with the orchestrator response that was produced for it.

The orchestrator response is **NOT re-computed on page load** — it's read from the event log. The most recent entry capture already produced a `right_hand_response`; you read the events that followed it (`facts_extracted`, `drift_detected`, etc.) and re-render the synthesis from those persisted artifacts.

**Simpler V1 path (recommended):** add the orchestrator response to the projection cache when the capture endpoint runs (`scripts/serve-v15-vertical-slice.ts` already returns it in the HTTP response). Then Home reads it from there.

Talk to me if the persistence/projection path isn't obvious — I'd rather you ask than guess.

### Three response shapes Home must render correctly

The orchestrator emits one of these three shapes; Home renders whichever applies.

**A) Synthesis with surfaced priority** (block-severity drift, scope change, etc.)
```json
{
  "the_one_thing": "Stop and review — Henderson bath remodel: Money risk: galvanized.",
  "clarification_prompts": [],
  "reasoning_trail": ["Read the whole capture: ...", "..."],
  "hypothesis": { "hypothesis_authority": "llm_inferred", ... }
}
```
Render: prominent panel with "Right Hand says: <text>", primary action button "Review captured entry", collapsed reasoning trail below.

**B) Clarification needed** (garbled or ambiguous capture)
```json
{
  "the_one_thing": "Henderson bath remodel — voice capture came through mostly unreadable. Quick clarification before I can do anything with it.",
  "clarification_prompts": [{ "question": "Sounds like this might be a bath remodel — am I right?", ... }]
}
```
Render: amber-tinted panel with "Right Hand needs a quick clarification" heading, the question text, an inline answer affordance (text input + submit, or just a link to `/field/...` to re-capture). NO "Right Hand says" prefix on clarification copy.

**C) Calm — nothing needs you** (drift evaluated, didn't fire)
```json
{
  "the_one_thing": "Henderson bath remodel — Completed: demo finished today. Nothing here needs you right now.",
  "clarification_prompts": []
}
```
Render: same shape as (A) but de-emphasized, no urgency styling, no "next action" button (or a soft "Capture another update" link). The whole point is to NOT scream.

### Empty state

No captures yet for the tenant:
> **Right Hand has nothing surfaced for you yet. Capture something on /field and it'll appear here.**

One-line, calm, with a link to `/field`. Don't fill it with onboarding cruft.

---

## 5. Voice canon rules

These already lock in `/field-daily-capture.ts`. **Use the same translator keys; do not re-invent.**

- **Synthesis copy:** prefixed with `"Right Hand says"` (key: `rh.field.rightHandSaysLabel` — reuse, don't fork)
- **Clarification copy:** prefixed with `"Right Hand needs a quick clarification"` (key: `rh.field.clarifyHeading`). **NEVER use "Right Hand says" on clarification copy** — that's voice-canon false agency (criterion 5 failure mode #6).
- **Honesty disclaimer:** when `hypothesis_authority === 'deterministic_fallback'`, surface the disclaimer the same way `/field` does (`rh.field.honestyDisclaimer` key). When `llm_inferred`, omit. Reuse `buildRightHandResponseHtml`'s logic if it makes sense to factor out a shared renderer.

**Strongly recommended:** factor the inner panel render out of `field-daily-capture.ts` into a shared helper so Home and Field render identical synthesis/clarification panels. Both pages need the same shape; duplicating is a footgun. If the factoring gets gnarly, that's a finding — flag it and I'll help.

---

## 6. Tests (~6)

Required test cases:

1. **Synthesis-shape response renders `the_one_thing` exactly once in the primary panel**
   - assert `<panel data-kerf-rh-home-primary>` contains the_one_thing text, exactly once
2. **Clarification-shape response renders the clarification panel, NOT the synthesis panel**
   - assert `data-kerf-rh-home-clarify` present, `data-kerf-rh-home-primary` absent
3. **Reasoning trail rendered as collapsible `<details>`, collapsed by default**
   - assert `<details>` present, no `open` attribute
4. **Honesty disclaimer present when `hypothesis_authority === 'deterministic_fallback'`, absent when `llm_inferred`**
5. **Empty state renders the calm one-liner with a link to `/field`** when no captures exist
6. **Spanish locale renders "Mano Derecha dice" / "Mano Derecha necesita una aclaración"** for the synthesis / clarification shapes (i18n smoke)

### The feel test (human-graded — Christian)

Automated tests verify shape. The feel test verifies whether the page actually works as Right Hand Home. **Christian opens `/` after deploy and answers:**

1. *Do I immediately understand what Right Hand thinks matters?* (yes/no)
2. *Is there one clear thing, or am I deciding where to look?* (one / multiple)
3. *Does the reasoning trail stay out of my way until I want it?* (yes/no)
4. *Does the page feel calm when the capture is calm, and urgent when the capture is urgent?* (yes/no)

If any answer is "no" or "multiple," the PR doesn't merge — we iterate on the surface, not the orchestrator.

---

## 7. What this PR is NOT

- **Not a relay-card list.** No "other things you might also care about" panel. Single primary response. (The flat `/relay` list can stay accessible elsewhere, but it's not Home.)
- **Not a feed.** No chronological list of captures. The newest capture is the synthesis; older captures are accessible via `/field` or a deep link from the reasoning trail, but they don't render on Home.
- **Not a dashboard.** No charts, no counts, no project picker dropdown. Single-tenant V1.5; Home renders the latest synthesis for `tenant_ggr`.
- **Not the CO draft surface.** PR 2 of E.3 (stacked on this one) is where the change-order draft preview lands. This PR ships Home; PR 2 fills in the next-action button when `the_one_thing` is a money-risk + scope-change situation.

---

## 8. Acceptance — three concrete render targets

When this PR is deployed, hitting `/` against the live data should produce three observable shapes depending on the most-recent capture:

**Target 1 — synthesis (after the Henderson clean transcript)**
- Primary panel: "Right Hand says: Stop and review — Henderson bath remodel: Money risk: galvanized."
- Single action button visible
- Reasoning trail collapsed, label "Show Right Hand's reasoning"
- No heuristics disclaimer

**Target 2 — clarification (after the garbled transcript)**
- Amber panel: "Right Hand needs a quick clarification"
- Question text rendered verbatim from `clarification_prompts[0].question`
- No "Right Hand says" prefix on the question
- Affordance to answer (input + submit, or link to re-capture on `/field`)

**Target 3 — calm (after the demo-finished transcript)**
- De-emphasized panel: "Henderson bath remodel — Completed: demo finished today. Nothing here needs you right now."
- No urgent styling, no flashy action button
- "Capture another update" soft link, or no action at all

The PR description **must show before/after screenshots or rendered HTML for at least one of these three targets** (criterion 7 — backend-touching PRs need visible operator-facing evidence; same applies to UI PRs to prove the surface actually shipped).

---

## 9. Reporting

When the PR is ready, report in this shape:

- **Branch:** `feature/v15-right-hand-home-e3`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `npm test` (count + pass/fail) + `npm run typecheck`
- **Acceptance evidence:** screenshot or rendered-HTML excerpt for at least one of the three targets
- **What could break:** honest list — especially anything in `/field` that might regress from the shared-renderer factoring
- **Open question for Christian:** if anything about the feel test felt hard to grade against, name it

---

## 10. If anything in this brief is wrong, stop and ask

The acceptance contract is the release gate. This brief is one path to passing it. If you find a cleaner shape that still clears criterion 5 + the feel test, propose it before coding. The previous two stages of Sprint E both surfaced a bug because somebody (deploy-smoke, dogfood-smoke) actually tried the thing — same vigilance here.
