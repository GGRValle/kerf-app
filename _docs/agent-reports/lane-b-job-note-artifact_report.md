# Lane B · Shared Job-Note Artifact Component · Report

**Branch:** `lane-b-job-note-artifact`
**Base:** `origin/main @ 0caf84c` (`feat(right-hand): align phone shell conversation flow (#281)`)
**Head:** `06caf8d` (build) + this report
**Owns:** the `JobNote` component + the capture→job-note pipeline. **Does NOT own** camera UI, daily-log surface, pulse, or field-updates (those *consume* this).
**Gate:** Proportional Above The Floor (D-058). **Floor:** no false persistence · tenant-scoped mapper · red-is-chip · disclosure-at-section · Bar 3 phone-viewport states.

---

## Mandate

> A captured voice note, photo, scan, or text update should render the same way
> everywhere: a **friendly job note**, not a capture card. Build that renderer
> **once** as a leaf component with a clean contract; Camera (Lane A), Daily Log,
> the Pulse, and Field Updates **consume** it. This lane is the **producer**.

The referenced consumer wireframes (`F-DL1`, `F-CAM1`, `F-RH3`, `F-A1b`,
`F-FU1`) and the orientation/model-led packet are not yet present in the repo or
`docs/wireframes/canon/`. The build packet is self-contained (locked
`JobNoteView` contract, render rules, mapper spec, acceptance), so the build is
grounded in the packet + existing kerf-app patterns (`Chip`, `Row`, the real
`daily_log.entry_captured` event, the `_kit` storybook convention).

---

## Deliverables (5 new files, no existing file modified — clean lane split)

### 1. `src/app/lib/jobNote.ts` — contract + pipeline (pure, no UI)
- **`JobNoteView`** exactly per the locked contract (id · job · summary · source ·
  media? · filing union · needsReview? · expandHref).
- **`toJobNoteView(payload, job)`** — pure mapper:
  - `summary` ← model `daily_log_summary`, else cleaned transcript, else a
    channel fallback; whitespace-cleaned and truncated to **≤140** with one ellipsis.
  - `source` ← capture channel.
  - **`filing.state` derived ONLY from durable-write presence** — `durable_write`
    present ⇒ `filed` at that time; absent/null ⇒ `ready_to_save`. Never assumed.
  - **Tenant-scoped:** a payload/job tenant mismatch is **refused (throws)**, not rendered.
  - `expandHref` = `/field-detail?entry_id=<id>` — **opaque id only, no PII**.
  - `media` / `needsReview` included only when present (needsReview reason trimmed).
- **`capturedEventToPayload(event, extras?)`** — adapts a persisted
  `daily_log.entry_captured` event. A persisted event **is** the durable write
  (its `at` is the proof) → `filed`. This is the canonical demonstration of
  filing-from-write-presence (not assumption).
- **`jobNoteFilingLabel` / `jobNoteSourceLabel` / `formatFiledTime`** — honest
  display helpers. `jobNoteFilingLabel` switches on the discriminator only, so a
  malformed object claiming `ready_to_save` can never produce "Filed" even if it
  smuggles an `at` (the runtime half of the no-false-persistence guarantee).

### 2. `src/app/components/JobNote.astro` — the leaf renderer
- Thumbnail (photo crop · ▶ video overlay · waveform glyph for voice · doc glyph
  for scan/doc · camera glyph for photo-without-media) + plain summary line +
  **quiet source chip** (`Chip` neutral/outlined) + **honest filing line**.
- **`needsReview` → a `Chip` (amber)**, never a row treatment. The row stays
  visually neutral (red-is-chip-tier). The reason text rides the chip `title`.
- Whole row taps through to **`expandHref`** (full detail underneath; never inline).
- **"Filed" is component-enforced** via `jobNoteFilingLabel` — a `ready_to_save`
  view renders "Ready to file"; only a `filed` view shows "Filed · <time>".
- **No AI disclosure here** — it belongs at the section level.

### 3. `src/app/components/JobNoteList.astro` — section container
- Owns the **section-level AI disclosure** (`kerf_ai_disclosure_pattern`):
  "AI-assisted by Right Hand · review before approval" rendered **once**, not per
  row. `disclosure={false}` suppresses it; a string overrides the copy. Default
  slot takes the `JobNote`s.

### 4. `src/app/pages/_kit/job-note.astro` — storybook demo mount
- Every state on a **phone viewport** (`min(100%, 390px)`): `ready_to_save` ·
  `filed` · `needsReview` · each source (voice/photo/scan/note/text_in) ·
  with/without media. **All views go through the real `toJobNoteView`** (plus one
  through `capturedEventToPayload` to prove write-presence), so the demo exercises
  the pipeline, not hand-built fixtures.

### 5. `tests/lane-b-job-note.test.ts` — 20 tests
- Mapper: every source; filing from write-presence (ready vs filed); persisted-event
  ⇒ filed; channel derivation; summary cleaning/truncation/fallback; tenant-scope
  refusal; needsReview/media optionality; **no-PII `expandHref`**; `formatFiledTime`.
- **No false persistence:** `jobNoteFilingLabel` refuses "Filed" from a
  `ready_to_save` filing (including a smuggled `at`) and from a `filed` with empty `at`.
- Component source contract: derives copy from helpers (no hardcoded "Filed");
  `needsReview` → `Chip` with a neutral row; disclosure not stamped per row;
  `JobNoteList` owns the section disclosure; demo covers all states.

---

## Coordination point (Lane A builds against this)

```ts
import JobNote from '../components/JobNote.astro';
import JobNoteList from '../components/JobNoteList.astro';
import { toJobNoteView } from '../lib/jobNote.js';

const view = toJobNoteView(capturePayload, jobContext); // pure, tenant-scoped
// <JobNoteList label="Recent field captures"> <JobNote view={view} /> </JobNoteList>
```

Consumers pass a `JobNoteCapturePayload` (or adapt a `daily_log.entry_captured`
event via `capturedEventToPayload`) + a `JobNoteJobContext`. They never set the
filing state directly — the pipeline derives it from the durable write.

**i18n note:** the leaf copy ("Ready to file" / "Filed ·" / "via …" / "Needs
review" / the disclosure) is English defaults exposed via helpers/props rather
than wired into the shared `i18n/*` files. This keeps the lane a clean,
conflict-free file split during concurrent lanes; localization can pass
`JobNoteLabels` / a `disclosure` string later without touching the component.

---

## Acceptance

- [x] `JobNote` renders every state per the contract; thumbnail/row tap → `expandHref`.
- [x] `toJobNoteView` unit-tested per source; filing derived from write-event presence (not assumed); summary truncation; tenant scoping.
- [x] Component refuses "Filed" from a `ready_to_save` input (test).
- [x] `needsReview` renders as a chip; row stays neutral (test).
- [x] Disclosure is a section-level slot/prop, not per-row.
- [x] Demo mount covers all states. `typecheck` · `build:astro` · component/mapper tests pass.

---

## Verification — clean worktree

Verified from a **fresh `git worktree` detached at the pushed commit `06caf8d`**
(not the shared workspace), with a clean `npm ci`.

```
worktree HEAD: 06caf8d
npm run typecheck    → tsc --noEmit · no errors
npm run build:astro  → ✓ server built · prerender complete (the _kit/job-note demo page builds)
node --import tsx --test tests/lane-b-job-note.test.ts tests/route-shell-smoke.test.ts
   → 21/21 pass (20 Lane B · route shell serves all 13 legacy paths without 5xx)
```

Only new files were added; no existing module was modified, so the full suite is
unaffected by this lane.

### Branch hygiene note

The shared working copy is being mutated by other concurrent lanes. During push
the working copy's checked-out branch had been switched to `phase-1j-rh3-stage4`
(with unrelated uncommitted work from another lane present). The Lane B commit
landed cleanly (only the 5 Lane B files, parent `0caf84c`), but on that branch
ref. It was moved to `lane-b-job-note-artifact` and pushed; `phase-1j-rh3-stage4`
was restored to its original `0caf84c` non-destructively (other lanes'
uncommitted changes preserved). Net: `lane-b-job-note-artifact = origin/main + 5
Lane B files`, nothing else touched.

---

*Lane B · 2026-06-01. One renderer, many mounts. Producer for the concurrent lanes. Not merged — pushed for review.*
