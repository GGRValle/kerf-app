# Dogfood Finding — Clarification Prompt Voice
## Real-voice F-33 → F-34 round-trip, 2026-05-13

- **Date captured:** 2026-05-13 (evening)
- **Repo state at capture:** `main@5471c8b` (post-PR #150)
- **Slice window:** Day 6 of 10 (2026-05-08 to ~2026-05-18)
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Pinned dogfood evidence. Informs §11.6 dogfood recommendation and the May 16+ clarification-generator rewrite. Not a recommendation doc; not a canon-expansion. Captures what happened verbatim.

---

## What happened

PR #150 (voice Record button on `/field-capture` + F-34 clarification surface) merged at `5471c8b`. Operator (Christian) booted the demo on `localhost:8010`, clicked Record, described a real GGR-style kitchen + custom pantry remodel in his own voice, clicked Stop. The pipeline ran end-to-end:

```
mic → MediaRecorder → POST /transcribe → Groq Whisper turbo
   → transcript landed in text-note
   → F-33 sessionStorage handoff
   → F-34 picked up handoff and auto-generated three clarification prompts on the right rail
```

**Whisper transcription quality on real audio: clean.** No garble, no domain-name fabrication. Timestamps accurate. The "voice-in transcription tier" gating question is answered upstream.

**F-34 clarification generator behavior on real transcript: surfaced a sharper gap than the transcription itself.** Christian did not *answer* the three prompts. He *rewrote* them inside the answer textareas — and his rewrites are the specification for what the next iteration must produce.

---

## Captured evidence

### Real Whisper transcript (verbatim, three segments)

> **0:00–0:04**  "So the project that we came across has an existing kitchen that the homeowner would like to install new cabinetry, install new countertops."

> **0:04–0:09**  "Inside the pantry, we're going to gut it completely and put in new custom shelving that's going to be white oak and have additional metal rails to give it a modern feel."

> **0:08–0:11**  "The pantry is five feet deep by six feet wide with a 24-inch door opening that we're going to turn into a barn door."

### Operator clarification-answer-box texts (verbatim, three boxes, in order)

Operator was prompted (current regex generator output):

1. **Prompt 1:** "What should Kerf assume for 'Inside the pantry, we're going to gut it completely and put in new custom shelving that's going to be white oak and have additional metal rails to give it a…' if you proceed now?"

   **Operator's answer-box text:**
   > "I dont like this phrase, what should kerf assume."

2. **Prompt 2:** "What should Kerf assume for 'The pantry is five feet deep by six feet wide with a 24-inch door opening that we're going to turn into a barn door.' if you proceed now?"

   **Operator's answer-box text:**
   > "You could say' my read is a 5' deep x 6' wide pantry with a 24" opening to get in. What is the ceiling height?"

3. **Prompt 3** (visible in screenshot, captured separately):

   **Operator's answer-box text:**
   > "A more conversational response here should be noted. 'How many lineal feet of base and uppers are we talking Christian?' or 'do you have the LiDAR'"

---

## Reframe — clarification prompts are a teaching surface, not a data-extraction surface

The strongest signal in this dogfood run is not "the prompts are too robotic." It is structural:

**The operator did not treat the prompts as questions to answer. The operator treated the prompts as a thing the system was teaching them about — and pushed back on the teaching.**

Prompt #1: "I dont like this phrase" — operator rejecting the prompt's framing, not refusing the underlying clarification need.

Prompt #2: "You could say' my read is a 5' x 6' pantry…" — operator rewriting the prompt in the voice they expect Right Hand to use, then appending the actual domain question they expect Right Hand to ask next ("What is the ceiling height?").

Prompt #3: "How many lineal feet of base and uppers are we talking Christian? or do you have the LiDAR" — operator handing the system the contractor unit ("lineal feet of base and uppers"), the operator's first name ("Christian"), and the substrate alternative ("LiDAR" — D-043 path) as the right next prompt content.

In all three boxes the operator is not extracting data into Kerf. The operator is **teaching Kerf how Right Hand should sound when it asks for clarification.** Every clarification prompt is the operator's first meaningful read of "does this system actually understand my work, or is it a form?" The prompt is implicitly the system saying, *"these are the things I think matter."* If those things aren't the right contractor-domain anchors in the right voice, the operator stops giving answers and starts editing the prompts — exactly what happened.

This reframes the May 16+ clarification-generator rewrite:

- Not "generate better extractive questions"
- **It is** "design the first teaching moment between Right Hand and the operator"

That has implications the regex-generator MVP did not have to handle:

- **Voice is canonical, not stylistic.** Right Hand's voice in F-34 prompts is the operator's first read of whether the agent surface has been thought through. Multi-voice = unprofessional. The voice canon work (May 16+) is upstream of the prompt rewrite.
- **Domain-aware questions ≠ keyword expansion.** "Lineal feet of base and uppers" is the unit a cabinet contractor uses. "Quantity" is the unit a database uses. Domain awareness is about *vocabulary the operator already uses on the jobsite*, not better matchers on the source-quote string.
- **The system's "my read" matters more than the operator's "your answer."** Prompt #2 explicitly opens with what the operator wants the system to *show*: its current read of the scope ("my read is a 5' x 6' pantry with a 24" opening"). The clarification then attaches a follow-up question to that read. This is closer to a confirm-and-extend dialog than a fill-in-the-blank form.

These observations are pinned here as input to the May 16+ design work. They are not a spec; the spec emerges from the design conversation.

---

## What tonight's polish PR will do (and not do)

To preserve forward motion on the slice without overreaching during the slice-window discipline, a narrow polish PR is going in alongside this capture doc. **It is deliberately scoped to NOT pre-empt the May 16+ design conversation.**

### In scope tonight

- Polish only the **existing prompt templates** the current regex generator emits (`src/examples/v15-vertical-slice/v15-context-clarifications.ts:28–103`)
- Target two of the four future properties:
  - **Conversational** — first-person voice ("my read is X", "what should I use"), active rather than passive shell, no robotic "What should Kerf assume for [verbatim source quote]?" wrapper
  - **Partly domain-aware** — only where the existing prompt already implies the domain anchor (e.g., "Should cabinetry be priced…" → "Are we pricing cabinetry…")
- Pattern-based tests (not literal string equality) so future copy nudges don't churn the suite

### Explicitly out of scope tonight (deliberate holds, all May 16+)

- **No new prompt categories.** The seven existing templates stay seven.
- **No restructure of the generator.** The selection logic (which template fires for which scope-line keyword) is unchanged.
- **No name-awareness.** Christian-by-name ("How many lineal feet of base and uppers are we talking Christian?") requires user-context lookup that doesn't exist yet. A half-built name lookup is worse than no name.
- **No pushback-handling.** Operator typing "I don't like this phrase" needs an LLM-driven rephrase or a richer state machine. Out of scope for a regex polish.
- **No new voice patterns invented.** Voice matches the three operator answer-box texts captured above. No extrapolation beyond what the operator has shown us they expect.
- **No LiDAR / D-043 prompts.** Substrate-aware prompts are a real gap, but they expand the prompt taxonomy. May 16+.
- **No Right Hand voice canon expansion.** This is bounded ad-hoc voice matching, not a canon move.

### Test posture

Pattern assertions, not string equality:
- **Negative:** no emitted prompt matches `/^What should Kerf assume for/` (locks the robotic shell out)
- **Positive:** every emitted prompt has at least one conversational marker (first-person `I`/`we`/`my`/`I'd`, OR an em-dash/colon mid-sentence)

Test count expected after the polish PR: ~650–655 (current main is 648). If it lands meaningfully higher, scope crept. If it lands at 648 unchanged, no pattern test was added.

---

## Adjacent gaps surfaced (capture only — no immediate action)

- **Archetype taxonomy gap.** Christian's transcript is kitchen + pantry (cleanly covered by `kitchen_remodel`), but the moment a real job-walk describes a deck, patio, fence, pergola, hardscape, outdoor stair, etc., `src/projects/types.ts:62` has no slot. Same gap surfaced in the typed-garble probe on 2026-05-12. Post-slice item.
- **Voice transcript handoff via `textNote` is canon-imperfect.** Whisper output today lands in the existing `textNote` free-text channel. Per transcript canon (2026-05-09: `transcript_original` immutable + `transcript_edits` overlay + `transcript_current`), live-capture voice transcripts should populate a proper three-part transcript model rather than free text. F-34 demo has the three-part machinery; F-33 live capture path does not yet. Post-slice item.
- **Kerf token CSS fallback.** Standing follow-up, cosmetic only.

---

## What this doc does NOT do (explicit)

- Does not propose code beyond the narrowly-scoped polish PR
- Does not expand canon
- Does not propose a Right Hand voice spec (May 16+)
- Does not propose new clarification categories
- Does not propose archetype taxonomy expansion (separate item)
- Does not propose new transcript-canon machinery on F-33 live capture (separate item)

These are all real follow-ups. They are not this doc's job.
