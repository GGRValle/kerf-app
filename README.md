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
├── altitude/          # AltitudePacket, DecisionPacket, Policy Gate result types
├── audit/             # read-audit log primitives (in-memory V1)
├── authority/         # per-role × per-tenant authority profile + canAuthorize
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
| `blackboard/compliance-kb` | V1 schema | `compliance_kb_entry` + `compliance_event`; V1.5+ Sentry/Watch runtime, V2.0α active gating. |
| `workflows/invoice-followup` | V1 pure + gate-wired | Candidate → draft → AltitudePacket → Policy Gate → DecisionPacket → approval action; no Slack/Gmail/DB. |
| `workflows/proposal-followup` | W2 pure + gate-wired | Candidate → draft → AltitudePacket → Policy Gate → DecisionPacket → approval action; no Platform network writes. |
| `workflows/drift-detection` | W3 pure + gate-wired | LLM candidate → drift alert → AltitudePacket → Policy Gate → DecisionPacket; internal-only, no external send. |
| `altitude` | W1 skeleton + safety + audit-trail validators | AltitudePacket → DecisionPacket core types plus Policy Gate shell with V1/V2/V6 send-safety, V7 source-basis, V8 inference-labeling, V12 audit-trail, V17 token-budget, and V18 altitude-assignment first cuts. |
| `audit/readLog` | V1 | In-memory read audit log + EventLog read wrapper; durable store lands later. |
| `authority/profile` | V1 | Per-role × per-tenant authority bands + dollar ceilings + escalation chain. `canAuthorize()` is pure. Per-tenant overlays land V1.5+. |
| `contracts/platform` | V1 stub | Real types, stub client. Versioned: `2026-04-23.0`. |
| `shared` | V1 | `createIdFactory`, `fixedClock`, `dollars`, `applyMargin`, error hierarchy. |
| `i18n` | V1 | EN + ES entries for every key. Typecheck enforces parity. |
| `tenant/keys` | V1 stub | `wrap` / `unwrap` boundary for operator-private writes. Stub preserves plaintext; real KMS wrapper lands V2.0α as a single-file swap. |
| `test-fixtures` | V1 | Deterministic seed (`seedWorld`) — same inputs = same outputs. |

## Invariants

- Money is `Cents` (integer). Helpers in `shared/money.ts` are the only blessed math.
- Every render-to-user string is an `I18nKey`. User-entered data (decision titles, memory body) is NOT i18n.
- Events are `Object.freeze`d on append. Append-only enforced at runtime.
- Blackboard reads that go through `withReadAudit` record actor, role, timestamp, target, and result count without copying event payloads.
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

## UI DecisionPacket Fixtures

Track C can build pure UI components against generated DecisionPacket data while workflow integrations land:

```tsx
import {
  driftDecisionPacketFixture,
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from './src/test-fixtures/index.js';

<DecisionCard
  packet={invoiceDecisionPacketFixture}
  onApprove={(packetId) => console.log(packetId)}
  onReject={(packetId) => console.log(packetId)}
  onEdit={(packetId) => console.log(packetId)}
/>

<DecisionCard
  packet={proposalDecisionPacketFixture}
  onApprove={(packetId) => console.log(packetId)}
  onReject={(packetId) => console.log(packetId)}
  onEdit={(packetId) => console.log(packetId)}
/>

<DecisionCard
  packet={driftDecisionPacketFixture}
  onApprove={(packetId) => console.log(packetId)}
  onReject={(packetId) => console.log(packetId)}
  onEdit={(packetId) => console.log(packetId)}
/>
```

The invoice, proposal, and drift fixtures are generated from typed `AltitudePacket`s through `runPolicyGate` with a fixed clock/options. `mixedDecisionPacketListFixture` combines all three workflows for queue demos, including model-inference review scenarios so V8 correction renders across workflow types. Do not copy their shape into UI-local types; consume `DecisionPacket` from `src/altitude/types.ts`.

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
