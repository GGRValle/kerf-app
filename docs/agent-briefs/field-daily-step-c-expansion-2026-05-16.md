# Brief: Field Daily Step C — Expansion + Internet-Deployable Demo

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **For:** Cursor SDK (or Claude direct) — successor sprint to Step B
- **Status:** Draft brief; will lock once Step B's PR stack merges and the demo loop is proven on home wifi
- **Anchors:**
  - `field_daily_workflow_design_2026-05-15.md` §8 (Track A boundary, Amended) + §12.5 (Step C scope)
  - `field-daily-step-b-vertical-slice-2026-05-16.md` (Step B master brief)
  - `canon_drift_audit_2026-05-16_session.md` (substrate-as-truth principle)

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

**Hard repo limits:** no force-push (neither `--force` nor `--force-with-lease`), no `git reset --hard`, no `clean -fd`, no `rm -rf`, no pre-merge branch deletion.

---

## 2. Why Step C exists

Step B closed the **vertical slice on `progress_update`** — voice in, drift card surfaces on /relay, operator marks reviewed. Henderson golden locked end-to-end.

What Step B did NOT do:
- Auto-emit `relay_card.surfaced` events. B.5's `/relay` UI reads `daily_log.facts_extracted` events directly as a proxy. The actual relay-card-surfacing **rule** (when does drift become a card?) is the missing piece.
- Lock extractor coverage beyond `progress_update`. The 9-field extractor (`dailyLogExtractor.ts`) works on any transcript, but it's only **tested + tuned** against `progress_update`. The other 6 entry kinds (`morning_brief`, `blocker`, `change_signal`, `safety_note`, `end_of_day`, `clock_event`) need fixtures + golden locks.
- Internet-reachable deploy. The demo runs on home wifi via `npm run demo:v15-vertical-slice:serve`. To dogfood with Mike-or-Kevin at an actual job site, we need a public URL.

Step C closes those three gaps. After C lands, the V1.5 internal release is **operationally credible** — multi-entry-kind, auto-surfacing, internet-reachable.

---

## 3. What's on main after Step B (the substrate Step C builds on)

| Substrate | Where | PR |
|---|---|---|
| Event log + projections + persistence types | `src/persistence/` | merged earlier |
| 5 Field Daily event types | `src/persistence/events.ts` | #185 |
| `POST /api/projects/<id>/daily-log/entries` endpoint | `scripts/serve-v15-vertical-slice.ts` | #188 |
| Field Capture play handler (B.1) | `src/persistence/fieldCapture.ts` | #193 |
| 9-fact extractor (B.2) | `src/persistence/dailyLogExtractor.ts` | #194 |
| Drift adapter (B.3) | `src/persistence/driftAdapter.ts` | #195 |
| Play scheduler wired into endpoint | `scripts/serve-v15-vertical-slice.ts` (handleCreateDailyLogEntry) | #200 |
| `/field` capture UI (B.4) | `src/examples/v15-vertical-slice/pages/field-daily-capture.ts` | #199 |
| `/relay` office surface (B.5) | `src/examples/v15-vertical-slice/pages/relay.ts` + `relay-feed-build.ts` | #201 |
| `GET /api/field-daily/relay-feed` endpoint | `scripts/serve-v15-vertical-slice.ts` | #201 |
| `POST /api/relay-cards/<id>/review` endpoint (B.6) | `scripts/serve-v15-vertical-slice.ts` | (pending Cursor) |
| End-to-end Henderson lock | `tests/e2e-field-daily-henderson.test.ts` | #197 (+ phase 2 by orchestrator after B.6) |

**Don't touch:** any of the above substrate files. Step C builds on top.

---

## 4. The thesis acceptance frame (unchanged)

Every PR in Step C must close some piece of:

> **Can Kerf turn daily field behavior into office action with almost no extra typing?**

Step B proved the substrate carries on `progress_update`. Step C proves it generalizes (multi-archetype) AND surfaces in the right places (auto-surfacing rule) AND works for real (internet-deployed).

---

## 5. Step C implementation order (~10-12h estimated, in 5 sub-steps)

### C.1 — Relay-card surfacing play (~2-3h)

**File:** `src/persistence/relayCardSurfacer.ts` (new)

A deterministic play that takes a `DailyLogDriftDetectedEvent` and decides whether to emit a `RelayCardSurfacedEvent`. The current `/relay` UI uses facts_extracted as a proxy; this play replaces the proxy with the canonical surfacing rule.

**The rule (deterministic, no LLM):**
- Severity **block** → ALWAYS surface a relay card
- Severity **warn** → surface if no card has surfaced for this entry_id in the last 24h (dedupe)
- Severity **caution** → surface if facts include `client_decision_flags` OR `scope_change_flags` (operator-actionable signals)
- Severity **info** → NEVER surface (info is observation only; lives in the audit trail)

```ts
export function runRelayCardSurfacingPlay(
  driftEvent: DailyLogDriftDetectedEvent,
  factsEvent: DailyLogFactsExtractedEvent,
  recentSurfaceHistory: readonly RelayCardSurfacedEvent[],
): RelayCardSurfacedEvent | null {
  // Rule table above; returns null when no card surfaces
}
```

**Wire into the play scheduler:** after `daily_log.drift_detected` is appended (PR #200's wiring), invoke this play. If it returns a non-null event, append it.

**Then drop the proxy:** B.5's `relay-feed-build.ts` currently reads `daily_log.facts_extracted` events. Update it to read `relay_card.surfaced` events instead. The /relay UI now reflects the canonical rule, not a proxy.

**Tests (~8 tests):**
1. block severity → always surfaces
2. warn severity, no prior surface → surfaces
3. warn severity, prior surface in last 24h → null (dedupe)
4. caution + client_decision_flags → surfaces
5. caution + scope_change_flags → surfaces
6. caution + neither → null
7. info severity → always null
8. propagates tenant/correlation/actor/entry_id from drift → surfaced; surfaced_to derived from project's PM/owner (single-tenant: hardcoded to project's actor for V1.5)
9. Henderson golden → block → surfaces (regression lock against the demo)
10. source_refs propagated from drift event

**Do NOT:**
- Invoke LLM for surfacing decisions
- Skip the surfacing if drift fires (the rule is the rule; UI filters, not the play)
- Add new severity levels (block / warn / caution / info is locked per `DailyLogDriftSeverity`)

---

### C.2 — Multi-archetype extractor coverage (~3-4h)

**Files:**
- `src/persistence/dailyLogExtractor.ts` (modify — tune pattern tables per entry kind)
- `tests/persistence-daily-log-extractor-multi-kind.test.ts` (new)

Currently the extractor's pattern tables are tuned against `progress_update` transcripts. Step C expands coverage to **5 additional entry kinds**:

| Entry kind | What to capture | New golden fixture (suggest) |
|---|---|---|
| `morning_brief` | Today's plan, expected completions, who's on-site | "Crew's on Henderson today, plan is to finish drywall on the east wall and start prime coat. Carlos out, Juan covering." |
| `blocker` | Description + cause; weather, materials, inspection delays | "Stuck on plumbing rough because the inspector hasn't been by yet. Three days now." |
| `change_signal` | Owner-driven scope additions; client decisions pending | "Owner wants to add a vent fan over the island. Need to spec something for the cabinet shop by Friday." |
| `safety_note` | OSHA events, near misses, injuries (record only — no auto-action) | "Near miss with the saw today, no injuries. OSHA log filed." |
| `end_of_day` | Completed vs. left, blockers heading into tomorrow, materials needed | "Wrapped framing. Inspection still pending. Need 8 sheets of 5/8 drywall first thing tomorrow." |

**clock_event already covered** — clock entries have null transcript, return EMPTY_EXTRACTED_FACTS. B.7 phase 1 locks this.

**Tuning approach (pattern, not LLM):**
- Reuse the existing pattern tables (`COMPLETED_WORK_PATTERN`, `BLOCKED_WORK_WITH_CAUSE_PATTERN`, etc.). Most should generalize.
- Where a new kind needs a category that didn't fire on `progress_update`, add a kind-specific pattern. Example: `morning_brief` may need a `today_plan` extraction that doesn't exist in the 9-field shape — but it doesn't, because the shape is fixed. Tune existing patterns to fire on morning-brief-style language ("plan is to", "Carlos out", etc.) where appropriate.

**Don't change the 9-field shape.** The `DailyLogExtractedFacts` interface is locked. Per-kind tuning happens inside the existing categories.

**Tests (~15-20 tests):** one golden fixture per kind, asserting which of the 9 categories fire vs. stay empty.

**Do NOT:**
- Add new categories to `DailyLogExtractedFacts` (the shape is canon)
- Use LLM scoring
- Add per-kind data structures — everything plugs into the same 9-field output

---

### C.3 — Drop facts_extracted proxy in /relay (~1h)

**File:** `src/examples/v15-vertical-slice/relay-feed-build.ts` (modify — only after C.1 lands)

Currently `buildRelayFeedFromEvents` walks `daily_log.facts_extracted` events to build the list. After C.1 wires the surfacing play and the scheduler emits `relay_card.surfaced` events on real captures, this proxy is no longer needed.

**Change:** read `relay_card.surfaced` events instead of `daily_log.facts_extracted`. The DTO shape stays the same (relay-card-shaped); only the source events change.

**Why this matters:** the proxy emits a relay card for EVERY capture (even clean on_track days). The surfacing play applies the actual rule (severity ≥ caution + client_decision_flags). Switching the source means the /relay list reflects what the office should actually see, not every fact-extraction event.

**Tests:** update the 3 affected B.5 tests (`v15-relay-surface.test.ts`) — replace facts_extracted seed events with relay_card.surfaced seed events. Same assertion shapes, different source.

---

### C.4 — Internet-deployable demo (~2-3h)

**Files:**
- `Dockerfile` (new) — containerize the serve script for Fly.io
- `fly.toml` (new) — Fly.io app config
- `.dockerignore` (new) — exclude `.kerf/`, `node_modules/`, test fixtures
- `docs/architecture/v15_internal_release_deploy_2026-05-?.md` (new) — runbook
- `package.json` (modify — add `deploy:fly` script)

**Why Fly.io over Vercel:**
- Vercel's serverless model doesn't fit the persistent JSONL event log + projection cache (would need to externalize storage, which is V2.0 work).
- Fly.io runs long-running Node processes natively; volume mounts persist the .kerf/ directory across deploys.
- Single-tenant V1.5 only needs one VM. ~$5-10/month.

**Deploy posture:**
- App name: `kerf-v15-internal` or similar
- Single region (LAX or SJC for SF Bay latency)
- Volume mount: `/data/.kerf` for event log persistence
- Env vars: `GROQ_API_KEY`, `GROQ_BASE_URL`, `PORT=8080`, `PERSISTENCE_DIR=/data/.kerf`
- No public domain initially (use the `*.fly.dev` URL); custom domain when V2.0 launches

**Auth:**
- V1.5 is single-tenant + single-operator (Christian + crew, no real users). For the dogfood demo, **no auth** is acceptable per the design doc.
- Add a simple `BASIC_AUTH_USER` + `BASIC_AUTH_PASS` env var that gates all /api/* and /field and /relay routes if SET. If not set, no auth (current behavior). This gives optional protection for the internet-deployed demo without requiring real user accounts.

**Tests:**
- A `tests/deploy/dockerfile-builds.test.ts` test that runs `docker build .` against a captured build context and asserts a successful image (CI-friendly; skip if Docker not available)
- Runbook documents the deploy command: `fly deploy --remote-only`

**Do NOT:**
- Add a real auth/user-account system (V2.0)
- Add multi-tenant routing (V2.0)
- Move persistence to a database (V2.0)
- Add observability tooling beyond `fly logs` (V2.0)

---

### C.5 — HOME tab smart-summary lead-in (~2h) — OPTIONAL

**File:** `src/examples/v15-vertical-slice/pages/field-home.ts` (new)

**Status: optional for Step C.** This is the on-ramp to Step D's full Field Hand shell (HOME/JOB/LOG/ME). Include if there's bandwidth after C.1-C.4; defer to Step D otherwise.

A read-only home view that summarizes what's relevant for the operator opening Kerf right now:
- Latest 3 captures across all projects (one-line each)
- Latest relay card surfaced (if any)
- Active clock state (if any clock_in event without a matching clock_out)
- "Capture daily update" button → `/field`

**Voice canon block stays active.** No "Right Hand says ..." copy until RH voice canon ships.

**Tests (~5):** layout, latest-3-captures rendering, active-clock detection, no premature voice copy.

---

## 6. Out of scope for Step C (deferred)

- **Step D — full HOME/JOB/LOG/ME shell** — D builds the bottom-nav Field Hand UI on top of C's substrate
- **Right Hand voice canon** — the "Right Hand says ..." copy that B.5/C.5 mark as placeholders; queued separately
- **Multi-tenant** — V1.5 is single-tenant (tenant_ggr); V2.0 adds tenant routing + auth
- **Photo capture + LiDAR (D-043)** — separate substrate
- **Real auth / user accounts** — basic-auth env var only in V1.5
- **Database persistence** — JSONL event log + projection cache stays through V1.5
- **Production monitoring / alerting** — `fly logs` only until V2.0

---

## 7. Reporting (required for each PR)

When each PR is ready, report in this exact shape:

- **Branch:** `feature/...`
- **Commit:** `<sha>`
- **Files changed:** `<list>`
- **Tests run:** `<commands + pass/fail counts>`
- **What could break:** `<honest list — even small risks>`

If you discover the design needs to deviate from this brief, **STOP and report before coding**. Don't silently work around a spec gap — that's how canon drift starts (see PR #198 audit for what that looks like in practice).

---

## 8. Sequencing notes

C.1 → C.3 are coupled: C.3 can't land until C.1 wires the surfacing play. Suggested order:
1. **C.1** (surfacing play) — own branch, off main
2. **C.2** (multi-archetype extractor) — own branch, off main; parallel-safe with C.1
3. **C.3** (drop proxy) — stacked on C.1
4. **C.4** (deploy) — own branch, off main; parallel-safe but **wait for C.1 to merge** before deploying so the deployed demo shows the canonical /relay behavior
5. **C.5** (HOME tab) — optional; if included, off main; parallel-safe

---

## 9. The acceptance demo for Step C

After all of Step C lands + deploys:

> Mike-or-Kevin opens `kerf-v15-internal.fly.dev/field` on his iPhone from the Henderson job site. Voice-captures a `change_signal` entry — "owner asked for a vent fan over the island." Three seconds later, Christian's laptop at the office shows the relay card on `/relay`: scope-change chip, owner-decision-pending flag, click into detail, click 'Mark reviewed → actioned'. Audit-trail link goes one click deep. **Six entry kinds × bilingual i18n × internet-reachable × auto-surfacing rule × end-to-end audit trail.** That's V1.5 internal release operational.

If we can't demo that after Step C, something in C didn't land right. Self-audit before sign-off.

---

## 10. Why this brief gets committed (not just paste-into-Cursor)

Same rationale as PR #196:
- Becomes a reference doc for canon-drift audit
- Replays during the cross-PR audit at session end
- Is the artifact a future ops reader uses to understand "what was the build call on 2026-05-16+"
- Cursor reads it verbatim before each sub-step PR

Step B's brief became the source of truth that the canon-drift audit (PR #198) corrected the design docs against. This brief will play the same role for Step C.
