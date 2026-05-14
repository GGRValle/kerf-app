# V1.5 Persistence Layer — Design
## Single-tenant operational memory for the GGR/Valle internal release

- **Date prepared:** 2026-05-14
- **Repo state at draft:** `main@b3cb2d5` (post-PR #156)
- **Author:** Claude (Agent 8, integration lead)
- **Audience:** Christian, ChatGPT, Codex (review on May 16)
- **Status:** Design draft. **No code in this PR.** Captures the design choice + event vocabulary + open questions so Codex can review the shape before build starts.

---

## 1. Why this exists

The 2026-05-14 30-day brief locks the target as a **single-organization internal release for GGR/Valle**. That changes the persistence story from "demo state in sessionStorage" to "real artifacts on disk, lineage preserved, audit continuous." Without this layer, every other Week-1 priority builds on sand:

- Operator can't return Monday and see Friday's work
- Tier-2 project data ingestion has nowhere to land
- Actuals writeback (closed jobs → KB) has no source-of-truth
- Audit continuity assumed by §28.3 kill-switch evaluation requires persistence

This doc designs the layer. **Single-tenant. Deterministic. Local-first. Reuses existing primitives.** No new database engine, no auth, no multi-tenancy.

---

## 2. Non-negotiables (from the 30-day brief)

Mirrored here so the build can't drift:

- ✅ Deterministic core; LLMs at edges only
- ✅ All LLM output untrusted; schema/business-rule validation before side effects
- ✅ No autonomous pricing authority
- ✅ No autonomous money movement
- ✅ No external sends without approval
- ✅ `system_final_*` authoritative; `model_suggested_*` audit-only
- ✅ Money as integer cents
- ✅ Frontier model calls route through backend Model Router (deferred to Codex Week 3)
- ✅ Structured artifacts shared between agents (not giant prompts)
- ❌ NOT building: multi-tenancy, RLS, auth, Stripe, SOC 2, public signup, QBO writes

---

## 3. The data lifecycle this layer supports

Per the brief's loop framing:

```
capture  →  structure  →  scaffold  →  refine  →  approve  →  persist  →  retrieve  →  improve
   F-33       F-34         (#156)      (op-edit)   F-36       (this)      (next visit)  (KB feedback)
```

Each transition produces a **structured artifact** that must persist or the loop is broken at "retrieve" and "improve."

---

## 4. Design choice: JSONL event log on local disk

### Why JSONL
- Already exists as `createJsonlEventLog` in `src/blackboard/node.js` (used by `runner.cli.ts` for voice runs)
- Append-only by construction → matches the event-sourced architecture (`EventLog` interface, `src/blackboard/eventLog.ts:12`)
- Recoverable: grep-readable, tail-friendly, no schema migration when shape evolves
- No DB engine to operate, version, back up, or upgrade
- Survives `npm install` clean rebuilds

### Why local disk (not SQLite, not a hosted DB)
- 30-day brief is **single-tenant, single-operator**. Local disk is the right unit.
- The host environment is your laptop (and possibly a private deployed copy later). Local JSONL is portable.
- D-025 explicitly defers multi-tenancy + RLS to 2027. SQLite/Postgres setup invites scope drift toward "SaaS shape."
- A future migration from JSONL → SQLite/Postgres is straightforward IF the event log is the source of truth (because the read side projects from events).

### What's the file layout

```
.kerf/
  events.jsonl                  # global append-only event log (existing)
  projects/
    <tenant_id>/
      <project_id>/
        capture/
          <capture_id>.json     # raw transcript + photo refs
          <capture_id>.m4a      # optional audio blob
        scaffolds/
          <scaffold_id>.json    # kitchen scope scaffold output
        decisions/
          <packet_id>.json      # decision packet
        actuals/
          <writeback_id>.json   # closed-job actuals
        audit/
          <audit_id>.json       # individual audit entries (or events.jsonl scan)
  kb/
    seed/
      cost-kb-v0-6.json         # existing (#153)
    tenant/
      tenant_ggr_actuals.jsonl  # tier-2 project data uploads
      tenant_valle_actuals.jsonl
```

The `events.jsonl` at the root is the **append-only narrative**: every state transition emits an event. The per-project files are **read-side projections** for fast retrieval — they can be rebuilt from `events.jsonl` if ever lost.

### Why not the existing `createJsonlEventLog` for everything

It's good for the append-side narrative. But the operator UI wants fast random-access reads ("show me this project's scaffold"). Reading a 50,000-line events.jsonl to find one scaffold is wasteful. The per-project projection files solve that — they're a denormalized read-cache, rebuilt from events if corrupted.

---

## 5. Event vocabulary

New event types, layered on the existing `Event` type in `src/blackboard/types.ts:611`. **All carry a `tenant_id` field** (always `tenant_ggr` or `tenant_valle` in this phase) so the migration to multi-tenant in 2027 is a query-filter swap, not a schema rewrite.

| Event | Triggered by | Carries |
|---|---|---|
| `project.created` | Operator creates a new project | tenant_id, project_id, project_name, client_name, jurisdiction, archetype_hint |
| `capture.recorded` | F-33 voice record completes | capture_id, project_id, transcript text, audio_uri (kerf://), duration_ms, language |
| `transcript.reviewed` | F-34 clarification answers applied | capture_id, clarification answers map, source_quotes |
| `scaffold.generated` | Archetype detection + scaffold instantiation | scaffold_id, project_id, archetype, dimensions, materials, lines |
| `scaffold.refined` | Operator edits a scaffold line | scaffold_id, line_id, field, before, after, actor |
| `decision.drafted` | F-35 → F-36 decision proposed | packet_id, project_id, decision payload, blocked_reasons |
| `decision.approved` | Operator approves decision | packet_id, approver, approved_at |
| `actuals.recorded` | Operator marks a job's actual cost (closed loop) | writeback_id, project_id, line_id, actual_cents, sources, notes |
| `kb.ingested` | Operator uploads a tier-2 KB sheet | ingestion_id, tenant_id, row_count, source_file |
| `audit.read` | Existing read-audit (already wired) | actor, target, count |

Every event carries: `event_id`, `correlation_id` (project-level), `actor`, `at` (ISO8601), `source_refs[]` (lineage), `tenant_id`.

---

## 6. Read patterns

### Operator opens `/projects` (new route, Week 1+)
Reads `kb/tenant_<id>/` index → list projects with last-edit timestamps. Single JSON read per project. <50ms.

### Operator opens `/projects/<id>` (new route, Week 1+)
Reads the project's projection files (capture, scaffold, decision, audit). Each is a single JSON read. <100ms total.

### Operator records new capture for an existing project
1. Append `capture.recorded` to `events.jsonl` (atomic O_APPEND)
2. Write `projects/<tenant>/<project>/capture/<capture_id>.json` (atomic rename)
3. Update `projects/<tenant>/<project>/index.json` with last-capture pointer (atomic rename)

### Operator-actor view ("show me Tuesday's audit trail")
`grep -F '"correlation_id":"<project>"' .kerf/events.jsonl | jq ...` — recoverability from raw events guaranteed.

---

## 7. Server-side wiring (no client schema change)

The browser app continues to use sessionStorage for in-page state. Persistence happens through a new set of POST endpoints on the existing serve script:

```
POST /api/projects             → project.created
POST /api/projects/<id>/captures  → capture.recorded (called after F-33 transcribe)
POST /api/projects/<id>/scaffolds → scaffold.generated (called when scaffold renders)
POST /api/projects/<id>/refinements → scaffold.refined (per edit)
POST /api/projects/<id>/decisions → decision.drafted / decision.approved
POST /api/kb/ingestions        → kb.ingested (mirror of cost-KB seed loader)
GET  /api/projects             → list projection (read-only)
GET  /api/projects/<id>        → single-project projection (read-only)
GET  /api/projects/<id>/audit  → project audit timeline
```

Each endpoint:
- Validates payload against a TypeScript schema (deterministic; no LLM in the write path)
- Appends one event to `events.jsonl`
- Updates per-project projection files atomically
- Returns the canonical event/artifact

**No autonomous writes.** Operator action is the only trigger for every write. The system never persists on its own behalf without operator confirmation.

---

## 8. Audit continuity

The `ReadAuditLog` (`src/audit/readLog.ts:49`) already wraps `EventLog`. Persisted to JSONL as well. Audit continuity = the events.jsonl is the source of truth for what happened, when, by whom, with what sources cited.

This satisfies the §13 disclosure pattern + the kill-switch evaluation's "trust trail" requirement.

---

## 9. Recovery + portability

Single-tenant single-disk is fragile if the laptop dies. Mitigations:

- **Daily auto-rotate** `events.jsonl` → `events.YYYY-MM-DD.jsonl` and gzip-archive old logs
- **iCloud / Time Machine** the `.kerf/` directory (operator's responsibility; document in onboarding)
- **Export tool** writes a single zip of `.kerf/` for backup
- **Import tool** rebuilds projections from an events log if the projection dir is lost

These are post-Week-1 polish items but the design supports them.

---

## 10. What this design intentionally does NOT include

Per the 30-day brief:

- ❌ Multi-tenant isolation (single-tenant assumed; tenant_id field forward-compatible)
- ❌ Authentication / authorization (operator IS the user)
- ❌ Encryption at rest (laptop OS-level encryption is sufficient for this phase)
- ❌ Real-time multi-user sync (not in scope)
- ❌ Schema migrations (events are forward-compatible by convention; new fields = optional)
- ❌ Hosted DB integration (Postgres / Supabase / Firebase / etc.)
- ❌ Backend Model Router (Week 3, Codex-led)
- ❌ QBO export wiring (Week 2 invoice artifacts ARE in scope but only as in-system structures; export-to-QBO is deferred)

---

## 11. Open questions for Codex review (May 16)

These are the spots where a second opinion matters before build:

1. **Per-project projection files vs single events.jsonl** — Are we over-engineering by adding the projection cache? Or is the read-latency win worth the dual-write complexity? My read: worth it once event log grows past ~5MB.

2. **`scaffold.refined` event granularity** — One event per field edit, or one event per "apply" action? Per-field gives finer audit; per-apply is less noisy. Default: per-apply, with the apply payload listing every field that changed.

3. **`actuals.recorded` semantics for the KB feedback loop** — When a project closes, actual costs feed back into the KB as `PROJECT_ACTUAL` (`authority_rank` 1) rows. Is that automatic on close, or does the operator promote each line manually? Default: operator promotes (no autonomous KB write).

4. **Audio blob storage** — Do we keep `.m4a` files in `.kerf/projects/<id>/capture/`? Disk space gets real if the operator records 5–10 min daily. Default: keep for 30 days, then delete after a `capture.archived` event. Operator can opt to keep longer.

5. **Tenant context on the local-laptop case** — `tenant_id` is always `tenant_ggr` or `tenant_valle` for this phase. Hardcode in the UI's "active tenant" dropdown? Or just default to GGR and add a switch?

6. **Concurrent-write safety** — Two browser tabs open editing the same scaffold. JSONL append is atomic; projection file rename is atomic; but the read-modify-write of a projection has a race. Defaults: last-write-wins on projections (events.jsonl is the truth); add `etag` checks in Week 2 if it bites.

7. **Migration path to SQLite/Postgres** — Forward-compatible via events.jsonl as source of truth. But should the projection files use a schema with `version` fields so future schema changes don't break readers? Default: yes, `schema_version` on every projection file.

---

## 12. Build plan (Week 1, my track)

After Codex review (May 16):

**Step 1 — Event vocabulary in TypeScript** (~1 day)
- `src/persistence/events.ts` — typed events
- `src/persistence/types.ts` — projection shapes
- Tests for event validation

**Step 2 — JSONL event store wrapper** (~1 day)
- `src/persistence/eventStore.ts` — append + read + tail
- Reuses `createJsonlEventLog` underneath
- Tests for append + recovery

**Step 3 — Projection writers** (~1 day)
- `src/persistence/projections.ts` — atomic rename writes
- Tests for projection consistency with the event log

**Step 4 — HTTP endpoints in serve-v15** (~1 day)
- POST + GET routes wired through the existing serve script
- Schema validation per endpoint
- Tests for end-to-end write/read on a real `.kerf/` dir

**Step 5 — Browser-side persistence client** (~half-day)
- Thin fetch wrapper, idempotent retries
- Wired into F-33 (capture) and F-35 (scaffold) save points
- Tests via the existing transcribe-route pattern

**Step 6 — Operator UI: `/projects` list + `/projects/<id>` detail** (~1 day)
- New routes in router.ts + pages.ts
- Project list, single-project view, project history timeline

Total: ~5–6 days. Lines up with Week 1 closing on Sunday May 21.

---

## 13. What I'm explicitly NOT proposing tonight

- Tier-2 project data ingestion path (depends on event vocabulary; Week 2)
- Mobile-responsive layout work for the new `/projects` surface (Cursor parallel, Week 1)
- Actuals writeback UI (Week 2)
- Audit timeline rendering (Week 2)
- Backup/export tooling (Week 4 polish)

---

## 14. Decision needed

Two things I need from you (Christian) + Codex before build starts:

1. **Approve the event vocabulary + file layout shape.** If the JSONL + per-project-projection model is wrong, the rest of the design changes.
2. **Pick a default on the 7 open questions above** (or wait for Codex to weigh in on May 16).

If Codex review surfaces structural problems, I can pivot before Step 1 code lands. If the shape holds, Week 1 dispatches Monday on the schedule above.
