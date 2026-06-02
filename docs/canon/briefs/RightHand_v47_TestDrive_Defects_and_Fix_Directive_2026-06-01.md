# Directive · Right Hand v47 · Live Test-Drive Defects + Fixes · 2026-06-01

**For:** the build lane that takes the next pass (Codex or Claude Code).
**Source:** Cowork drove the live app in-browser (Fly `kerf-v17-internal`, v47) on 2026-06-01 — not a report review. Findings below are observed on the running deploy. Where a finding is Christian's iPhone observation that Cowork could not reproduce on a desktop-width browser, it's labeled **[founder-observed, not re-driven]**.
**Pairs with:** `RightHand_ModelLed_Persistent_Response_and_JobNote_Artifacts_2026-06-01.md` (the model-led + job-note packet). This directive is the defect list; that packet is the forward design. Same gate: Proportional Above The Floor (D-058) — Bar 3 boss question is *"can Christian drive this on his iPhone and have it feel real?"*

---

## What's actually good on v47 (don't regress these)

- **Home** matches F-A1b: "Right Hand says" · The one thing · On deck · The pulse. Good.
- **Negation grounding works.** Typed "Log a note on the Clem bathroom, **not Wegrzyn** — slab came in short" → Right Hand replied *"this looks like a job note for Clem bathroom"* and grounded to **Clem, not Wegrzyn.** The #281 seam fix holds for this phrasing.
- **No auto-navigation on Stop.** Pressing stop did **not** punch through to `/projects/new`. That half of the One-Surface Directive landed.
- **The reply is reasonably conversational and honest** — *"I'll file it there when you say Save"* is correct `ready_to_save` honesty.

Keep all of the above.

---

## Defect 1 · The overlay is STILL a card-with-buttons (the #1 issue)

**Observed (driven):** Tapping the mic opens a **centered modal card over a dimmed (not blurred) background**. Pressing stop swaps the listening card into a **"READY FOR CHRISTIAN" card with a three-button row: `Don't save` · `Keep talking` · `Save`.** The reply asks *"Is this a new job or an existing one?"* — but the buttons don't answer that question. So it reads as a dialog box with mismatched buttons, which is exactly the pattern that's been ruled out twice (One-Surface Directive, F-RH2).

**Required:**
- **Blurred background, not dimmed scrim.** The current screen blurs behind one persistent surface (F-RH2 / overlay realtime-caption canon).
- **No button row as the primary affordance.** The next move lives **in Right Hand's sentence.** "I'll file this as a job note on Clem — say *save* or keep talking." Voice/type continues the turn; the input stays. At most ONE quiet inline affordance, and if an affordance exists it must **answer the question being asked** (if RH asks "new job or existing?", the affordances are *New job* / *Existing*, not *Save/Don't save*).
- **One surface, append in place.** Listening → reply must not read as card-A-swaps-to-card-B. Same blurred surface; the reply appends under the user's words; the mic/input persists.
- **Honesty floor stays:** "Saved" only after the durable write returns; `ready_to_save` before.

**Acceptance:** speak/type → stop → reply appears in the **same blurred surface** as conversational prose with the next move in the sentence; no 3-button dialog; any inline affordance matches the question; keep-talking continues in place; no route change on stop.

> This is the candidate to hand to Claude Code. It's been specified twice and the card-with-buttons persists — it likely needs a component rebuild, not another patch.

> **Explicit start-to-end reference: `F-RH3_mobile_right_hand_conversation_lifecycle.html`.** Built to answer the build lane's fair question — *"when the conversation stops, where does the info go?"* The answer: a **consequence bubble inside the same surface** (stage 4), appearing only when a durable write is imminent, phrased as the real question (*"Save to Wegrzyn → Daily Log? · Change job · Keep talking"*) — affordances that answer where-to-send, NOT a generic Save/Don't-save/Keep-talking card. Read the F-RH3 Annotated panels for the five stages and the contract bar.

---

## Defect 2 · Camera fan-out routes to landing pages, not functions  **[founder-observed, not re-driven]**

Cowork could not reach the bottom-bar Camera sheet on a desktop-width browser (it's a mobile-only bar; `/camera` redirects to Home). Recording Christian's iPhone observation as the spec:

**Observed (iPhone):** Camera opens a fan-out of four options. Selecting one lands on **another interstitial page** instead of doing the thing.

**Required — each option goes straight to its function:**
- **Photo** → opens the photo camera directly. (Real capture wired later; the *route* must be photo, not a landing page.)
- **Video** → opens video capture directly.
- **AI-assisted walkthrough** → opens **video capture with Right Hand listening for the whole duration of the video** — a twofold simultaneous action (record + live AI listen), not a separate page. The AI narration/listening runs concurrently with the video.
- **Room scan** → launches **Apple RoomCapture (LiDAR) intake** directly (see Defect 4).

**Acceptance:** each of the four picks invokes its capture mode directly; no interstitial landing between pick and function.

---

## Defect 3 · "Daily log note" is the OLD capture-card + a confusing second mic

**Observed (driven):** Create → Daily log note routes to `/field-capture` and renders the **old capture-card look**: a heavy "GOES TO" routing table (Active job / Client / Project / Location), big green callouts, and three action tiles (Add photo / Attach file / Edit summary). Separately, there is a **green in-surface mic block** ("You're on this job — speak to add a note here") that is **distinct from the global Speak mic** — the page carries **5 mic elements.** Two mic affordances on one screen is the confusion Christian flagged.

**Required:**
- **Retire the capture-card as the primary surface.** A daily log note should render as the **friendly job note** from the paired packet: one model-written plain-English line + thumbnail + quiet source chip (`via voice/photo/text`) + honest filing line (`Filed to … Daily Log` / `Ready to file`). Routing (which job) confirms inline, not as a full GOES-TO table dominating the screen.
- **One mic, not two.** Remove the green secondary in-surface mic prompt. The global Speak mic is the single voice affordance. Keep one quiet "type instead" path for mic-off.
- Detail (full routing table, attachments) sits **underneath**, reached on tap — not the default rendering.

**Acceptance:** Daily log note opens as a friendly job-note capture, one mic affordance, routing confirmed inline; the heavy table is secondary.

---

## Defect 4 · Room scan skips the LiDAR capture and opens the summary

**Observed (driven):** Create → Room scan / LiDAR → `/room-capture` renders the **post-scan summary immediately** — pre-baked "Hernandez · pantry · 7'2"×11'8"" with measurements, use-labels (Estimate-safe / Verify before release), cross-scope takeoffs, Tenant Room Memory. **It never launches a capture.** The flow is inverted; the copy even says "Re-scan opens RoomCapture again," implying capture is buried behind a re-scan.

**Required (matches `kerf_lidar_precision_limits_and_apple_wrap` — Apple owns capture, Kerf wraps results):**
- Tapping **Room scan launches Apple RoomCapture (RoomCaptureView) first.** The native LiDAR intake is the entry.
- **After a scan completes,** the `/room-capture` summary card (the current screen) appears — measurements, use-labels, cross-scope takeoffs — for the operator to **verify dimensions** before release.
- The pre-baked Hernandez summary is fine as a *demo/last-scan* state, but it must not be what a fresh "Room scan" tap lands on. Fresh tap → capture → then this summary populated from the real scan.

**Acceptance:** Room scan tap opens the iOS LiDAR capture; on completion, the verify-summary renders from that scan; the summary is not the entry point.

---

## Defect 5 · Missing back buttons on many surfaces

**Observed (driven):** `/create` has **no back affordance at all** — the only navigation is the desktop top-nav, which **does not exist on the phone.** `/field-capture` *does* have "Back home." So back is **inconsistent**: present on some surfaces, absent on others. On mobile, a surface with no back and no bottom-bar route is a dead end.

**Required:** every pushed surface (Create, Camera modes, Room capture, Field capture, draft/detail surfaces) carries a consistent **back affordance** that works on mobile without the desktop top-nav — back to the prior surface, or Home. Audit every route for it.

**Acceptance:** no surface is a dead end on mobile; back is present and consistent everywhere.

---

## Suggested ownership

- **Defect 1 (overlay)** → Claude Code, component rebuild against F-RH2 + the One-Surface Directive. Highest priority; it's the core feel and has resisted two patches.
- **Defects 2–5** → can go to the same lane or Codex; they're concrete routing/rendering fixes with clear acceptance.
- All five honor the paired packet's friendly-job-note rendering and the Bar 2 / Bar 3 floor.

---

*Directive 2026-06-01. Driven on v47, not reviewed from a report. The overlay still reads as a dialog with buttons; the capture surfaces still look like a file cabinet; the LiDAR flow is inverted; back is inconsistent. Progress, but not right — fix to the floor, then proportional.*
