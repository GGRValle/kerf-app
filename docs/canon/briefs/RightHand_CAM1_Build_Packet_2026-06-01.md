# Build Packet · F-CAM1 Camera + the cold-capture test · 2026-06-01

**Packet #1 of 4** in the staged surface-alignment queue (Camera → Daily Log → role bars after D-046 → builders). See `RightHand_Build_Orientation_2026-06-01.md`.
**For:** the build lane (Cursor lead + deployment · Cowork review · Christian merges).
**Build target:** `_docs/wireframes/F-CAM1_mobile_camera.html` (read the Annotated panels).
**Canon:** `kerf_right_hand_camera_universal` · Phase 1H Multimodal Draft Path (synthesis under the validator wall) · `F-RC1` + `kerf_lidar_precision_limits_and_apple_wrap` (LiDAR) · `feedback_trust_first_precision_later` (gap-flag, never fabricate) · D-053 two-artifact · the friendly job-note packet.
**Gate:** Proportional Above The Floor (D-058). Bar 3 boss question: *can Christian capture a real jobsite on his iPhone and get back something honest and useful?*
**Step 0 (D-057):** vendor `F-CAM1_mobile_camera.html` into kerf-app first and build from its **Annotated** panels — not from this brief's prose. If they disagree, the wireframe wins on layout/behavior, the brief wins on floor/safety/acceptance.

---

## Why this is packet #1 (the thesis, founder-set)

**Camera + LiDAR are the purest test of Right Hand's information-gathering — with no pre-fed contractor data.** A walkthrough (what he says while filming), a scan (the plans and spec sheets), and a room scan (the geometry) should each yield real, structured signal **on their own**, before any cost library, past-jobs cohort, or tenant memory is in play. One LiDAR pass already produces **five cross-scope takeoffs** (HVAC Manual-J volume · tile sqft · cabinetry linear ft · electrical · plumbing rough-in) purely from captured geometry — that's information gathering with zero priors.

**Refine the cold floor first. Context elevates it second.** The sequence is deliberate:
1. **Now (this packet):** make raw capture → honest understanding work with nothing pre-fed. Thin or ambiguous input comes back **gap-flagged**, never invented.
2. **Staged follow-on (after the cold floor is good):** layer Phase 1H context inputs — project history, cost library, variance bands, tenant room memory — to elevate specificity and pricing. **Do not pull context forward into this packet.** We want to see, and trust, the cold-capture quality on its own first.

If the cold floor is good, context makes it great. If we skip straight to context, we never learn whether the capture pipeline is actually carrying its weight.

---

## What this packet builds

### A. The camera as a universal component

Per `kerf_right_hand_camera_universal` — build F-CAM1 as **one reusable camera**, not a screen:

- **Routing gate first.** A project or lead must be selected before the camera opens, so captures never orphan. A clocked-in field worker's current job is **pre-selected** (one tap). Manager: search / recents / new lead.
- **One camera, three inline modes** (no interstitial landing pages — fixes v47 Defect 2): **Walkthru · Photo · Scan**, switched in place (iPhone-style mode strip). Top chrome: Settings · Flash · front/rear flip · job chip · close. Zoom pills (.5/1×/3×).
- **Consistent Done exit on all three modes** (same gold pill, same spot): one way out, saves to the job, returns to origin.
- **Invoked system-wide.** "Add a photo" from inside a job / Daily Log / estimate opens THIS interface with the job already known → routing gate skipped, Done returns to the calling surface. Only the bottom-bar Camera (no context) hits the gate first.
- **LiDAR stays separate** (F-RC1, Apple RoomCaptureView). Camera does everything *but* LiDAR; Room scan launches the native capture then wraps results.

### B. The capture → understanding wiring (the actual test)

Each mode feeds the **Phase 1H synthesis path** (heavy model produces the understanding, Kerf substrate produces the governance) — reuse it, don't reinvent:

- **Walkthru** = video + live audio. On Done: transcript (realtime/Whisper) + vision frames → one synthesis call → `draft.synthesized` (summary · candidate type · gap flags · source refs). Renders as a **friendly job note** + video thumbnail in the Daily Log (the artifact packet), routed to the job. The live "Right Hand listening · REC" pill + waveform make recording honest.
- **Scan** = document capture (edge-snap, multi-page; **not** LiDAR). Saves to the job's **Documents**, runs vision/OCR, and is **offered** (not auto-run) to Right Hand as source for an estimate or change order (feeds F-CHG1 / F-EST1). Plans, spec sheets, site info become structured input.
- **Photo** = the default; files to job photos / today's Daily Log. May still get a one-line vision caption for searchability, but no heavy synthesis required.
- **Room scan (LiDAR, F-RC1, companion)** = geometry → the five cross-scope takeoffs, each carrying a **use-label** (Estimate-safe / Verify before release / Manual) per `kerf_lidar_precision_limits_and_apple_wrap`. Release for cabinetry/stone/glass/millwork blocks until tape-verified.

All synthesis passes the **validator wall** before anything is shown or persisted: schema valid · no model-written money field · no autonomous send/route · every claim has a source ref · tenant-scoped (one tenant's data only).

---

## The cold-capture quality bar (this is the **V1.1** bar, not V1)

V1 ships a usable camera shell on its own (captures attach to the right job with honest status). The deeper bar below is **V1.1 · cold-understanding** — honest understanding from raw capture, no priors — added when the synthesis backend is ready:

- A 30–60s Walkthru of a real GGR-style scope produces a draft whose summary a PM would call **accurate and useful** — and where the model is unsure (a measurement it couldn't hear, a product it can't name), it **gap-flags** instead of guessing.
- A scanned plan/spec comes back as a usable document + an honest extraction (what it could read), gaps marked.
- A room scan returns the five takeoffs with correct use-labels; nothing fab-critical is released as estimate-safe.
- **No fabrication anywhere.** With no contractor data fed in, thin is expected — the right answer is "here's what I caught, here's what I need," not invented specifics or prices. (`feedback_trust_first_precision_later`.)

This is the floor we refine before adding context.

---

## Context elevation (staged follow-on — NOT this packet)

Once the cold floor is trusted, a second packet layers Phase 1H context inputs to elevate: project archetype + history, cost-library matches, variance bands ("your past pantry jobs"), tenant room memory (the 5-year remarketing moat). That's where capture becomes a priced, specific draft. **Explicitly out of scope here** — flagged so it isn't pulled forward.

---

## The floor (Bar 2 · non-negotiable)

- Tenant isolation: capture, synthesis inputs, and context reads carry one tenant's data only; no cross-tenant path.
- No model-written money values. No autonomous send/route/approve. Scan→estimate is an **offer**, confirmed by the operator.
- Recording honesty: the REC/listening state is always visible during Walkthru.
- No PII in URLs. Raw model output never rendered unparsed (validator wall between synthesis and screen). UI never crashes on an empty/failed capture — falls back honestly.
- Captures route to a job; nothing orphans (gate enforces it). LiDAR fab-release gating respected.

## Bar 3 (drive the real path)

Christian, on his iPhone: opens Camera (or "add a photo" from a job) → job is known or picked in one tap → films a 40s walkthrough talking through a real scope → taps Done → gets a friendly job note + video filed to that job's Daily Log, with an honest summary and gap flags, no fabricated numbers. Switches to Scan, captures a plan → it lands in Documents and offers itself to an estimate. Every mode exits the same way with Done.

---

## Acceptance — split into two levels (founder refinement)

Build the **shell first** (V1), independent of the synthesis backend. Add **cold-understanding** (V1.1) when the synthesis path is ready. This keeps us from overpromising "real synthesis" before the backend can carry it, while still building the exact F-CAM1 shell every future capture surface reuses. (Context elevation — tenant memory / cost library / project history — remains a *later packet*, not part of either level.)

### Level V1 · Usable camera (the shell — build now, backend-independent)

- [ ] **Job gate** precedes the camera; clocked-in job pre-selected; manager can search / recents / new lead.
- [ ] **Inline Walkthru / Photo / Scan** modes — no interstitial pages; mode strip switches in place.
- [ ] **Consistent Done** on all three modes; saves to job; returns to origin.
- [ ] **Job-context skip** — invoked with a known job, the gate is skipped and Done returns to the caller; bottom-bar Camera (no context) hits the gate first.
- [ ] **Thumbnail / selected-file state** — captured photo/video/scan shows as a thumbnail/selected item before it's committed.
- [ ] **Honest status language** — "ready / attached / failed," never a false "saved." (Uses Lane B's `JobNote` filing states where it renders as a note.)
- [ ] **No orphan captures** — everything routes to a job; nothing saves unattached.
- [ ] Top chrome (Settings/flash/flip/close) + zoom present. LiDAR not in this camera (Room scan → F-RC1).
- [ ] Verification: `npm run typecheck` · `build:astro` pass; focused camera/routing/Done tests pass; **path-truth** — the shell driven on a real phone (gate → mode → capture → Done → filed to job), shown working, not asserted.

> V1 is a **real, useful camera on its own** even with synthesis stubbed: captures attach to the right job as files/thumbnails with honest status. That's shippable and it's the substrate all capture work reuses.

### Level V1.1 · Cold-understanding (add when the synthesis backend is ready)

- [ ] **Walkthrough transcript + vision synthesis** on Done.
- [ ] **Scan OCR / vision extraction.**
- [ ] **`draft.synthesized`** event (validator-wall-passed) per Phase 1H.
- [ ] **Daily Log artifact** — the friendly job note + video/photo thumbnail (Lane B `JobNote`) lands in the job's Daily Log.
- [ ] **Gap flags** — thin/unclear input is flagged, **never fabricated** (no invented specifics or prices — the cold-capture honesty bar).
- [ ] **Validator-wall proof** — no model-written money, no autonomous send, every claim has a source ref, tenant-scoped; raw model output never rendered unparsed.
- [ ] Room scan (F-RC1) → five cross-scope takeoffs with correct use-labels; fab-release gated.
- [ ] Verification: synthesis/validator/gap-flag tests pass; **path-truth** — a real 40s Walkthru produces an honest draft on a real phone, shown working. Cowork can re-drive the live deploy to confirm the cold-understanding bar.

> V1.1 is where the **cold-capture thesis** is actually proven: honest understanding from raw input, no pre-fed contractor data. Don't claim it until this level's tests + a live drive pass.

### Floor (Bar 2 · applies to BOTH levels)
- [ ] Tenant-scoped throughout; no money written by model; no autonomous send; scan→estimate is an **offer**.
- [ ] Recording state visible during Walkthru; honest fallback on failed capture; UI never crashes on empty/failed input.

---

## What this packet is NOT

- NOT the context-elevation layer (cost library / past jobs / tenant memory) — that's the staged follow-on.
- NOT a new synthesis substrate — reuse Phase 1H's path + guards.
- NOT LiDAR re-skinning — Apple owns capture (F-RC1); Kerf wraps results.
- NOT auto-running estimates from a scan — capture is an offer; the operator decides.
- NOT a per-entry-point camera rebuild — one universal component, reused everywhere.

---

*Build packet #1 · 2026-06-01 · its own implementation lane/branch, separate from the F-RH3 conversation polish. Ship V1 (the usable camera shell) first — backend-independent, the substrate all capture reuses. Add V1.1 (cold-understanding) when the synthesis path is ready — that's where the thesis (honest understanding from raw capture, no pre-fed contractor data) is proven. Context elevation is a later packet. Camera + LiDAR are the test of whether the system gathers real jobsite information, not just transcribes.*
