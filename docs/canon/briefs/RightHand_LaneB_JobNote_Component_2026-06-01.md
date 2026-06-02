# Lane B Build Packet · Shared Job-Note Artifact Component · 2026-06-01

**Concurrent lane** (runs alongside Lane A · Camera, Lane C · builders, Lane D · CI, Lane E · role homes). See `RightHand_Build_Orientation_2026-06-01.md`.
**For:** one Cursor agent. **Owns:** the JobNote component + capture→job-note pipeline. **Does NOT own:** camera UI, daily-log surface, or home shells (those *consume* this component).
**Canon:** the model-led / job-note packet (`RightHand_ModelLed_Persistent_Response_and_JobNote_Artifacts`) · `feedback_business_brain_not_file_cabinet` · `feedback_avoid_overbuilding_review_surfaces` · `feedback_red_is_chip_tier_not_row_tier` · `kerf_ai_disclosure_pattern` · D-053 two-artifact.
**Gate:** Proportional Above The Floor (D-058).
**Step 0 (D-057):** this lane owns a *component*, not a single surface — but read the friendly job-note rendering as it appears in `F-DL1`, `F-CAM1`, and `F-RH3` (Annotated) and in the model-led/job-note packet before building, so the contract matches how consumers render it. Pull those into kerf-app or read them from canon.

---

## Why this is its own lane (the unblock)

A captured voice note, photo, scan, or text update should render the same way everywhere: a **friendly job note**, not a capture card. That exact renderer is reused by **Camera (Lane A), Daily Log, the Pulse, and Field Updates**. Build it **once** as a leaf component with a clean contract, and those surfaces consume it — instead of three lanes each growing their own and us reconciling later. This lane is the **producer**; the others are **consumers**. Clean file split = safe concurrency.

---

## The contract (this is the coordination point — Lane A builds against it)

A single component, `JobNote`, renders from one typed input. Consumers pass the input; this lane owns the component + its tests.

```ts
interface JobNoteView {
  readonly id: string;
  readonly job: { readonly id: string; readonly name: string };   // where it filed / will file
  readonly summary: string;                 // model-written, plain English, ~≤140 chars
  readonly source: 'voice' | 'photo' | 'scan' | 'note' | 'text_in'; // → quiet chip "via voice" etc.
  readonly media?: ReadonlyArray<{ kind: 'photo' | 'video' | 'doc'; thumbUri: string; fullUri: string }>;
  readonly filing:
    | { state: 'ready_to_save' }            // not yet written → "Ready to file"
    | { state: 'filed'; at: string };       // durable write returned → "Filed · time"
  readonly needsReview?: { reason: string };// optional → small "Needs review" CHIP only
  readonly expandHref: string;              // tap → full capture/detail (depth lives underneath)
}
```

Render rules (locked):
- **Thumbnail** (photo crop / ▶ waveform / doc glyph) + **plain summary line** + quiet **source chip** + **filing line**.
- **Honest filing:** `Ready to file` until the durable write returns; `Filed · <time>` only after. The component MUST NOT show "Filed" from a `ready_to_save` input. (No false persistence — enforced in the component, not just upstream.)
- **`needsReview` is a chip**, never a row treatment. Row stays visually neutral (red-is-chip).
- **Tap the thumbnail/row → `expandHref`** (full detail underneath; the note never renders full-detail inline).
- **AI disclosure** sits at the **section** level where the component is mounted ("AI-assisted by Right Hand · review before approval"), not stamped per row — expose a slot/prop, don't bake it into every instance.

---

## The capture → job-note pipeline (this lane's second deliverable)

A small mapper that turns a persisted capture / `draft.synthesized` payload (Phase 1H) into a `JobNoteView`. Pure function, fully unit-testable, no UI:

```
draft.synthesized | daily_log.entry_captured | sms daily_log_ingest
   → toJobNoteView(payload, jobContext) → JobNoteView
```

- Summary comes from the model's `daily_log_summary` (truncate/clean to the line length).
- `source` derived from the capture channel.
- `filing.state` derived from whether the durable write event exists — **never assumed**.
- Tenant-scoped: the mapper only ever sees one tenant's data.

---

## Consumers (do NOT build these here — just expose the component)

- **Camera (Lane A):** Walkthru/Photo Done → maps to `JobNoteView` → renders in the post-capture confirmation + the job's Daily Log.
- **Daily Log (packet #2):** the note + media rows.
- **Pulse (F-A1b):** recent field captures, compressed.
- **Field Updates (F-FU1):** SMS-in captures (`via text`), already the pattern.

Ship a tiny **demo/storybook mount** showing all states (ready_to_save · filed · needsReview · each source · with/without media) so consumers and Cowork can verify without wiring a full surface.

---

## Floor (Bar 2) + Bar 3

- **No false persistence:** "Filed" only from a `filed` input (component-enforced).
- Tenant-scoped mapper; no money value rendered as a written field (summaries are prose); no PII in `expandHref` query strings.
- Red is chip-tier; disclosure at section.
- **Bar 3:** mounted in the demo, all states render correctly on a phone viewport; a `ready_to_save` note visibly reads "Ready to file," and only flips to "Filed · 9:24a" when given a `filed` input.

## Acceptance

- [ ] `JobNote` component renders every state per the contract; thumbnail tap → `expandHref`.
- [ ] `toJobNoteView` mapper: unit tests for each source, filing state derived from write-event presence (not assumed), summary truncation, tenant scoping.
- [ ] Component refuses to show "Filed" from a `ready_to_save` input (test).
- [ ] `needsReview` renders as a chip; row stays neutral (test/visual).
- [ ] Disclosure is a section-level slot, not per-row.
- [ ] Demo mount covers all states. `npm run typecheck` · `build:astro` · component/mapper tests pass.

## Not this lane

- NOT the camera, daily-log, pulse, or field-updates surfaces (consumers).
- NOT a new heavy capture-detail view (that's `expandHref`'s target, owned elsewhere).
- NOT synthesis (Phase 1H owns producing the payload; this lane only maps + renders).

---

*Lane B · 2026-06-01. One renderer, many mounts. Producer for the concurrent lanes — build the contract, and Camera/Daily-Log/Pulse stop reinventing the note.*
