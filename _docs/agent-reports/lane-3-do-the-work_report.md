# Lane 3 · Do the Work — report-back

**Branch:** `lane-3-do-the-work`  
**Worktree:** `/Users/christianasdal/code/kerf-app-lane3-work`  
**Base:** `origin/main` @ `204f934` (Lane 1 contracts #287)

## Path driven (Bar 3)

| Step | Route / device | Result |
|------|----------------|--------|
| Project brain + tabs | `/projects/proj_wegrzyn_kitchen` | Overview · Selections · Daily Log · Notes · Client Portal |
| Camera job gate | `/camera` → pick job → Photo / Walkthru / Scan | Three modes · file picker · session preview |
| Done → daily log | Return `?src=camera` → POST `camera-capture` | `daily_log.entry_captured` + two-artifact pair (`job_note` + `review_suggested` attention) |
| Daily log tab | `/projects/.../daily_log` | Loads audit projection entries |
| Schedule substrate | `/schedule` · API `schedule-substrate` | D-032 `schedule_event` + `crew_assignment` envelopes |
| Assign + send WO | `/team-ops/subs` | Confirm-gated `send-work-order` · relay message (no autonomous send) |
| Sub portal (2 subs) | `/sub/portal/s/subtok_pacific` vs `subtok_apex` | Each sees one assignment; cross-read → 403 |
| COI attention | `GET /team-ops/compliance` | Pacific Tile COI expiring → `risk_changed` attention artifact |
| LiDAR | `/room-capture` | Verify labels unchanged (no auto-release for cabinetry) |

## Self-healed

- Replaced inert project tabs (preview-only schedule/field) with **functional** tab panels.
- Wired **camera Done** to durable daily log commit (was session-only on main).
- Implemented **D-032** types in `src/schedule/d032Substrate.ts` + assignment-centric API projection.
- **Two-sub isolation** test + 403 on cross-assignment read.

## Produces / consumes

- Consumes Lane 1 contracts (`TwoArtifactPair`, `AttentionArtifact`, `classifyConsequenceGate` via confirm flags).
- Camera → `appendDailyLogEntryAndSurface` (existing field daily pipeline).
- Schedule assignments exposed for Lane 4/6 via JSON substrate (no Lane 2 file edits).

## Fix queue

- Portal preview page is stub (Clients lane owns full client portal).
- Project portal tab links preview only; no client login on this branch.
- Clock-in on sub assignment is alert stub (HR/payroll → Lane 4).
- GC preview hardcodes Wegrzyn dogfood project on schedule/subs pages.
- Full suite still has pre-existing v15 bundle / route-shell failures unrelated to this slice.

## Human judgment

- Persist `schedule_event` / `crew_assignment` as first-class persistence events vs fixture store.
- Production sub auth (token issuance, no PII in URLs).
- Whether camera should POST on Done **before** navigation vs on project land (current: land + confirm).

## Verification

```bash
npm run typecheck
node --import tsx --test tests/lane3-do-the-work.test.ts
npm run build:astro
```

**Served sha:** commit on clean tree · `GET /api/v1/health` → `commit` + `dirty: false`.
