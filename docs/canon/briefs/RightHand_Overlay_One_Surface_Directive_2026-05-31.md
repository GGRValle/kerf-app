# Directive · Right Hand Overlay Is ONE Surface · No Component Switching · 2026-05-31

**For:** the build agent wiring the voice overlay (Codex/Cursor). **Canon:** F-RH2 wireframe · D-053 · the context-aware turn resolver brief. **Priority:** this is the core feel; it's currently wrong.

---

## The bug (observed on v46, iPhone)

Pressing **Stop** swaps the user through a chain of **separate components/screens**:
`Listening card` → `READY FOR YOU card` → `HERE'S WHAT'S NEXT card` → `/projects/new`.

That's four surfaces for one turn. It feels like a form wizard, not a conversation. Founder's words (captured by the app): *"it wants to be in one card and then go to the next card… I'd prefer it stay within the same context, the same lane, and not switch to another component once I press Stop."*

## The rule (wire it this way)

**The Right Hand overlay is ONE persistent component that holds the entire turn.** It does not switch components or change routes when the user presses Stop. The conversation continues **in place**, in the **same blurred-background overlay**.

```
tap mic
  → [same overlay] background blurs, "Right Hand is listening", live words
  → press Stop
  → [SAME overlay, no swap] your words stay on screen + Right Hand's reply
    appears below them as conversational prose ("Got it — job walk at Wegrzyn,
    I'll file a job note. What's next?")
  → [SAME overlay] the input/mic stays — user keeps talking, or taps an inline
    next action
  → the background stays blurred behind this one overlay the whole time
```

- **Stop never navigates and never mounts a new card/component.** The reply renders into the same overlay container (append to the conversation, don't replace the surface).
- **Only an explicit navigation intent changes the screen** — "take me to the project" routes and dismisses the overlay (F-RH2 state 2). Pressing Stop is *not* a navigation.
- **No "READY FOR YOU" → "HERE'S WHAT'S NEXT" two-card hop.** That's one conversational reply with the next move *in the sentence* + at most a couple of inline affordances, in the same overlay — not two stacked cards on two surfaces.
- **`/projects/new` is a destination the user chooses** (e.g. "create the estimate"), reached as an explicit navigation — never the automatic landing when Stop is pressed.

## Keep (already correct)
- Blurred background. The "I'll ask before I file anything" honesty. "Keep talking." Plain-English copy. The `ready_to_save` honesty (no false "Saved").

## Match the wireframe
`_docs/wireframes/F-RH2_mobile_right_hand_conversation.html` — states 1 and 3 are literally this: one blurred overlay, you-said + Right-Hand-reply in the same surface, input stays. Wire to that.

## Acceptance (Bar 3, drive on the phone)
- [ ] Speak → Stop → the reply appears in the **same overlay** (no new card, no route change). Background stays blurred.
- [ ] After the reply, the input/mic is still there; the user can keep talking in the same surface.
- [ ] No automatic `/projects/new` (or any route) on Stop. Navigation happens only on an explicit "take me to / create the…" intent.
- [ ] The two-card "Ready for you" → "What's next" hop is gone — one conversational reply, in place.

---

*Directive 2026-05-31. One surface, one conversation. The card-to-card wizard is the thing to remove.*
