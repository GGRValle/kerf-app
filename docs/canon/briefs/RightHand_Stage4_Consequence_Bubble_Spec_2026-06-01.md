# Right Hand · Stage 4 Consequence Bubble — authoritative spec (paste-ready) · 2026-06-01

**Source of truth:** `_docs/wireframes/F-RH3_mobile_right_hand_conversation_lifecycle.html` (Annotated). This is a verbatim extract of the parts that govern **stage 4** — the "what do I do with the info / where does it go?" confirmation — so an agent can build it without the full file. If this and F-RH3 ever differ, F-RH3 wins.

---

## The contract (read first)

The whole turn happens on **one persistent, blurred surface**. The mic never goes away. Stop never swaps to a new card.

1. Background blurs; the conversation lives in **one growing surface**.
2. The **same mic stays available** the entire time.
3. **Stop appends Right Hand's reply in place** — it never mounts a new screen or a 3-button card dialog.
4. A confirm affordance appears **only when filing / sending / money / a durable write is one tap away**, and it's phrased as an answer to the real question (**Save to Wegrzyn? · Change · Keep talking**) — **not** a generic Save/Don't-save/Keep-talking box.
5. **"Saved" only renders after the write returns.**

---

## Stage 4 · the consequence bubble (this is the answer to "where does it go?")

The confirmation is a **bubble inside the same conversation**, appearing **only at stage 4** — because a **durable write** is about to happen (file / send / money). It is NOT a new screen and NOT the v47 "READY FOR CHRISTIAN" three-button card.

**Exact copy + affordances (from F-RH3):**

```
Right Hand:  "Before I file it —
              I'll save this to Wegrzyn → today's Daily Log. Good there?"

              [ Save to Wegrzyn ]   [ Change job ]   [ Keep talking ]
                (primary)            (re-route/edit)   (stays in turn)

              ↳ the mic is still here the whole time
```

Rules for this bubble:

- It renders **into the same blurred conversation surface**, appended below Right Hand's prose reply — not a route change, not a mounted card.
- The affordances **answer the question being asked** ("where does it go / is this right?"). They are **Save to <job> · Change job · Keep talking** — never a generic *Save / Don't-save / Keep-talking* dialog that ignores the question.
- **Change job** re-routes (different job) or edits inline. **Keep talking** stays in the turn. The **mic stays available** throughout.
- It appears **only here** — when a durable write is imminent. No confirm affordance appears at stages 1–3 (listening / talking / reply-in-place).

---

## Stage 5 · after the write (honesty floor)

Only **after** the durable write returns does the surface show the committed state:

```
Right Hand:  ✓ Filed to Wegrzyn · Daily Log · via voice
             "Anything else, or want to add a photo to it?"
             ↳ mic still available; swipe down to close
```

- `Filed · via voice` renders **only after** the write returns. Before that it's `ready_to_save` language — never a false "Saved."
- The surface **stays open** for the next move; the conversation doesn't dump the user back to a wall.

---

## What this explicitly is NOT (the v47 regression to avoid)

- ❌ Pressing Stop swapping the listening card into a separate **"READY FOR CHRISTIAN" card** with a **Don't save / Keep talking / Save** button row.
- ❌ A button row that **doesn't match the question** Right Hand just asked.
- ❌ Any route change on Stop (e.g., auto-landing on `/projects/new`).
- ❌ "Saved" shown before the durable write completes.

---

*Extract 2026-06-01 from F-RH3. Authoritative for stage 4 until the full F-RH3 lands in the repo. One surface, consequence-gated confirm, honest "Filed."*
