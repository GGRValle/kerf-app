# @kerf/core — W1

Kerf's foundation layer. W1 sprint (Apr 28 → May 4, 2026).

Strict, typed, boring. No UI.

## Structure

```
src/
├── blackboard/        # Layer A event log (in-memory W1, durable W3)
├── permissions/       # Matrix + pure evaluator
├── projections/       # Read models: decisions, systemState, liveMemory, graph
├── workflows/         # Pure workflow logic; no integrations or side effects
├── contracts/
│   └── platform/      # Kerf ↔ Platform boundary — versioned types + stub client
├── shared/            # ids, time, money, errors (no module rolls its own)
├── i18n/              # keys, en, es — Spanish first-class from day one
├── tenant/            # tenant key wrap/unwrap boundary (V1 stub, V2.0α KMS)
├── test-fixtures/     # seedActors, seedProjects, seedEvents (deterministic)
└── examples/
    └── smoke.ts       # wire-up demo — `npm run smoke`
```

## Modules

| Module | Status | Notes |
|---|---|---|
| `blackboard` | V1 | Layer A, append-only, `Object.freeze`d on write. |
| `permissions` | V1 | Default matrix. Margin withheld from PM/field/sub/client. |
| `projections/decisions` | V1 | Filter + rank (impact × urgency × max(0.1, staleness)). |
| `projections/systemState` | V1 | Green/amber/red tiles. Label is an `I18nKey`. |
| `projections/liveMemory` | V1 flat | `groupByCausality` stubbed for V1.5. |
| `projections/graph` | V1 shape | Explicit relation edges only. Causal inference V1.5. |
| `workflows/invoice-followup` | V1 pure | Candidate → draft → approval request → approval action; no Slack/Gmail/DB. |
| `contracts/platform` | V1 stub | Real types, stub client. Versioned: `2026-04-23.0`. |
| `shared` | V1 | `createIdFactory`, `fixedClock`, `dollars`, `applyMargin`, error hierarchy. |
| `i18n` | V1 | EN + ES entries for every key. Typecheck enforces parity. |
| `tenant/keys` | V1 stub | `wrap` / `unwrap` boundary for operator-private writes. Stub preserves plaintext; real KMS wrapper lands V2.0α as a single-file swap. |
| `test-fixtures` | V1 | Deterministic seed (`seedWorld`) — same inputs = same outputs. |

## Invariants

- Money is `Cents` (integer). Helpers in `shared/money.ts` are the only blessed math.
- Every render-to-user string is an `I18nKey`. User-entered data (decision titles, memory body) is NOT i18n.
- Events are `Object.freeze`d on append. Append-only enforced at runtime.
- Every event declares `data_class`, `retention_policy`, and `privilege_class` (`null` for non-privileged).
- Privileged events (non-null `privilege_class`) MUST bypass the LLM gateway. Consumer LLM gateways are responsible for filtering — call `isPrivilegedEvent(event)` before any model send. This is the architectural "privileged-class bypass" layer of vendor protection, not policy.
- `OWNER_MONEY_CEILING_CENTS = 200_000` ($2,000) lives in `permissions/matrix.ts`.
- Margin is a first-class permission resource — only owner + MoO can view.
- Platform contract versioned: `KERF_PLATFORM_CONTRACT_VERSION`. Bump only when `src/contracts/platform/*` wire shapes change. Internal Blackboard schema changes (new event/entity kinds, new required metadata fields) do NOT trigger a bump — see `kerf-cos/.claude/memory/project_kerf_contract_versioning.md`.

## Boundary (parallel build)

Kerf owns: UI + Blackboard + agents.
Platform owns: money writes, audit-of-record, QBO sync.

Kerf → Platform over REST (types in `src/contracts/platform/types.ts`).
Platform → Kerf via webhooks (`PlatformWebhook` in same file).

The authoritative copy of the contract lives in a shared Google Drive folder (TBD path). This repo imports from that file; the Platform repo imports from that file. Neither side edits its own copy independently.

## Commands

```bash
npm install         # installs typescript + tsx + @types/node
npm run typecheck   # strict TS, noUncheckedIndexedAccess
npm run smoke       # runs examples/smoke.ts — deterministic output
```

## Lifecycle (Architecture Principle #2)

`draft` → `recommended` → `approved` → `locked`

Agent-authored content enters at `draft`. Human review → `recommended`. Approval → `approved`. Only the Platform writes `locked`.

## Next (W2)

- `BlackboardProvider` + `PermissionProvider` React contexts.
- Operating Surface Layers 1 + 2 + 4 (Decision, System State, Quick Actions).
- Translator wired to context so UI never reaches for a raw string.

See `Kerf_Build_Pivot_Spec_Apr23.md` for the full spec.
