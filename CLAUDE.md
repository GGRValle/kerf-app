# CLAUDE.md — kerf-app/

**Project:** `@kerf/core` v0.0.1 — the operations layer for service businesses.
**Owner:** Christian Asdal · Get Green Remodeling, Inc. · Poway, CA
**You:** Claude Code (Anthropic), working in pair with OpenAI Codex on this repo.
**Companion file:** `kerf-app/CODEX.md` — Codex's project file. Read both. The two files agree on architecture; they differ only on per-agent role guidance.

> Read the global `~/.claude/CLAUDE.md` first. It is the cross-project source of truth. Everything in this file is project-scoped to `kerf-app/`.

---

## 1. What this repo is

`@kerf/core` is the foundation layer of Kerf — the operations layer for service businesses. It is **not** the Platform repo (which is separate and owns money writes, audit-of-record, and QBO sync). The boundary is enforced through versioned REST contracts in `src/contracts/platform/`.

**You own:** UI, Blackboard event log, projections, agents, permissions matrix, i18n, schema.
**Platform owns:** money writes, audit-of-record, QBO sync, IIF export, payment side effects.
**Boundary version:** `2026-04-23.0` (in `src/contracts/platform/types.ts`).

**Do not write code that crosses the boundary.** If a feature requires money writes or audit-of-record, the Kerf side stops at the contract call; the Platform side is a different repo.

---

## 2. Operating mode — pair with Codex

You and Codex work the same repo, alternating author and reviewer roles per feature. The canonical split is in `_docs/investor/Kerf_Master_Build_Capital_Direction_v2_1.docx` §11.2 (kept in `kerf-cos/`, not this repo).

**Multi-pass review protocol (locked Apr 26, 2026):**

1. **Pass 1 — Author.** Whoever is author for the feature writes the implementation + tests. Opens PR with description: *what / why / how / what could break*.
2. **Pass 2 — Reviewer.** The other agent reads the PR, runs CI locally, attempts to break the implementation (edge cases, malformed inputs, race conditions). Leaves PR comments. Approves or requests changes.
3. **Pass 3 — Author addresses.** Each comment either resolved with explanation or pushed back with reasoning. **No silent dismissals.**
4. **Pass 4 — Christian final.** Christian reads the diff, runs smoke test, validates against architecture principles. Merges or sends back.
5. **Pass 5 — Post-merge.** Both agents see the merged version. Either may flag follow-up issues as new tickets.

**When you author:** describe what could break. Make it easy for Codex to find the bugs you missed.

**When you review:** read the diff line by line. Run `npm run typecheck && npm run smoke` locally. Try to break it. Be specific in PR comments — line numbers, scenarios, expected vs actual.

**When you and Codex disagree:** post your reasoning, let Codex respond, and wait for Christian to arbitrate. The architecture principle that supports the decision becomes a precedent logged in this file or `CODEX.md`.

---

## 3. Architecture invariants — DO NOT VIOLATE

These come from `README.md`, the global `~/.claude/CLAUDE.md`, and existing code. Every PR must respect them.

### 3.1 Money is integer cents
- `Cents` is `number`, always integer
- All money math goes through `src/shared/money.ts` helpers (`dollars`, `applyMargin`, etc.)
- Display layer converts to dollars; storage layer never does
- **Never** introduce a float, a string-encoded amount, or a third-party math helper
- The `OWNER_MONEY_CEILING_CENTS = 200_000` ($2,000) constant in `permissions/matrix.ts` is canonical

### 3.2 Margin is permission-gated
- Only `owner` and `moo` roles can `view` the `margin` resource
- **Never** include margin in any client-facing render path
- **Never** show margin in proposals, change orders, signed documents, client-share portal, or any export the client touches
- Margin is internal backup only — connects to GGR/Valle/HPG estimating standards

### 3.3 Lifecycle states are sequential
- `draft` → `recommended` → `approved` → `locked`
- **Agents write only `draft`.** Promotion to `recommended` or `approved` is human action.
- **Only the Platform writes `locked`.** Locked is the audit-of-record state and crosses the repo boundary.

### 3.4 Events are append-only and frozen
- The Blackboard event log in `src/blackboard/eventLog.ts` enforces `Object.freeze` on append
- **Never mutate** an Event after append
- **Never** add a delete-event API — corrections are new events with `correlationId`

### 3.5 Every claim has a SourceRef
- Agent-authored events should carry at least one `SourceRef` in `sources?: SourceRef[]`
- **Source-or-silent.** No source, no claim. This is locked architecture principle #5.

### 3.6 i18n parity is enforced
- Every render-to-user string is an `I18nKey` (defined in `src/i18n/keys.ts`)
- Every key has both EN and ES values (`src/i18n/en.ts` and `src/i18n/es.ts`)
- **TypeScript will refuse to compile** if EN/ES drift — this is intentional
- User-entered data (decision titles, memory body, scope descriptions) is NOT i18n
- Spanish-native is a structural moat; do not bypass

### 3.7 Permission matrix is canonical
- `DEFAULT_MATRIX` in `src/permissions/matrix.ts` is the single source of truth for V1
- **Do not** add new resources or actions without updating the matrix and the consuming evaluator
- V1.5+ moves matrix into a Policy store; until then, the matrix file is the law

### 3.8 Two-repo boundary
- Kerf side: UI + Blackboard + agents + projections + permissions + i18n + cost KB
- Platform side: money writes + audit-of-record + QBO sync + IIF export
- Communication: REST contracts in `src/contracts/platform/types.ts` versioned at `2026-04-23.0`
- **Do not** add money-write code on the Kerf side. Call the Platform contract instead.

### 3.9 Contract version bumps follow the wire-vs-internal rule
- Bump `KERF_PLATFORM_CONTRACT_VERSION` only when `src/contracts/platform/*.ts` changes shape or Platform must consume new fields across the boundary
- Internal Blackboard schema changes (new event/entity kinds, new required fields like `data_class`/`retention_policy`, new enums) do NOT trigger a bump
- See `kerf-cos/.claude/memory/project_kerf_contract_versioning.md` for the locked rule

### 3.10 Consumer integration via per-consumer adapter modules
- Consumers (GGR Platform, future tenants) integrate via small adapter modules that bridge their data shapes to `@kerf/core`'s pure types
- Adapters do pure shape translation (type conversion, enum casing, identifier mapping, Blackboard event metadata construction) — never business logic, DB access, network I/O, or side effects
- See `kerf-cos/.claude/memory/project_kerf_platform_adapter_pattern.md` for the locked pattern

---

## 4. The 12 V1 schema additions (W0 — your shared work with Codex)

W0 (Apr 22 – 27, 2026) lands the schema additions before W1 starts. Cumulative cost: 5.5 days. Master doc §4.2 has the full table; the split below is from §11.2.

| # | Addition | Author | Reviewer |
|---|---|---|---|
| 1 | Authority profile | **You** | Codex |
| 2 | Decision altitude class (`L0`–`L4`) | Codex | **You** |
| 3 | Privilege class tag + LLM bypass | **You** | Codex |
| 4 | Read audit log | Codex | **You** |
| 5 | i18n verification (already in code) | n/a | n/a |
| 6 | Tenant key wrapper | **You** | Codex |
| 7 | Client-share entity kinds (`mood_board`, `client_share`, `design_revision`, `client_decision`) | Codex | **You** |
| 8 | Compliance KB stub | Codex | **You** |
| 9 | User-privacy data class + retention policy | **You** | Codex |
| 10 | Automation guardrails (`automation`, `automation_run`, `guardrail_trip`) | Codex | **You** |
| 11 | Usage tier subscription (`tenant_subscription`, `usage_event`) | Codex | **You** |
| 12 | Cost KB entry kind (`cost_kb_entry`, `cost_override`) | **You** | Codex |

**Status as of 2026-04-27:** Codex shipped Increment 1 (commit `346aeee`) which partially covered #1 (DecisionAuthority type), #9 (data_class + retention_policy on events, fully done), #10 (ActionClass enum partial; full guardrails entity/event kinds still pending), and added `WorkflowKind` + invoice-follow-up entity/event/payload types (NOT in the original 12-list). Increment 2 (commit `891f2d2`) shipped the pure invoice-follow-up workflow module — that's W1 work that the master doc §11.2 assigned to **you** but Codex took. Accepted deviation. Going forward, the alternation should re-balance toward your authorship.

---

## 5. PR quality gates

Every PR you author or review must satisfy:

- ✅ `npm run typecheck` passes — strict TS, `noUncheckedIndexedAccess`
- ✅ `npm run smoke` runs deterministically (same inputs, same outputs)
- ✅ Unit tests added for new code paths (use `node --import tsx --test tests/*.test.ts`)
- ✅ No new `any` types without an inline `// reason: ...` comment
- ✅ No new dependencies without justification in PR description
- ✅ All architecture invariants in §3 respected
- ✅ EN/ES i18n parity preserved if adding render-to-user strings
- ✅ PR description explains: *what / why / how / what could break*
- ✅ Token-economy: a single PR should be ≤ ~600 LOC of changes, splittable if larger
- ✅ Performance budget per call site honored: Right Hand <3s, drafting <8s, drift <30s
- ✅ Strict-Node-ESM compliance: barrel re-exports use explicit `.js` extensions (tsconfig is `NodeNext`)
- ✅ `prepare` hook builds dist/ at install time for git-dep consumers — do not break

---

## 6. Hard prohibitions

These are absolute. No agent, including you, has discretion to override.

- **Never** show margin in any client-facing render path
- **Never** use "headless agentic" or "agentic OS" in customer-facing copy (build comments, internal docs OK; UI / proposals / website / pitch deck NOT OK)
- **Never** introduce a float for money
- **Never** mutate an Event after append
- **Never** write a `locked` lifecycle transition on the Kerf side (Platform only)
- **Never** add an API call that bypasses `permissions/matrix.ts`
- **Never** write user-entered data through the i18n layer
- **Never** post, send, or commit anything externally (PRs are internal — that's fine; sending email, Slack messages, or posting to public surfaces is not your role)
- **Never** invent a number, citation, code reference, or fact — source-or-silent applies to your code comments and PR descriptions too
- **Never** spell Christian's last name anything other than **Asdal**

---

## 7. When you're stuck or uncertain

In priority order:

1. **Check this file** — most architecture questions are answered above
2. **Check `kerf-app/CODEX.md`** — Codex's project file; same architecture rules
3. **Check `~/.claude/CLAUDE.md`** — global file, single source of truth across projects
4. **Check the master doc** — `_docs/investor/Kerf_Master_Build_Capital_Direction_v2_1.docx` (in `kerf-cos/`) for strategic context, schema commitments, and the parallel-build protocol
5. **Check the Build Pivot Spec** — `_docs/product/Kerf_Build_Pivot_Spec_Apr23.md`
6. **Check `kerf-cos/.claude/memory/`** — locked decisions and architectural precedents
7. **Open a PR with `[QUESTION]` prefix** — flag the uncertainty in the description, propose two paths, let Codex or Christian decide
8. **Do not guess.** Source-or-silent. If the answer isn't in writing, surface the question.

---

## 8. What Christian expects from you

- **Brief, execution-oriented PR descriptions.** Lead with what the change does. Mobile-readable.
- **No throat-clearing in commit messages.** "Add altitude field to Event payload" not "I am pleased to introduce..."
- **Curses sparingly or never.** Match the room.
- **Steelman opposing approaches when reviewing** — read for "how would I write this differently" not "how do I rubber-stamp this"
- **Surface assumptions.** When you have to guess, say so explicitly: *"Assumption: X. Wrong if Y. Will revisit if reviewer flags."*
- **Don't drift.** If a PR scope expands beyond the original task, split it.
- **Source-or-silent on every material claim.** If you can't cite it, don't write it.

---

## 9. Project state (Apr 27, 2026)

- W0 prerequisites: git init complete, GitHub remote `GGRValle/kerf-app` (private, `main`) established 2026-04-26
- Increment 1 landed (commit `346aeee`): partial coverage of schema additions #1, #9, #10 + invoice-follow-up types
- Strict-ESM fix landed (commit `5cd706d`): tsconfig now `NodeNext`, `.js` extensions explicit
- Increment 2 landed (commit `891f2d2`): pure invoice-follow-up workflow module (`src/workflows/invoice-followup.ts`) — 7 public exports
- GGR Platform consuming `@kerf/core` from `main` via `github:GGRValle/kerf-app#main` ([PR #1](https://github.com/GGRValle/ggr-platform/pull/1) open with the integration)
- W0 schema completions still owed: #2, #3, #4, #6, #7, #8, #11, #12 (plus completion of #1 authority profile and #10 guardrails entity/event kinds)
- W1 (invoice follow-up) effectively shipped early via Increments 1-3; per master doc §5.2, W1 was scheduled Apr 28 – May 4
- Kill-switch: Mon Jul 13, 2026 — four criteria all true (master doc §5.4)
- Two-repo boundary live; you are on the Kerf side only

---

## 10. Updates to this file

- **Apr 27, 2026** — Initial commit. Mirrors `kerf-app/CODEX.md` on architecture; differs only in §2 and §8 to address Claude Code as the agent. Adds §3.9 (contract versioning rule) and §3.10 (adapter pattern) to reflect locked decisions made during the GGR Platform integration.
- This file evolves as architecture precedents accrue. Add a dated entry below when a new precedent is locked (e.g., "Apr 30 — pattern X chosen over pattern Y because Z").
