# V1.5 Field Daily Workflow — Design
## Field crew → Office relay loop for the GGR/Valle internal release

- **Date prepared:** 2026-05-15
- **Repo state at draft:** `main@bd4cf27` (post-PR #164)
- **Author:** Claude (Agent 8, integration lead)
- **Audience:** Christian, ChatGPT, Codex (review on 2026-05-16)
- **Status:** Design draft. **No code in this PR.** Pins Priority 3 of the 30-day brief + the Daily Log canon flagged in the 2026-05-12 routing/memory brief §10.

---

## 1. Why this exists

Two prior briefs anchor this:

- **30-day brief Priority 3** — *"Field Relay / Job Daily: voice, photos, structured extraction, schedule/task drift, relay cards, change-order support."*
- **Routing/memory brief §10** — *"Field Daily is the workflow that consumes the Daily Log: field crew captures voice/photo update → Kerf extracts → Blackboard write preview → schedule/drift signal → Right Hand relay card to owner/PM → human review → audit."*

Today, the V1.5 spine handles a single field capture → scaffold draft flow (F-33 → F-37). It does NOT support:

- A returning crew member capturing a daily update on an existing job
- Drift detection between yesterday's plan and today's progress
- Relay from field (crew) to office (owner/PM) as a structured artifact
- Change-order signals from the field

This doc pins the Daily Log canon + Field Daily workflow MVP for those gaps.

---

## 2. Non-negotiables (from the 30-day brief + routing/memory brief)

- ✅ Deterministic core; LLMs at edges only
- ✅ All LLM output untrusted; schema/business-rule validation before side effects
- ✅ No autonomous pricing authority
- ✅ No autonomous money movement
- ✅ No external sends without approval
- ✅ Money as integer cents
- ✅ Structured artifacts shared between agents (not giant prompts)
- ✅ Per `feedback_audit_deep_link_not_top_nav.md`: audit lives behind §13 disclosure, NO top-nav Audit tab
- ✅ Per `kerf_agent_naming.md`: Right Hand / Mano Derecha (office) ↔ Field Hand / Mano de Campo (field) — locked bilingual pair; no PM Right Hand variants

---

## 3. The Daily Log canon (pinned)

A **Daily Log** is a per-(tenant × project × day) record of field activity. Architectural anchor:

```
DailyLog
  ├─ tenant_id
  ├─ project_id
  ├─ day                        (ISO date, no time component)
  ├─ entries[]                  (DailyLogEntry, ordered chronologically)
  └─ summary                    (denormalized rollup, projected from entries)
```

A `DailyLogEntry` is the unit of field capture:

```typescript
export interface DailyLogEntry {
  readonly entry_id: string;
  readonly captured_at: string;        // ISO8601 with time
  readonly captured_by: PersistenceActor;
  readonly kind: DailyLogEntryKind;
  readonly transcript_text: string | null; // voice → Whisper; null for photo-only or text-only
  readonly audio_uri: string | null;
  readonly photo_uris: readonly string[]; // kerf:// URIs to photo refs (D-043 substrate)
  readonly extracted_facts: DailyLogExtractedFacts;
  readonly source_refs: readonly SourceRef[];
}

export type DailyLogEntryKind =
  | 'morning_brief'      // start-of-day: what we're tackling
  | 'progress_update'    // mid-day: what we accomplished
  | 'blocker'            // crew hits an issue (material wrong, code question, weather)
  | 'change_signal'      // crew identifies scope-change candidate (owner asked for X)
  | 'safety_note'        // OSHA/safety event
  | 'end_of_day';        // close: what's done, what's left, what's needed tomorrow
```

`DailyLogExtractedFacts` is the structured residue of the entry — what Kerf extracted from the transcript (per the canon §7 of routing/memory brief):

```typescript
export interface DailyLogExtractedFacts {
  readonly completed_work: readonly string[];
  readonly blocked_work: readonly { description: string; blocker: string }[];
  readonly schedule_status: 'on_track' | 'behind' | 'ahead' | 'unknown';
  readonly new_task_candidates: readonly string[];   // crew said "we need to also do X"
  readonly scope_change_flags: readonly string[];    // crew said "owner asked for Y" → triggers CO signal
  readonly money_risk_flags: readonly string[];      // material substitution, vendor delay, etc.
  readonly client_decision_flags: readonly string[]; // "owner needs to pick Z by Friday"
  readonly materials_needed: readonly string[];
  readonly inspection_notes: readonly string[];
  readonly safety_notes: readonly string[];
}
```

**These are CANDIDATES, not commitments.** Right Hand surfaces them in a relay card; nothing auto-fires.

---

## 4. The Field Daily workflow (MVP scope)

Per the routing/memory brief §10's hard-cap one-week MVP rules:

### IN SCOPE for V1.5 Field Daily MVP

| Surface | What |
|---|---|
| **Field capture (mobile-first)** | Voice/text + photos via SourceRef with D-043 use labels (Estimate-safe / Verify-before-release / Manual required) |
| **Field Capture play** | Extracts the 9 `DailyLogExtractedFacts` fields deterministically (regex + classifiers; no LLM scoring) |
| **Schedule/Drift play** | Reuses Track A drift detection (`v1` already has this in `src/altitude/gate.ts`); produces a drift signal on the Blackboard |
| **Blackboard write preview** | NOT auto-write; operator reviews on next office-side login |
| **Right Hand relay card** | Office-side surface showing today's Field Daily entries grouped by project; click into per-entry detail |
| **§13 disclosure** | Trust signal on the relay card (per `feedback_audit_deep_link_not_top_nav.md`); audit is one click deep |
| **Audit trail** | `daily_log.entry_captured` events feed the existing event log |

### EXPLICITLY OUT OF SCOPE for the MVP

Lifting verbatim from routing/memory brief §10:

- ❌ No notifications
- ❌ No auto-task creation
- ❌ No auto-assignment
- ❌ No PM dashboard
- ❌ No new auth system (single-tenant only)
- ❌ No user preference UI (persona override is V2.0+)
- ❌ No multi-user crew access (single-operator dogfood: Christian + his son)
- ❌ No external sends
- ❌ No QBO/payment writes
- ❌ No photos without SourceRef + use label (D-043 substrate)

---

## 5. The agent surfaces

Per `kerf_agent_naming.md` (locked):

- **Field Hand / Mano de Campo** — the field-facing agent surface. Mobile-first. Crew (or owner-as-crew) opens this on a phone to capture daily updates.
- **Right Hand / Mano Derecha** — the office-facing agent surface. Owner/PM/estimator opens this on laptop. Sees the relay cards from Field Hand's captures.

**These are surfaces, not separate agents with personalities.** The same deterministic plays run underneath; the surfaces are skinned for the operator context.

Per `feedback_translate_canon_vocabulary_at_surface.md`: operator-facing copy uses *"your past jobs"* / *"this job"* — not *"the cohort"* / *"AltitudePacket."* Canon precision stays in canon.

---

## 6. New persistence events (additions to Step 1 vocabulary)

Five new event types — proposed for inclusion in `src/persistence/events.ts` after Codex review:

- `daily_log.entry_captured` — field crew captures a voice/text/photo entry
- `daily_log.facts_extracted` — Field Capture play emits structured extraction
- `daily_log.drift_detected` — Schedule/Drift play fires
- `relay_card.surfaced` — Right Hand presents the relay card
- `relay_card.reviewed` — operator reviews the relay card

(`daily_log.entry_captured` is the canonical event; the others are derived/post-processing.)

---

## 7. UI surfaces

### 7.1 `/field` (or `/m/field`) — Field Hand mobile capture

Mobile-first (matches Priority 5 of the 30-day brief). Operator (Christian, his son, future crew) sees:

- Active project switcher (per the `/projects` route from persistence Step 6)
- "Capture daily update" primary CTA
- Sub-actions: morning brief / progress / blocker / change signal / safety / end of day
- Voice record button (reuses PR #150's `MediaRecorder` substrate)
- Photo capture button (D-043 substrate; minimum for MVP is camera-input HTML `<input type="file" accept="image/*" capture="environment">`)
- Brief description text area (optional supplement to voice)
- Submit → emits `daily_log.entry_captured`; Field Capture play runs; result lands on Blackboard preview

### 7.2 `/relay` — Right Hand relay-card list

Office-facing. Owner/PM/estimator sees:

- Today's relay cards grouped by project
- Each card: summary + extracted-facts chips (completed / blocked / change-signal / money-risk / client-decision)
- Status: new / reviewed / actioned
- Click → relay-card detail
- Drift signal chip when present

### 7.3 `/relay/<entry_id>` — relay-card detail

- Source transcript (collapsible)
- Photos
- Extracted facts table
- "Mark reviewed" action — emits `relay_card.reviewed`
- Source-ref links to the entry, the drift signal (if any), the project's scaffold, the project's decisions
- §13 disclosure pattern: trust signal here; audit is one click deeper

### 7.4 `/projects/<id>/daily-log` — per-project Daily Log timeline

All entries for a project, day-by-day. Scrollable history. Same content as `/relay` but project-scoped instead of date-scoped.

---

## 8. Boundary with Track A drift detection (critical)

Track A Safety Spine already includes drift detection routed through Altitude Engine → Policy Gate → DecisionPacket → audit. Field Daily MUST NOT duplicate this. It **consumes** Track A drift detection.

Specifically:

- Field Capture play populates `DailyLogExtractedFacts`
- A small adapter (`fieldDailyToTrackADriftInput`) translates the extracted facts into the existing Track A drift validator's input shape
- Track A's drift validator (already in `src/altitude/gate.ts`) fires
- The drift signal lands on the Blackboard via the existing event log
- The relay card surfaces the drift signal

**No new drift logic in Field Daily.** The relay card is just a presentation layer on top of existing Track A primitives.

---

## 9. Photo handling — D-043 substrate

Per D-043 (LiDAR/RoomPlan is Day-1 V1.5 substrate, Apple `RoomCaptureView`, measurements carry use labels):

- Every photo captured carries a `D043UseLabel`: `Estimate-safe`, `Verify before release`, or `Manual required`
- Release for cabinetry/stone/glass/millwork blocks until tape/laser verification logged
- LiDAR scan files persist alongside photos in `.kerf/projects/<tenant>/<project>/captures/`
- The MVP supports **photo capture only** in the first cut; LiDAR ingest is a future hook (HTML5 file input ready; iOS `RoomCaptureView` integration is post-V1.5)

Photo SourceRef shape:

```typescript
{
  kind: 'photo';
  uri: `kerf://${tenant_id}/${project_id}/captures/<entry_id>/<filename>`;
  use_label: 'Estimate-safe' | 'Verify before release' | 'Manual required';
  excerpt?: string;  // operator description if added
}
```

---

## 10. Plays vs agents (canonical)

Per `project_kerf_architecture_principles.md` §5 and §9 of the routing/memory brief:

- **Field Capture** is a **play**, not an agent. Deterministic workflow handler. No personality. Produces structured artifacts.
- **Schedule/Drift Detection** is a **play**. Already on Track A.
- **Relay Card Builder** is a **play**. Projects facts into the office surface.
- **Field Hand / Right Hand** are **agent surfaces** (user-facing) — they don't carry conversational memory; they're context-switched UIs over the same plays.

This matters because "agent" framing tempts implementation as a personality-bearing entity with conversational memory. **That is not Kerf.** Kerf is plays at the workflow tier, agents at the surface tier.

---

## 11. Open questions for Codex review (May 16)

1. **Daily Log per-day boundary** — when does "today" end? Operator-controlled timezone? Server-clock midnight? Each tenant decides? Default: tenant-set local timezone, midnight cutoff.

2. **Photo upload payload size** — phones produce 2-5 MB images. Multipart POST? Direct binary? Chunked? Need a budget call before Step 5.

3. **Drift signal granularity** — per-entry (every capture fires a drift evaluation) or per-day (one drift evaluation at end-of-day rollup)? Per-entry is more responsive; per-day is less noisy.

4. **Change-order signal threshold** — what triggers a `change_signal` extraction? Keyword vocabulary ("owner asked", "they want to add", "scope change") OR explicit operator tagging? Default: keyword + operator-confirmable tag.

5. **Field Hand auth** — single-operator GGR/Valle today, but the brief mentions "Christian + his son on real GGR/Valle jobs." Do we need a basic actor-selector ("Who's logging this?") even without auth? Probably yes — for audit lineage.

6. **Offline capture** — operator is in the field with no cell signal. Browser localStorage queue + sync on reconnect? Or hard requirement on connectivity?

7. **Relay card "actioned" semantic** — what does it mean to action a relay card vs review it? Maybe `review_only` (read, no follow-up action emitted) vs `acted_on` (operator created a CO draft / updated scaffold / etc.) — needs UX call.

---

## 12. Build plan (after Codex review)

| Step | Description | Effort |
|---|---|---|
| **Step A** | Add 5 daily-log events to persistence vocabulary (extends Step 1 PR #165) | 1 hour |
| **Step B** | `DailyLogEntry` + `DailyLogExtractedFacts` types in `src/persistence/dailyLog.ts` | 2 hours |
| **Step C** | Field Capture play extends to emit `daily_log.entry_captured` | 3 hours |
| **Step D** | Deterministic facts extractor (regex + classifiers for the 9 fact categories) | 4 hours |
| **Step E** | `/field` mobile capture surface | 5 hours |
| **Step F** | Photo upload endpoint + storage (extends serve script) | 3 hours |
| **Step G** | Drift adapter (Field Daily extracted facts → Track A drift input) | 2 hours |
| **Step H** | `/relay` list + `/relay/<id>` detail surfaces | 5 hours |
| **Step I** | `/projects/<id>/daily-log` timeline | 2 hours |
| **Step J** | §13 disclosure + audit deep-link wiring | 1 hour |

**Total estimated effort:** ~28 hours of build (4-5 focused days).

Pacing per the routing/memory brief §10:
- **Week 1 (May 19–27)**: Steps A–C land (foundation)
- **Week 2 (May 27 – June 2)**: Steps D–G (real capture + extraction + drift)
- **Late Week 3 (June 3–8)**: Steps H–J (relay surface + audit polish)
- **Week 4**: dogfood Christian + son on a real GGR/Valle job; iterate

---

## 13. What this design intentionally does NOT include

Per the routing/memory brief §10 and 30-day brief:

- ❌ Multi-user crew access (single-operator only this phase)
- ❌ Push notifications (Codex back; PM dashboard; auto-task creation)
- ❌ External SMS / email alerts
- ❌ Auto-create change orders (relay surfaces the signal; operator drafts the CO manually)
- ❌ Live job-cam streaming
- ❌ GPS / geofence verification
- ❌ Time tracking (clock-in/clock-out for payroll)
- ❌ Inventory management
- ❌ Subcontractor coordination surfaces
- ❌ Material ordering flow
- ❌ Weather integration
- ❌ Voice round-trip (LLM-to-speech responses)
- ❌ Local LLM inference (Track A drift validators are deterministic; LLM-driven scope extraction is canon-only / Model Router work, May 16+)

---

## 14. Decision needed

Three things needed from you + Codex before Step A code starts:

1. **Approve the Daily Log canon** — `DailyLog` + `DailyLogEntry` + `DailyLogExtractedFacts` data shapes. If these are wrong, every downstream step pivots.

2. **Pick a default on the 7 open questions.** Either you decide directly, or you defer to Codex tomorrow.

3. **Confirm pacing.** The MVP is hard-capped at one week per the routing/memory brief, but it's ~28 hours of build. With Codex paired + Cursor parallelizable for some pieces (e.g., the deterministic extractor's regex tables), one week is achievable. If you want stretch into Week 3, no problem.

Once Codex unlocks decisions, Step A is a small extension to PR #165 (~1 hour). Steps B–J run through Week 2 + early Week 3.
