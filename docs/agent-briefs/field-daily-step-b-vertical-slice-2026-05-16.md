# Brief: Field Daily Step B — Vertical Slice on `progress_update`

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **For:** Whoever executes Step B (Claude, Cursor SDK, or Christian directly)
- **Status:** Live brief. Anchors tomorrow's primary build work for the GGR/Valle internal release.
- **Build target:** First operational mobile UI surface in Kerf. Path to the operational mobile unit Christian named as the critical path on 2026-05-15.
- **Anchored to:** `field_daily_workflow_design_2026-05-15.md` §12.2 (the revised vertical-slice-over-shell plan); `two_gate_release_structure_2026-05-16.md` (June 13 internal release gate); `right_hand_home_module_drawer_2026-05-15.md` §5 (Field Hand nav spec, smart-summary HOME framing).

---

## 1. Standing rules (verbatim — preserve in every worker handoff)

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

**Hard repo limits**: no force-push (neither `--force` nor `--force-with-lease`), no `git reset --hard`, no `clean -fd`, no `rm -rf`, no pre-merge branch deletion.

---

## 2. The thesis acceptance frame

Every PR in Step B must close some piece of:

> **Can Kerf turn daily field behavior into office action with almost no extra typing?**

If a PR doesn't bring us measurably closer to a field user tapping voice → office Right Hand surfaces a decision card without operator typing, it doesn't ship. Per Field Daily §12.6.

---

## 3. Why vertical slice over horizontal shell

Per the canon amendment in `field_daily_workflow_design_2026-05-15.md` §12 (revised 2026-05-16):

Original plan was shell-first: Field Capture play → types → `/field` UI → `/relay` UI. That risks scaffolding empty rooms — substrate gaps don't surface until the shell tries to use them.

**Revised plan**: build one event kind (`progress_update`) END-TO-END through every layer before any HOME/JOB/LOG/ME shell work. The full path:

```
Field Hand voice button (mobile)
  → Whisper transcribe (PR #150 substrate)
  → POST /api/projects/<id>/daily-log/entries (PR #188, live on main)
  → daily_log.entry_captured event written to JSONL
  → Field Capture play extracts 9 DailyLogExtractedFacts (deterministic regex+classifiers)
  → daily_log.facts_extracted event
  → Drift adapter consults Track A validator (src/altitude/gate.ts)
  → daily_log.drift_detected event (if drift)
  → Right Hand relay-card surfaces on /relay
  → relay_card.surfaced event
  → operator reviews → relay_card.reviewed event
  → §13 disclosure / audit deep-link
```

One event kind, every layer. Proves the substrate carries before the shell ships.

---

## 4. What's already on main (don't rebuild)

| Substrate | Where | State |
|---|---|---|
| Persistence event log + projections | `src/persistence/` | ✅ Live |
| 5 Field Daily event types + clock_event enum | `src/persistence/events.ts` (PR #185) | ✅ Live |
| `POST /api/projects/<id>/daily-log/entries` endpoint | `scripts/serve-v15-vertical-slice.ts` (PR #188) | ✅ Live, validated, source_refs synthesis wired |
| Whisper transcribe path | `scripts/serve-v15-vertical-slice.ts:handleTranscribe` (PR #150) | ✅ Live |
| Track A drift validator | `src/altitude/gate.ts` (W1 Policy Gate — generic validators) + `src/workflows/drift-detection.ts` (W3 LLM drift) | ⚠️ Partial — neither exposes a `(facts) → (drift signal)` callable; B.3 builds a Field-Daily-specific deterministic classifier per the brief's "precursor fix" escape hatch. See PR #195 doc comment for the seam where a future unified validator could plug in. **No W3 logic was reimplemented.** [Amended 2026-05-16 by canon-drift audit.] |
| Proposal §7159 validator | `src/proposal/validation.ts` | ✅ Live |
| Cost KB seed v0.6 (tier-1) + tier-2 ingestion (PR #186) | `src/persistence/kbIngestion.ts` + `data/cost-kb-seed.json` | ✅ Live |
| Right Hand Home + Module Drawer canon | `docs/architecture/right_hand_home_module_drawer_2026-05-15.md` | ✅ Pinned (PR #180 + #187) |
| Field Hand bottom-nav spec + clock_event amendment | `docs/architecture/field_daily_workflow_design_2026-05-15.md` | ✅ Pinned (PR #181 + #187) |

The substrate is real. Step B builds on top of it; doesn't rebuild any of it.

---

## 5. Step B implementation order (~12h estimated, in 7 sub-steps)

Each sub-step is its own focused PR. Self-review summary required on every PR (cross-PR canon-drift audit at end of session per the self-review posture memory; see §9 below).

### B.1 — Field Capture play handler (~2h)

**File:** `src/persistence/fieldCapture.ts` (new)

A deterministic play that takes a `DailyLogEntryCapturedEvent` and emits a `DailyLogFactsExtractedEvent`. Pure function:

```ts
export function runFieldCapturePlay(
  entry: DailyLogEntryCapturedEvent,
): DailyLogFactsExtractedEvent {
  const facts = extractDailyLogFacts(entry.transcript_text ?? '', entry.entry_kind);
  return {
    event_id: generateEventId('evt'),
    type: 'daily_log.facts_extracted',
    tenant_id: entry.tenant_id,
    correlation_id: entry.correlation_id,
    actor: entry.actor,
    at: new Date().toISOString(),
    source_refs: [{ kind: 'transcript', uri: `kerf://daily-log/${entry.entry_id}` }],
    entry_id: entry.entry_id,
    facts,
  };
}
```

`extractDailyLogFacts` is the regex+classifier extractor in B.2. The play itself is just glue.

**Tests:** ~6 tests covering the play emits correctly-shaped events, propagates tenant/correlation/actor, handles null transcript_text (clock_event case), source_refs non-empty rule honored.

---

### B.2 — Deterministic 9-fact extractor for `progress_update` (~3h)

**File:** `src/persistence/dailyLogExtractor.ts` (new)

The 9 fields per `DailyLogExtractedFacts`:

```ts
{
  completed_work: string[],
  blocked_work: { description: string; blocker: string }[],
  schedule_status: 'on_track' | 'behind' | 'ahead' | 'unknown',
  new_task_candidates: string[],
  scope_change_flags: string[],
  money_risk_flags: string[],
  client_decision_flags: string[],
  materials_needed: string[],
  inspection_notes: string[],
  safety_notes: string[],
}
```

**For Step B scope: extract only for `progress_update` entry kind.** Other kinds (`blocker`, `change_signal`, `safety_note`, `end_of_day`, `morning_brief`, `clock_event`) get the same extractor shape but expand coverage in Step C. Locks the extractor pattern against one canonical fixture (Henderson voice transcript) before generalizing.

**Pattern**: regex + classifiers, NOT LLM scoring. Examples:
- `completed_work`: `/(pulled|completed|finished|wrapped up|done with)\s+([^.]+)/gi`
- `blocked_work`: `/(stuck on|blocker|can't|cannot|waiting on)\s+([^.]+).*?(because|due to)\s+([^.]+)/gi`
- `scope_change_flags`: `/(owner asked|they want|they're adding|change order|CO|new request)/gi`
- `money_risk_flags`: `/(galvanized|asbestos|hidden|surprise|going to cost|over budget|substitution)/gi`
- `materials_needed`: pattern-extract noun phrases after `/(need|bring|order|pickup|grab)\s+/gi`

Lock the extractor against the Henderson golden fixture (from `kerf_wireframes_mobile_v2.html` FRAME 7): *"Mike here at Henderson — we pulled the tub surround and there's galvanized all the way back to the main. Gotta replace about 8 feet. Bumping you on the…"*

Expected extraction:
- `completed_work`: `['pulled the tub surround']`
- `scope_change_flags`: `['galvanized replacement back to main']` (from galvanized → money_risk_flags too)
- `money_risk_flags`: `['galvanized']`
- `materials_needed`: `['8 ft copper 3/4"' OR similar inferred substitution]`
- `schedule_status`: `'behind'` (from "bumping you" + scope addition)

**Tests:** ~15 tests covering each of the 9 categories on the Henderson golden + 5-8 variant transcripts. Includes ZERO-LLM assertion (forbidden-surface test): the file imports no LLM/fetch/network module.

---

### B.3 — Drift adapter (~1h)

**File:** `src/persistence/driftAdapter.ts` (new)

Translates `DailyLogExtractedFacts` into the existing Track A drift validator's input shape, calls the validator, emits `daily_log.drift_detected` if drift fires.

```ts
export function adaptDailyLogFactsToDriftSignal(
  factsEvent: DailyLogFactsExtractedEvent,
): DailyLogDriftDetectedEvent | null {
  const trackAInput = fieldDailyToTrackADriftInput(factsEvent.facts);
  const driftResult = runTrackADriftValidator(trackAInput);  // existing function
  if (!driftResult.fires) return null;
  return {
    event_id: generateEventId('evt'),
    type: 'daily_log.drift_detected',
    // ... base fields propagated
    entry_id: factsEvent.entry_id,
    severity: driftResult.severity,         // info|caution|warn|block
    description: driftResult.description,
  };
}
```

**Critical: do NOT duplicate drift logic.** Field Daily §8 is non-negotiable: this adapter consumes Track A; doesn't reimplement. If the Track A validator doesn't expose a clean input shape, that's a precursor fix (small PR against Track A), not a duplication.

**Tests:** ~5 tests covering: drift fires on the Henderson golden facts, drift does NOT fire on a clean "on_track" facts payload, severity mapping correct, adapter handles missing/optional fact fields gracefully, source_refs propagated.

---

### B.4 — Minimal `/field` capture surface (~2h)

**File:** `src/examples/v15-vertical-slice/pages/field-capture.ts` (new)

**Critical: NOT the full HOME/JOB/LOG/ME shell.** Step B's `/field` route is a single-purpose capture surface for the vertical slice:

- Brand header: `KERF · FIELD` (matches FRAME 2 wireframe)
- Project switcher dropdown (uses existing `/api/projects` GET to populate)
- Big voice record button (reuses PR #150 MediaRecorder substrate)
- Submit → POSTs to `/api/projects/<id>/daily-log/entries` with `entry_kind: 'progress_update'`
- Renders the returned event_id + transcript_preview as confirmation
- That's it. No HOME tab. No JOB tab. No LOG tab. No ME tab. Those come in Step D.

The shell-before-substrate-carries trap was the whole reason for the vertical-slice pivot. Don't fall into it in Step B.

**HOME tab smart-summary check (§9 of this brief)**: when Step D builds the actual HOME tab, the verification trigger fires. Not yet relevant in Step B because there is no HOME tab in Step B.

**Tests:** ~5 tests — HTML builder shape, project switcher fetch path, voice button mounting, submit handler calls correct endpoint with correct body, post-render confirmation displayed.

---

### B.5 — Minimal `/relay` surface (~2h)

**File:** `src/examples/v15-vertical-slice/pages/relay.ts` (new)

Mirror of /field — single-purpose office-side surface:

- Header: `KERF · RIGHT HAND · RELAY`
- List today's relay cards (cards = `relay_card.surfaced` events grouped by project) — single tenant for V1.5
- Click a card → detail view with: source transcript, extracted facts table, drift signal (if any), source_refs links
- "Mark reviewed" button → POSTs `relay_card.reviewed` with outcome `acknowledged` / `actioned` / `dismissed`
- **§13 disclosure pattern**: every relay card has a small "audit trail" link that deep-links to the event lineage; NO top-nav Audit tab

**VOICE CANON BLOCK (§9.6 of Field Daily design)**: the relay-card render must NOT include operator-facing "Right Hand says..." voice copy until the Right Hand voice canon ships (queued May 16+). Mark all such copy with `[voice canon pending — placeholder]` markers. Substrate ships; voice ships separately.

**Tests:** ~6 tests — card list shape, detail-view fact rendering, drift signal chip when present, mark-reviewed POST path, §13 audit deep-link presence, no premature voice copy slipped in.

---

### B.6 — `POST /api/relay-cards/<id>/review` endpoint (~1h)

**File:** `scripts/serve-v15-vertical-slice.ts` (modify)

Wire the `Mark reviewed` button. Emits `relay_card.reviewed` event with operator-supplied `outcome`.

Validate: outcome in allowlist (`acknowledged` / `actioned` / `dismissed`), relay_card_id exists in event log, reviewer non-empty.

**Tests:** ~4 tests in `tests/v15-api-relay-route.test.ts` (new) — happy path each outcome, unknown outcome 400, missing card 404, non-POST 405.

---

### B.7 — End-to-end test on Henderson golden fixture (~1h)

**File:** `tests/v15-field-daily-vertical-slice.test.ts` (new)

Single test that exercises the full path:
1. Create project via existing endpoint
2. POST a `progress_update` entry with Henderson transcript
3. Run Field Capture play → assert facts extracted
4. Run drift adapter → assert drift fires (severity `block`)
   [AMENDED 2026-05-16 by canon-drift audit: this brief originally
    predicted severity `warn`. B.3's classifier (PR #195) emits `block`
    on Henderson because behind + money_risk + scope_change fire
    simultaneously — see PR #197's e2e test for the lock + rationale.
    `block` is the correct stricter office-side stop for the Henderson
    case; the original prediction was conservative.]
5. Simulate relay-card surface via direct event emission
6. POST review with outcome `actioned`
7. Read events.jsonl + assert 5 events in correct order:
   - `project.created`
   - `daily_log.entry_captured`
   - `daily_log.facts_extracted`
   - `daily_log.drift_detected`
   - `relay_card.surfaced`
   - `relay_card.reviewed`
   (6 events; let me recount — yes, 6)

This is the **acceptance test** for Step B. If it passes end-to-end with no manual gluing, the vertical slice has been demonstrated.

---

## 6. Verification gate (run before each sub-step PR)

```
npm run typecheck                              # expect: clean
npm test                                       # expect: 1107 + (new tests) passing, zero regressions
npm run demo:v15-vertical-slice:esbuild       # expect: bundle builds
git diff --check                               # expect: clean (no whitespace issues)
```

PR body must include: branch / commit / files changed / tests run (X/Y passing) / what could break.

---

## 7. Constraints (what NOT to do)

- Do NOT build the HOME/JOB/LOG/ME shell yet (Step D)
- Do NOT touch `src/altitude/gate.ts` to add drift logic — adapter only
- Do NOT add Right Hand voice copy to /relay surface — placeholder until voice canon ships
- Do NOT use LLM/Claude/Groq calls in the extractor — deterministic regex+classifiers only
- Do NOT add a top-nav "Audit" tab — §13 disclosure deep-link only
- Do NOT modify the cost_kb seed or tier-2 ingestion — orthogonal to Step B
- Do NOT introduce a 7th DailyLogEntryKind or extend the schema — Step B is just wiring the existing substrate end-to-end

---

## 8. HOME nav smart-summary verification trigger (DEFERRED to Step D)

The 2026-05-16 amendment review flagged that HOME tab must lead with relay-awareness (smart summary), NOT a project task list (folder-style). Per `right_hand_home_module_drawer_2026-05-15.md` §5 (sharpened in PR #187), this is canon.

**Step B does NOT build a HOME tab.** So the verification trigger doesn't fire yet.

**When Step D builds the actual Field Hand HOME tab, the worker MUST verify**:

- HOME leads with relay-awareness content ("office sent CO draft to Mrs. Henderson; expect inbound questions" / "Mrs. Henderson confirmed out until 2pm") BEFORE current task / clock status / this-week schedule
- HOME is NOT framed as "your folder for jobs" or "task list"
- ME tab "hours" framing reads as "for your own visibility only" — NEVER "Compliance Log" / "Timesheet" / "Pay Period"
- Materials state on JOB tab is three-way (delivered/pending/missing) one-tap actions, NOT a purchasing workflow

That verification is a Pulse Point 2 self-check (gap detection on canon conformance). Step D's PR must include an explicit "HOME nav verification:" section in its body addressing each of the four bullets above.

---

## 9. Self-review posture (carries through Step B)

Per the self-review posture memory (sibling doc landing this session): **high-velocity sessions (>5 PRs in one push) trigger a cross-PR canon-drift audit before sleep.**

Step B is ~7 sub-step PRs. That exceeds the trigger threshold. At the end of the Step B session, the worker MUST run a cross-PR audit:

- Compare each Step B PR's claims against the canon docs they reference
- Verify HOME tab framing wasn't drifted into during /field surface work
- Verify §13 disclosure pattern is preserved (no top-nav Audit slipped in)
- Verify voice-canon-pending placeholders are explicit, not absent
- Verify no LLM/fetch/network code slipped into the deterministic extractor or drift adapter

Document the cross-PR audit in a short note at the end of the session — same shape as today's amendment-review response. Captures the small drift that hides best on big days.

---

## 10. The mobile UI critical path

Christian named "the mobile UI" as the critical path on 2026-05-15. Step B IS that path. After Step B closes:

- Field Hand has a real capture surface at `/field` (single-purpose for now)
- Right Hand has a real review surface at `/relay`
- The full event chain works end-to-end on a real fixture (Henderson)
- The substrate is empirically proven to carry data through every layer

Step C extends the extractor to other entry kinds (~6h). Step D builds the full HOME/JOB/LOG/ME shell (~6h). Step E polishes (photos, timeline, dogfood iteration) (~4h). Total post-Step-B: ~16h. **At Step B close, the operational mobile unit exists in minimal form.** Steps C-E make it complete.

The June 13 internal release gate (per `two_gate_release_structure_2026-05-16.md`) requires the full Field Hand surface + Right Hand relay surface operational. Step B is the first half of that build. Pacing: ~28h total Field Daily build over ~5-6 focused days.

---

## 11. Provenance

Authored during the 2026-05-16 amendment-review cleanup session. Anchored to:
- `field_daily_workflow_design_2026-05-15.md` §12.2 (revised vertical-slice plan)
- `right_hand_home_module_drawer_2026-05-15.md` §5 (Field Hand nav + smart-summary HOME)
- `two_gate_release_structure_2026-05-16.md` (June 13 internal release)
- `slice_window_transition_2026-05-15.md` (slice closure context)
- `cost_kb_schema_dimensions_post_moorhead_2026-05-16.md` (orthogonal cost-KB work; not Step B scope)

This brief replaces no prior brief. It is the operational anchor for tomorrow's primary build.
