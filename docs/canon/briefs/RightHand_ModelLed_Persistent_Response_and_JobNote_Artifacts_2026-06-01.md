# Dispatch · Right Hand · Model-Led + Persistent Reply · Job-Note Artifacts · 2026-06-01

**For:** the build lane (Cursor lead + deployment agents · Cowork review · Christian merges).
**Builds on:** PR #281 / Fly v47 (overlay is now one surface, routing seam fixed).
**Canon:** Phase 1H Multimodal Draft Path (2026-05-27) · D-053 Turn + Attention Manager · D-050 four-question trust loop · One-Surface Directive (2026-05-31) · F-RH2 wireframe · `feedback_business_brain_not_file_cabinet` · `feedback_avoid_overbuilding_review_surfaces` · `feedback_red_is_chip_tier_not_row_tier` · `kerf_ai_disclosure_pattern`.
**Gate:** Proportional Above The Floor (D-058). Floor = Bar 2 safety + Bar 3 "Christian can drive the real path on his iPhone today."

This packet has two work items. They ship together because they're the same move from two sides: **the model carries the understanding, and the UI stops looking like a database.**

---

## Where we are after #281

The overlay feels like a conversation now: one surface, same mic, no Stop-card wizard, "Ready for Christian," and the "instead of filing under Wegrzyn" seam grounds correctly. What's still wrong is *underneath* the feel:

1. **The reply is templated, not model-led.** Right Hand's spoken-back sentence is assembled from a deterministic string, so it's stiff and it forgets. The #281 seam fix is correct for the one phrasing it was tested on ("instead of / under Wegrzyn") but the whole **negation / exclusion / correction class** ("not the Wegrzyn one," "skip Wegrzyn," "the other bathroom," "no, the Clem job") is whack-a-mole until a model holds the conversation context. That class is the home of this packet, not a string patch.
2. **Captures render as heavy cards.** A voice memo or photo surfaces as capture-card-style UI — a file-cabinet object. Per `business_brain_not_file_cabinet`, it should read as a **friendly job note**: a one-line plain-English summary + a thumbnail, filed into the Daily Log, consequence stated, source chipped. The card is the file cabinet; the job note is the brain.

---

## Item A · Model-led + persistent conversational reply

### A1 · The reply becomes a model turn, governed by the wall

Right Hand's reply in the overlay is **synthesized by the model**, not a template. Reuse the Phase 1H path — *heavy model produces the understanding, Kerf substrate produces the governance* — applied to the live conversation turn instead of only the `/field-capture → /draft-review` path.

- The overlay turn calls the synthesis client (`claude-sonnet-4-6` via `checkHostingRoute`, D-023 gating — no SDK bypass), same as Phase 1H.
- The model returns the **reply prose + the routing decision** in one structured payload. The reply is what Right Hand says back; the routing decision is `intent · candidate · confidence · next_surface · needs_user · consequence_tier` (the TRP shape from D-053 / Harness Contracts §A).
- Every turn passes the **same validator wall** before anything is shown or persisted: schema valid · no money-bearing field written by the model · no autonomous-send / auto-route flag · every claim has a source ref. A turn that fails the wall falls back to the deterministic template reply with honest "couldn't think that through, here's what I caught" copy — never a fabricated confident answer.

### A2 · The honesty floor holds in prose

The four-question trust loop (heard / routed / created / needs-approval) stays, but spoken as one model sentence, not four stacked chips. **No false persistence:** the reply says "I'll file this as a job note on Wegrzyn — want it saved?" or "Saved to Wegrzyn's Daily Log" **only after the durable write returns.** Until then it's `ready_to_save` language. The model is told this rule in the system prompt *and* the substrate enforces it — the reply template that claims a write is blocked unless the write event has persisted (belt-and-suspenders; the model's word is not the gate).

### A3 · Persistent conversation context (the negation-class home)

The overlay holds **conversation state across turns and across navigation within the session.** This is what makes "not the Wegrzyn one — the Clem bathroom" resolve: the model sees the prior turns and the current grounding, and re-grounds rather than pattern-matching a single phrase.

- A turn carries the recent conversation context (last N turns + current screen + active project grounding) into the synthesis call as structured input — same discipline as Phase 1H ("structured context, not raw blob soup").
- Context **survives navigation**: per F-RH2 state 3, taking Right Hand to a job and tapping the mic again resumes context-aware ("We're in Wegrzyn — what do you need?").
- **Scope for this packet:** within-session conversation memory (client-held + ephemeral server context keyed to the turn/capture). Cross-session durable memory and the real session/auth substrate stay deferred (Phase 1H already deferred them to "Phase 1I or whenever a real session layer lands"). Don't build the durable memory store here; build the in-session context that makes the conversation coherent today.
- Negation / exclusion / correction grounding is an **acceptance case**, not a special branch: it should fall out of the model holding context. Test it as behavior (below), don't hard-code phrase lists.

---

## Item B · Friendly job notes + thumbnails (retire the capture card)

A captured voice memo / photo / typed note renders as a **job note**, not a capture card. One pattern, used in three places: the overlay's post-turn confirmation, the Daily Log, and the Pulse.

### B1 · The job-note row

```
[thumbnail]  Voice note · Wegrzyn kitchen            via voice
             "Slab came in 1/8 short on the north run —
              flagged it, holding cabinet set."         · 9:24a
             Filed to Wegrzyn Daily Log                 [chip]
```

- **Thumbnail**, not a media-player card: a small photo crop, or a waveform/▶ glyph for audio, or a note glyph for text. Tapping it opens the full capture — the depth lives *underneath*, not on the surface (layered disclosure).
- **Plain-English summary line** (model-written, ≤ ~140 chars). This is the brain — what happened, why it matters — not metadata.
- **Source chip:** `via voice` · `via photo` · `via text` · `via text-in` (SMS, per D-052). Quiet, not a banner.
- **Filing line with honesty:** `Filed to Wegrzyn Daily Log` once durably written; `Ready to file` before. Never claim a file that didn't land.
- **Red is chip-tier only.** A note that needs review gets a small `Needs review` chip; the row stays visually neutral (no full-row red outline).
- **AI disclosure:** operator surface carries "AI-assisted by Kerf Right Hand · review before approval" at the section level, not stamped on every row.

### B2 · Where it lands

- **Overlay post-turn:** after a capture, the confirmation in the same overlay is a job-note row, not a new card surface (consistent with the One-Surface Directive — append in place).
- **Daily Log:** captures drop in as job-note rows marked with their source (this is the F-FU1 / `daily_log_canon` pattern — "via text" already exists; generalize it to via voice/photo/note).
- **Pulse:** recent field captures appear as job-note rows inside the relevant project's pulse line, compressed (newest few; "+ N more" rather than a wall of cards).

### B3 · What this retires

The capture-card-style component as the *primary* surface for a memo/photo. The full-detail capture view still exists, reached by tapping the thumbnail — it just stops being the default rendering. Per `avoid_overbuilding_review_surfaces`: lead with the primary thing (the note), let the forensic detail sit underneath.

---

## The floor (non-negotiable · Bar 2)

- Tenant isolation: conversation context and synthesis inputs carry one tenant's data only; context reads go through the tenant-scoped reader. No cross-tenant leak path.
- No money value written by the model (job-note summaries are prose; any `$` in a summary is descriptive text, never a written money field).
- No autonomous send / route / approve. Navigation happens only on explicit intent; filing happens only on confirm.
- No PII in URLs.
- Raw model output never rendered unparsed — the validator wall sits between the synthesis call and the screen.
- UI never crashes on a failed/empty turn — it falls back to the honest template reply.

## Bar 3 (drive the real path)

Christian, on his iPhone today: taps mic → speaks a real scope note that names a job by correction ("not Wegrzyn, the Clem bathroom") → Right Hand replies in a natural sentence, grounds to Clem, and the capture lands as a friendly job note (thumbnail + plain summary + `via voice` + `Filed to Clem Daily Log`) in the Daily Log and Pulse — not a capture card, not a four-card wizard, not a false "Saved."

---

## Acceptance criteria

**Model-led reply**
- [ ] Overlay reply is produced by the synthesis call (`claude-sonnet-4-6` via `checkHostingRoute`), not a string template, on the happy path.
- [ ] Reply payload carries both prose + TRP routing fields; passes the validator wall before render.
- [ ] Wall failure (schema / money / send / source-ref) → honest fallback reply, no fabricated answer, audit event emitted.

**Persistent context**
- [ ] Conversation context (last N turns + current grounding + screen) is passed into the synthesis call as structured input.
- [ ] Context survives navigation within the session (F-RH2 state 3 resume works).
- [ ] Negation/correction cases ground correctly as behavior: "not the Wegrzyn one — the Clem bathroom," "skip Wegrzyn," "no, the other bath" each route off Wegrzyn to the named job (tested, not phrase-listed).

**Honesty**
- [ ] Reply claims a save/file only after the durable write returns; `ready_to_save` language before. Enforced in substrate, not just prompt.

**Job-note rendering**
- [ ] Voice / photo / note captures render as job-note rows (thumbnail + plain summary + source chip + filing line) in the overlay post-turn, the Daily Log, and the Pulse.
- [ ] Tapping the thumbnail opens the full capture (depth underneath).
- [ ] `Needs review` is a chip; row stays neutral (red-is-chip).
- [ ] Filing line never claims a file that didn't persist.

**Verification**
- [ ] `npm run typecheck` · `npm run build:astro` pass.
- [ ] Focused tests: synthesis-reply happy path · wall-failure fallback · negation grounding (Clem-off-Wegrzyn) · within-session context resume · no-false-persistence · job-note render.
- [ ] Live iPhone smoke per Bar 3 above.
- [ ] Report path-truth, not report-truth: the negation case is shown working in a browser/phone path test, not asserted.

---

## What this packet is NOT

- NOT the durable cross-session memory store, and NOT the real session/auth substrate — both stay deferred. In-session context only.
- NOT a rewrite of the substrate, event store, or validator wall — reuse Phase 1H's path and guards.
- NOT a deterministic-chain extension — the template reply is the *fallback*, same as the 9-fact chain is the fallback for drafts.
- NOT a new heavy capture-detail surface — the friendly note leads; existing detail sits underneath.
- NOT autonomous anything — model proposes prose + a route; the operator confirms files, sends, navigation-with-consequence.

## Companion wireframe (recommended, not blocking)

A short visual target for B (job-note row in overlay / Daily Log / Pulse) will de-risk the look — candidate `F-RH3_mobile_job_note_artifacts.html`, same house style as F-RH2. Build lane can proceed against this brief; the wireframe lands the exact rendering so the agent doesn't guess.

---

*Dispatch 2026-06-01. The model carries the understanding; the UI stops looking like a database. Floor first, then proportional.*
