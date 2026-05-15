# Brief: Pair-Review the V1.5 Persistence Stack (#165 → #166 → #170 → #171)

- **Date:** 2026-05-15
- **Primary worker:** Codex (pair-review)
- **Fallback:** Cursor SDK worker
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Live brief; do not modify the 4 PRs without finishing the review first

---

## Standing rules (verbatim — keep this preamble in every worker handoff on GGRValle/kerf-app)

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

**Hard-rule reminders for this repo:** no `git reset --hard`, no `git clean -fd`, no `rm -rf`, no force-push (neither `--force` nor `--force-with-lease`), no branch deletion until the PR for that branch is merged.

---

## Why this brief exists

A 4-deep PR stack lands V1.5 persistence (JSONL event log + per-project projection cache + HTTP endpoints). Claude (Agent 8) built and self-reviewed the stack across 2026-05-14 → 2026-05-15. Before any of these PRs merge, a second pair of eyes needs to validate:

1. The design (locked in `docs/architecture/persistence_layer_v15_design_2026-05-14.md`) survives contact with the implementation
2. The 7 open design questions from §11 of that doc are answered with clear defaults
3. The stack is mergeable in order without cascade-rebase pain

If you accept the design as-shipped: approve each PR with a brief comment and queue them for merge in order.
If you find issues: comment on the specific PR with the concern; do NOT push fixes directly to Claude's branches (avoids merge conflicts mid-review).

---

## The stack under review

| PR | Branch | Base | Description | Files added |
|---|---|---|---|---|
| **#165** | `feature/v15-persistence-events` | `main` | Event vocabulary + validators | `src/persistence/events.ts` (480), `tests/persistence-events.test.ts` (372) |
| **#166** | `feature/v15-persistence-event-store` | `#165` | JSONL append/read store | `src/persistence/eventStore.ts` (256), `tests/persistence-event-store.test.ts` (427) |
| **#170** | `feature/v15-persistence-projections` | `#166` | Per-project projection cache | `src/persistence/projections.ts` (357), `tests/persistence-projections.test.ts` (458) |
| **#171** | `feature/v15-persistence-http-endpoints` | `#170` | HTTP endpoints on the serve script | `scripts/serve-v15-vertical-slice.ts` (.mjs → .ts conversion), `tests/v15-api-projects-route.test.ts` (290), plus 4 existing test files updated |

**Test surface:** 911/911 passing on the top of the stack at last local run.

---

## What to verify

### Phase 1 — checkout the top of the stack

```bash
cd ~/code/kerf-app
git fetch origin
git checkout feature/v15-persistence-http-endpoints
git pull --ff-only
npm install        # only if package-lock changed; otherwise skip
npm run typecheck  # expect: tsc --noEmit clean
npm test           # expect: 911/911 passing
```

### Phase 2 — read the design doc

Read `docs/architecture/persistence_layer_v15_design_2026-05-14.md` end to end. The relevant sections:

- **§1-3:** architectural posture (deterministic core, money as cents, tenant_id forward-compat with D-025)
- **§4:** on-disk layout (`.kerf/events.jsonl` + per-project projections)
- **§5:** event vocabulary (9 types, base header shape)
- **§6:** read path (projections rebuilt from events; events.jsonl is source of truth)
- **§7:** write boundary (validate before append; atomic O_APPEND; tmpfile+rename for projections)
- **§11:** **the 7 open questions Codex must rule on** (full list below)

### Phase 3 — answer the 7 open design questions

For each question, give one of: **APPROVE (current implementation)** | **CHANGE (with proposed alternative)** | **DEFER (with reason)**.

1. **Per-project projection files vs single events.jsonl as the operator-UI read path.**
   - Current: per-project projection JSON files at `.kerf/projects/<tenant>/<project>/index.json`, atomic-rebuilt after every append, plus events.jsonl as the narrative source of truth.
   - Alternative: drop the projection cache; have the operator UI scan events.jsonl every read. Simpler but O(events) per page load.
   - Question: keep the cache or drop it for V1.5?

2. **`scaffold.refined` event granularity — per-field vs per-apply.**
   - Current: per-apply (one event per "operator confirmed a batch of edits to one line"). `line_id` + `field` + `before` + `after`.
   - Alternative: per-field (12 edits to one line = 12 events).
   - Question: is per-apply the right default, or do we need finer audit grain?

3. **`actuals.recorded` semantics — auto-promote model_suggested → system_final vs operator-promote.**
   - Current: operator-promote only. `actuals.recorded` requires an operator action; the model never auto-finalizes a writeback.
   - Alternative: auto-promote when a model_suggested value matches a verified invoice within tolerance.
   - Question: which posture for V1.5? (Architecture brief is unambiguous: no autonomous money writes. Confirm the implementation matches.)

4. **Audio blob retention policy.**
   - Current: `CaptureRecordedEvent.audio_uri: string | null`. The event carries a URI but no blob storage yet — `null` for now; the field is forward-compat.
   - Question: are we ready to wire blob storage (S3-style local dir + content-hash filenames) in Step 5, or defer the blob persistence to Week 2?

5. **Tenant context UI default.**
   - Current: every event requires `tenant_id` in the request body; HTTP endpoints reject without it. No UI tenant-picker yet.
   - Question: should the browser client default to `tenant_ggr` (single-tenant phase) and let the operator switch via a dropdown, or require explicit pick on every action?

6. **Concurrent-write safety — etag vs last-write-wins on projection updates.**
   - Current: last-write-wins. POSIX O_APPEND guarantees the events.jsonl never tears, but the projection cache can be clobbered by two concurrent appends. In the single-operator phase this is fine; in 2027 multi-user it isn't.
   - Question: ship last-write-wins for V1.5 + add an etag header in Week 3, or block on etag now?

7. **`schema_version` on projection files.**
   - Current: locked at `'v1'`. `readProjectProjection` throws on mismatch (corruption is not silent — recoverable by rebuilding from events).
   - Question: approve the throw-on-mismatch posture, or downgrade to a warn-and-rebuild?

### Phase 4 — code-level audit

Spend the time you have on these specific concerns; they're where I'm most uncertain:

- **`src/persistence/events.ts:validatePersistenceEvent`** — does the validator catch every malformed event a malicious or buggy caller could produce? Specifically: float cents, string cents, ISO8601 with wrong format, unknown event type, missing tenant_id, empty source_refs on event types that require them.
- **`src/persistence/eventStore.ts:append`** — does the defensive re-validation at the write boundary correctly aggregate errors via AggregateError? Does O_APPEND actually guarantee atomicity on the target filesystem? (macOS APFS yes; Linux ext4 yes; Windows NTFS — not a concern for V1.5 but flag if you see something brittle.)
- **`src/persistence/projections.ts:rebuildProjectProjection`** — is it actually pure? Same events in → same projection out. Out-of-order event handling: an event with `at` earlier than a later event in the stream — does the projection still derive correctly?
- **`scripts/serve-v15-vertical-slice.ts:handleRecordCapture`** — when a capture is recorded against a project whose projection file is corrupted (readProjectProjection throws), the handler falls back to scanning events for the project.created event. Is this fallback correct, or should it 500?
- **`tests/v15-api-projects-route.test.ts:GET /api/projects/<id> rebuilds projection from events if cache is missing`** — does this actually exercise the rebuild path, or is the cache miss masked somewhere?

### Phase 5 — report

End your review with a single comment on PR #171 (top of stack) using this exact format:

```
## Codex pair-review of persistence stack #165 → #166 → #170 → #171

### Verification gate
- typecheck: <pass|fail + details>
- npm test:  <X/Y passing>
- bundle:    <pass|fail>

### 7 open questions
1. Per-project projection layout: APPROVE | CHANGE (alt) | DEFER (reason)
2. scaffold.refined granularity:  APPROVE | CHANGE (alt) | DEFER (reason)
3. actuals.recorded semantics:    APPROVE | CHANGE (alt) | DEFER (reason)
4. Audio blob retention:          APPROVE | CHANGE (alt) | DEFER (reason)
5. Tenant context UI default:     APPROVE | CHANGE (alt) | DEFER (reason)
6. Concurrent-write safety:       APPROVE | CHANGE (alt) | DEFER (reason)
7. schema_version on projection:  APPROVE | CHANGE (alt) | DEFER (reason)

### Code-level concerns
- <one bullet per issue found, with file:line and proposed fix>

### Merge recommendation
- [ ] Approve all four for sequential merge (#165 → #166 → #170 → #171)
- [ ] Approve #165 and #166; hold #170 and #171 pending <change>
- [ ] Block stack pending <change>

### Standing-rules report block
- Branch:        (n/a — review only)
- Commit:        (n/a)
- Files changed: (n/a)
- Tests run:     <command + result>
- What could break: <one paragraph or "nothing flagged">
```

---

## Constraints — what each worker may and may not do

The two paths have **different operational envelopes** because Codex runs as a review-only pair (no shell, no write) while Cursor runs as an SDK harness with full repo-write authority bounded only by the standing rules.

### For Codex (primary, pair-review only)

- Comments on the PRs only — no pushes, no merges, no file edits anywhere in the repo
- Do NOT merge any of the PRs yourself. Christian holds the merge button.
- Do NOT modify `docs/architecture/persistence_layer_v15_design_2026-05-14.md` — that's the design contract under review.
- Do NOT touch `src/proposal/*` or PR #173 — that's a separate independent branch.
- Standard repo rules from the standing preamble still apply: no force-push, no `reset --hard`, no `clean -fd`, no branch deletion.

### For Cursor SDK fallback (full write authority within standing rules)

Cursor runs as an SDK harness with the same authority Claude carries on this repo. It MAY:

- Read all files in the repo
- Run `npm`, `git`, `gh` commands locally
- Edit files in `src/`, `tests/`, `scripts/`, `docs/`
- Commit and push to **NEW** feature branches
- Open NEW PRs targeting the appropriate base in the stack

It MUST NOT (these are the standing-rules hard limits — non-negotiable):

- Force-push (`--force` or `--force-with-lease`)
- `git reset --hard`, `git clean -fd`, `rm -rf`
- Delete branches before their PR has merged
- Push directly to `main`
- Push commits directly to any of the 4 review branches (`feature/v15-persistence-*`) — those are Claude's; pushing onto them creates merge-conflict pain mid-review. Fixes go on NEW branches instead.
- Merge any PR (#165 / #166 / #170 / #171) — Christian holds the merge button
- Modify `docs/architecture/persistence_layer_v15_design_2026-05-14.md` — design contract under review
- Touch `src/proposal/*` or PR #173 — separate independent track

**If Cursor finds issues that need code fixes:**
1. Branch from the appropriate base in the stack:
   - Issue in events vocabulary → branch from `feature/v15-persistence-events` as `fix/v15-persistence-events-<short-desc>`
   - Issue in event store → branch from `feature/v15-persistence-event-store` as `fix/v15-persistence-event-store-<short-desc>`
   - Issue in projections → branch from `feature/v15-persistence-projections` as `fix/v15-persistence-projections-<short-desc>`
   - Issue in HTTP endpoints → branch from `feature/v15-persistence-http-endpoints` as `fix/v15-persistence-http-<short-desc>`
2. Make the fix as a focused, small commit
3. Run the full verification gate (`npm run typecheck` + `npm test` — expect green)
4. Push + open a PR targeting the branch the fix branched from (NOT main)
5. Reference the PR number(s) in the review comment on #171 ("Found issue X, proposed fix in #NNN")
6. Apply the standing-rules report block (branch / commit / files changed / tests run / what could break)
7. **Stop after the fix PR is open.** Do not chain further fixes; let Christian + Claude review the fix before continuing.

## Why this matters for the 30-day target

Persistence is the gating dependency for V1.5 release (30% of remaining work per the 2026-05-14 framing brief). If the stack lands with a fundamental flaw, every downstream layer (operator UI, /projects route, proposal generation, audit deep-link continuity) inherits it. The 4-deep stack was a deliberate choice to ship velocity over a single-PR safety review; this brief is the safety review.

---

## Fallback: Cursor SDK execution

If Codex is unavailable or returns ambiguous answers, dispatch this same brief to a Cursor SDK worker. **Cursor operates with full repo-write authority within the standing rules** (see the per-worker constraints section above) — it's not a read-only review, it's a full review-and-fix path.

Cursor's flow:

1. Read the standing rules preamble verbatim before starting
2. Execute Phases 1–4 as described
3. If Phase 4 finds **no code-level issues** → post the review comment on PR #171 (Phase 5 format) and stop
4. If Phase 4 finds **code-level issues**:
   - Branch from the appropriate base in the stack (see "For Cursor SDK fallback" rules above for the naming convention)
   - Make the focused fix in one commit
   - Run `npm run typecheck` and `npm test` — both must be green before pushing
   - Push the fix branch and open a PR targeting the parent stack branch (not main)
   - Reference the fix PR number(s) in the review comment on #171
   - Apply the standing-rules report block (branch / commit / files changed / tests run / what could break)
   - Stop. Do not chain further fixes; let Christian + Claude review the fix PR before continuing.

The "branch + small focused commit + PR back into the stack" pattern is what keeps Codex's review trail clean and lets Christian see exactly what changed vs. Claude's original proposal.

**Cursor's authority is bounded by the standing-rules hard limits**: no force-push, no `reset --hard`, no `clean -fd`, no `rm -rf`, no pre-merge branch deletion, no direct push to `main`, no direct push to any of the 4 review branches, no merging of any PR, no touching the design doc or the proposal PR #173.
