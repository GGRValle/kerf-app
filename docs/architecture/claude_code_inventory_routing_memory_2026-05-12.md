# Claude Code — §11.1 Primitives Inventory
**Routing, Memory, and Field Daily — read-only repo inspection**

- **Date prepared:** 2026-05-12
- **Repo:** `github.com/GGRValle/kerf-app`
- **Inspected at:** `main` HEAD `411d50c`
- **Scope:** §11.1 *Existing primitives* only — factual inventory.
- **Explicitly out of scope this artifact:** §11.2 (gaps), §11.3 (schema additions), §11.4 (Daily Log canon), §11.5 (roadmap fit), §11.6 (dogfood). Per slice-window discipline (2026-05-08 to ~2026-05-18), those sections land ≥ May 18.
- **Authoring constraints applied:** no recommendations, no "should be" language, no proposed schemas, no analysis prose. Each row reports what the code actually says.

---

## Carve-out flag — slice F-33 → F-37 blockers

**None found.** No missing primitive in routing or memory inspection blocks the current F-33 → F-37 slice. Slice spine is healthy on `main`: 631/631 tests, all 13 V1.5 routes HTTP-green, deep-link asset paths fix landed (#142), generated fixture convergence spine (`verticalSliceFieldCaptureDemoFixture` → `VERTICAL_SLICE_FLOW_PACKET_ID`) is wired across F-33/F-34/F-35/F-36/F-37.

If a blocker surfaces during later inspection of related code, it will be appended here as an explicit row, not embedded in body sections.

---

## Inventory rows

### 1. AltitudePacket

- **File:** `src/altitude/types.ts:372–396`
- **Symbol:** `interface AltitudePacket` (export)
- **Purpose:** Model-produced untrusted packet carrying classification, extracted facts, proposed action, money fields, compliance flags, model-suggested altitude/rail, source refs, and token usage — input to the Policy Gate before any side effect.
- **Neighbors:** `DecisionPacket` (line 398, policy-gated immutable sibling that adds `system_final_*` fields), `PolicyGateResult` (line 354), `AltitudeTokenUsage` (line 312).
- **Note — `context_pack` field:** **NOT_FOUND_IN_MAIN.** No field named `context_pack`, `contextPack`, `ContextPack`, or `context_window` on `AltitudePacket` or anywhere in `src/altitude/`, `src/blackboard/`, or `src/workflows/`. The §7 `KerfContextPack` shape described in the brief is canon-only.

### 2. SourceRef (core)

- **File:** `src/blackboard/types.ts:162–166`
- **Symbol:** `interface SourceRef` (export)
- **Purpose:** Trust signal carried by every agent-authored event — `kind` (`voice` | `photo` | `transcript` | `doc` | `external`), optional `uri`, optional `excerpt`.
- **Neighbors:** `Event` (carries `sources` field), `CostKbEntryPayload.sources` (non-empty tuple enforcement at type level), `AltitudePacket.source_refs` (`src/altitude/types.ts:389`).

### 3. VerticalSliceSourceRef (UI variant)

- **File:** `src/demo/types.ts:36`
- **Symbol:** `interface VerticalSliceSourceRef` (export)
- **Purpose:** UI-projection variant of `SourceRef` extended with `id`, `type`, `label`, `timestamp`, optional `confidence` (0–1) and `excerpt` — used for V1.5 vertical-slice screens.
- **Neighbors:** core `SourceRef` (`src/blackboard/types.ts:162`), `VerticalSliceAuditEvent.source_ref_ids` (`src/demo/types.ts:180`), `BlackboardWritePreview.source_refs` (line 209).

### 4. Blackboard rails

- **File:** `src/altitude/types.ts:49–56`
- **Symbol:** `const BLACKBOARD_RAILS = ['movement', 'whos_where', 'pinned', 'changed', 'holding'] as const` and `type BlackboardRail`
- **Purpose:** The five rails of the Blackboard, exported from the Altitude routing module (in-file comment notes the Blackboard module may grow its own runtime rail API later).
- **Neighbors:** `AltitudePacket.model_suggested_blackboard_rail` (line 382), `DecisionPacket.system_final_blackboard_rail` (line 412), `BlackboardWritePreview.rail` (`src/demo/types.ts:202`).

### 5. EventLog (append-only Blackboard substrate)

- **File:** `src/blackboard/eventLog.ts:12–19`
- **Symbol:** `interface EventLog` (export) + `createMemoryEventLog()` factory (line 21)
- **Purpose:** Append-only event store with `append`, `byId`, `byEntity`, `byCorrelation`, `all`, `subscribe` — in-memory implementation for W1 with the interface as the stable contract for a durable swap later.
- **Neighbors:** `Event` (`src/blackboard/types.ts:611`), `EventLogQuery` (line 6), `withReadAudit` wrapper (`src/audit/readLog.ts:88`).

### 6. ReadAuditLog (Blackboard read audit)

- **File:** `src/audit/readLog.ts:49`
- **Symbol:** `interface ReadAuditLog` (export) + `createMemoryReadAuditLog()` (line 60), `withReadAudit` wrapper (line 88)
- **Purpose:** Records Blackboard read operations (`by_id`, `by_entity`, `by_correlation`, `all`) with actor, target kind/id, and result count for legal-defensibility audit trail — a separate concern layer from the append-side EventLog.
- **Neighbors:** `ReadAuditEntry` (line 22), `ReadAuditTarget` (line 17), `EventLog` (`src/blackboard/eventLog.ts:12`).

### 7. ValidatorResult

- **File:** `src/altitude/types.ts:325`
- **Symbol:** `interface ValidatorResult` (export)
- **Purpose:** Outcome of one validator run — `validator_id`, `passed`, `critical`, optional `field_correction`, optional `reason`, `duration_ms`.
- **Neighbors:** `PolicyGateResult.validator_results` (line 354), `VALIDATOR_IDS` const (line 198), `runV17TokenBudgetCheck` (`src/altitude/gate.ts:524`).

### 8. PolicyGateResult

- **File:** `src/altitude/types.ts:354`
- **Symbol:** `interface PolicyGateResult` (export)
- **Purpose:** Policy gate evaluation outcome — `allowed`, `blocked_reasons`, `required_human_approval`, `safe_next_action`, `validator_results[]`, `learning_signal_drafts`, `source_model`, `gate_version`, timing.
- **Neighbors:** `DecisionPacket.policy_gate_result` (line 433), `runPolicyGate` orchestrator (`src/altitude/gate.ts`), `POLICY_GATE_VERSION = 'v0.3.0'` (gate.ts).

### 9. V17 token-budget validator

- **File:** `src/altitude/gate.ts:524`
- **Symbol:** `function runV17TokenBudgetCheck(packet, options): ValidatorResult` (export)
- **Purpose:** Validates `max(estimated_total, actual_total)` tokens against `options.perActionTokenCap` (critical fail = block) and a `lowAltitudeCompactPromptThreshold` for `L0`/`L1` packets (non-critical fail = compact prompt required).
- **Neighbors:** `AltitudeTokenUsage` (`src/altitude/types.ts:312`: `estimated_input_tokens`, `estimated_output_tokens`, `input_tokens`, `output_tokens`), `interface TokenBudgetOptions` (`gate.ts:101`), `PolicyGateOptions.tokenBudget` (gate.ts:110), `field-capture` workflow option `token_budget` (`src/workflows/field-capture.ts:162, 339`), blocked-reason marker `'block_token_budget'` (gate.ts:868).
- **Note:** V17 runs **as a policy gate validator over `AltitudePacket.token_usage`** — i.e. it gates a packet that already records usage. There is no separate pre-call preflight function gating a model invocation before tokens are estimated.

### 10. AT-019 token-budget surface

- **File:** **NOT_FOUND_IN_MAIN.**
- **Symbol:** No symbol matching `AT-019`, `AT_019`, `ATO19`, or similar appears in `src/` TypeScript.
- **Note:** §6 of the brief names "V17 / AT-019" together as the token-budget preflight contract. V17 exists in code (above); AT-019 as a named code surface does not.

### 11. Provider abstraction — hosting route registry

- **File:** `src/hosting/routeCheck.ts:1–115` (full module)
- **Symbol:** `const APPROVED_HOSTING_ENDPOINTS` (line 30), `interface ApprovedHostingEndpoint` (line 20), `function checkHostingRoute()` (line 99), `interface HostingRouteCheckRequest` (line 68), `interface HostingRouteCheckResult` (line 78); approval-tier enum `HOSTING_ROUTE_TIERS = ['cheap_fast', 'frontier']` (line 6).
- **Purpose:** D-023-anchored allow-list of approved (provider × model × endpoint × tier) triples that every model call must pass through; rejects unknown endpoints (`endpoint_not_approved`), retired endpoints (`endpoint_not_active`), source-model mismatches (`source_model_mismatch`), and malformed requests.
- **Neighbors:** call sites `src/altitude/modelAdapter/groqClient.ts`, `src/voice/runtime/whisperClient.ts`, `src/estimator/orchestration/groqModelCaller.ts`; test file `tests/hosting-route-check.test.ts`.
- **Approved endpoints today:** `groq://llama-70b` (D-023 `cheap_fast`), `groq://llama-4-scout` (D-023 `cheap_fast`), `groq://whisper-large-v3-turbo` (D-023 `cheap_fast`).

### 12. Model adapter — Groq chat client

- **File:** `src/altitude/modelAdapter/groqClient.ts:45 (request), 63/87/98 (result union), 104 (deps), 135 (function)`
- **Symbol:** `interface GroqChatRequest`, `interface GroqChatSuccess`, `interface GroqChatFailure`, `type GroqChatResult`, `interface GroqClientDeps`, `function groqChat()`, `function defaultGroqClientDeps()` (all exported)
- **Purpose:** OpenAI-compatible Groq chat completion wrapper that routes through `checkHostingRoute` before issuing a `fetch` to the provider; dependency-injected `fetch`, `now`, `apiKey`, `baseUrl`, and pricing.
- **Neighbors:** `checkHostingRoute` (`src/hosting/routeCheck.ts:99`), call sites in `src/estimator/orchestration/groqModelCaller.ts`, `src/runner/estimateRunner.ts`.

### 13. Model adapter — Groq Whisper voice transcription

- **File:** `src/voice/runtime/whisperClient.ts:33, 48, ~130`
- **Symbol:** `const whisperCostNanoUsd` (line 33), `interface WhisperTranscribeRequest` (line 48), `function transcribeAudio()` (~line 130, JSON-only response).
- **Purpose:** Routes Groq Whisper-large-v3-turbo transcription calls through `checkHostingRoute`; nano-USD/ms pricing model `GROQ_WHISPER_TURBO_NANO_USD_PER_HOUR` (line 31); DI-friendly for hermetic tests.
- **Neighbors:** `checkHostingRoute`, CLI entry `src/voice/runtime/voice.cli.ts`.

### 14. ModelRouter / ModelInvocationPlan / ModelInvocationDecision / EscalationReasonCode

- **File:** **NOT_FOUND_IN_MAIN.**
- **Symbol:** No symbol matching `ModelRouter`, `model_router`, `ModelInvocation`, `ModelInvocationPlan`, `ModelInvocationDecision`, `EscalationReason`, `escalation_reason`, `selected_provider`, `selected_model`, or `provider_preference` appears in `src/` TypeScript.
- **Note:** §6 of the brief proposes these as the Model Router contract surface. The contract is canon-only; no embodiment in code. The closest existing surfaces are `checkHostingRoute` (route-allow-list, §11 above) plus the per-adapter clients (`groqChat`, `transcribeAudio`).

### 15. Cost KB entries

- **File:** `src/blackboard/types.ts:388 (CostKbEntryPayload), 403 (CostOverridePayload)`; region/trade enums at lines 370 and 379
- **Symbol:** `interface CostKbEntryPayload` (export), `interface CostOverridePayload` (export), `type CostKbRegion`, `type CostKbTrade`
- **Purpose:** Curated cost knowledge-base entry — `region × trade × lineItem` → `unitCostCents` + `last_verified_at`; sources non-empty tuple enforced at type level (source-or-silent). `CostOverridePayload` records tenant override per-estimate ("tenant always wins on pricing").
- **Neighbors:** `EntityKind` includes `'cost_kb_entry'` (`src/blackboard/types.ts:88`); no separate `src/costkb/` module — Cost KB lives as types in the blackboard namespace.
- **Note — variants from the brief:** `material_cost_entry`, `labor_rate_entry`, `subcontractor_quote_entry`, `vendor_price_entry`, `historical_scope_comparable`, `tenant_override`, `regional_adjustment` are named in §7 of the brief but **NOT_FOUND_IN_MAIN** as distinct types. `CostKbEntryPayload` (single shape) and `CostOverridePayload` are what exists today.

### 16. Transcript canon types (three-part)

- **File:** `src/demo/types.ts:72–76`
- **Symbol:** `interface TranscriptModel` (export)
- **Purpose:** Three-part schema — `transcript_original: readonly TranscriptSegment[]` (immutable Apple-verbatim), `transcript_edits: readonly TranscriptEditEvent[]` (operator overlay events), `transcript_current: readonly TranscriptSegment[]` (rendered working copy; comment notes in production this is derived, in mocks it may be materialized).
- **Neighbors:** `TranscriptSegment` (line 47), `TranscriptEditEvent` (line 58), `FieldCaptureDemoPayload` embeds `TranscriptModel` (~line 193), F-34 transcript review (`src/examples/v15-vertical-slice/f34-transcript-review-html.ts`).

### 17. `system_final_*` vs `model_suggested_*` separation

- **Definition site:** `src/altitude/types.ts` lines 381–382 (`model_suggested_altitude`, `model_suggested_blackboard_rail` on `AltitudePacket`) and lines 411–412 (`system_final_altitude`, `system_final_blackboard_rail` on `DecisionPacket`).
- **Enforcement site (gate):** `src/altitude/gate.ts` — V18 altitude-assignment validator promotes/demotes and assigns the `system_final_*` fields; the model suggestion is preserved on the packet but is not authoritative for routing.
- **Files referencing the distinction (`rg -l "model_suggested_|system_final_" --type ts`):** `src/altitude/types.ts`, `src/altitude/gate.ts`, `src/test-fixtures/decisionPackets.ts`, `src/ui/components/DecisionCard.ts`, `src/ui/components/DecisionCardView.ts`, `src/runner/estimateRunner.ts`, `src/runner/cliFormat.ts`, `src/runner/runner.cli.ts`, `src/voice/runtime/voice.cli.ts`, `src/examples/w1-decision-queue-demo.ts`, `src/decisions/operatorActions.ts`, `src/demo/verticalSliceDryRunMapper.ts`, `src/demo/types.ts`, `src/demo/verticalSliceMockData.ts`, `src/examples/v15-vertical-slice/f36-decision-card-html.ts`.
- **Purpose (per code + adjacent comments):** Two-track residue rule — `model_suggested_*` is audit/debug-only (untrusted model opinion preserved for the audit trail); `system_final_*` is authoritative for routing, blackboard placement, and external-send decisions.

### 18. Generated fixture spine — `VERTICAL_SLICE_FLOW_PACKET_ID`

- **File:** `src/demo/verticalSliceFlowIds.ts:11`
- **Symbol:** `export const VERTICAL_SLICE_FLOW_PACKET_ID = proposalDecisionPacketFixture.packet_id;`
- **Purpose:** Single `DecisionPacket.packet_id` shared by all V1.5 vertical-slice surfaces so F-33→F-37 (`/decisions/<id>`, `/audit/<id>`, F-34 transcript, F-35 draft) stay coherent on the same spine packet.
- **Neighbors:** `VERTICAL_SLICE_FLOW_ALT_PACKET_ID` (invoice contrast, line 17), `proposalDecisionPacketFixture` (`src/test-fixtures/decisionPackets.ts`).

### 19. Generated fixture spine — `VerticalSliceDryRunDemoFixture` type

- **File:** `src/demo/types.ts:252`
- **Symbol:** `interface VerticalSliceDryRunDemoFixture` (export)
- **Purpose:** Single generated-handoff object combining `field_capture_input`, `transcript_review_payload`, `draft_review_payload_ui`, `altitude_packet`, `policy_gate_result`, `decision_packet`, `audit_timeline`, `blackboard_write_preview`, and `source_refs` for the F-33→F-37 demo spine.
- **Neighbors:** `verticalSliceFieldCaptureDemoFixture` instance (`src/demo/verticalSliceMockData.ts:137`), `fieldCaptureDryRunToVerticalSliceDemoFixture` mapper (`src/demo/verticalSliceDryRunMapper.ts:53`), F-34 HTML (`src/examples/v15-vertical-slice/f34-transcript-review-html.ts`).
- **Note:** Inline comment on the type (~line 225) warns against forking parallel mock trees for the same spine id; V1.5 slices reference this single object per altitude-engine boundary.

### 20. Generated fixture spine — `verticalSliceFieldCaptureDemoFixture` instance

- **File:** `src/demo/verticalSliceMockData.ts:137`
- **Symbol:** `export const verticalSliceFieldCaptureDemoFixture: VerticalSliceDryRunDemoFixture`
- **Purpose:** Canonical fixture instance consumed by F-33 field capture, F-34 transcript review, F-35 `/draft-review` (via `f35FixtureFromVerticalSliceDryRun`), F-36 decision card, and F-37 audit view.
- **Neighbors:** `createVerticalSliceFieldCaptureDemoFixture` factory (same file, ~line 125), `f35FixtureFromVerticalSliceDryRun` adapter (`src/examples/f35-draft-review.ts`).

### 21. BlackboardWritePreview

- **File:** `src/demo/types.ts:202`
- **Symbol:** `interface BlackboardWritePreview` (export)
- **Purpose:** Rail-card preview for the audit stream — `mode`, `rail`, `summary`, `proposed_markdown`, `affected_entity_ids`, `source_refs`; `mode='preview_only' + persistence_performed=false` mark the projection as non-persistent.
- **Neighbors:** `VerticalSliceDryRunDemoFixture.blackboard_write_preview` (line 268), `auditEventPreviewToBlackboardWritePreview` mapper (`src/demo/verticalSliceDryRunMapper.ts:193`), F-37 audit render (`src/examples/audit-f37/f37-audit-view-html.ts:453`).

---

## Presence flags

These are *not* primitives; the directive asks for noted presence without diagnosis.

### Flag A — Direct external service calls from product code

Two `fetch` call sites exist in product code (excluding tests/scripts/smoke):

1. **`src/altitude/modelAdapter/groqClient.ts:176`** — `groqChat()` Groq REST API call. DI-injected `fetch`; every call is preceded by `checkHostingRoute` (`src/hosting/routeCheck.ts:99`) per D-023.
2. **`src/voice/runtime/whisperClient.ts:181`** — `transcribeAudio()` Groq Whisper REST API call. DI-injected `fetch`; same hosting-registry gating.

No `axios` / `XMLHttpRequest` / `http.request` / `navigator.send*` matches in product source.

### Flag B — Provider API key reads from environment

Four `*_API_KEY` reads exist, all at CLI/example boundary entry points:

1. `src/runner/runner.cli.ts:94` — `GROQ_API_KEY` via `readEnv()`.
2. `src/examples/groq-tier1-smoke.ts:332` — `GROQ_API_KEY` via `readEnv()`.
3. `src/voice/runtime/voice.cli.ts:92` — `GROQ_API_KEY` via `readEnv()`.
4. `src/examples/estimator-live-sample.ts:36` — `GROQ_API_KEY` via `readEnv()`.

No `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` reads in product source. No core library reads `process.env.*` directly for keys; CLI/example shells own that boundary.

---

## What was NOT done in this artifact (explicitly)

Per the directive, this artifact does **not** include:

- §11.2 gaps ranking (high/medium/low risk)
- §11.3 schema additions to `AltitudePacket`, `SourceRef`, `Blackboard`, audit event types, or Cost KB
- §11.4 Daily Log canon section-heading recommendations
- §11.5 roadmap fit / engineer-hire dependency analysis
- §11.6 dogfood recommendation against the founder-judgment kill-switch
- Any "should be" / "needs" / "missing" language other than literal `NOT_FOUND_IN_MAIN` markers and the carve-out section above

Those sections are queued for ≥ May 18 (post-slice-window).

---

## Verification

- `git rev-parse HEAD` at inspection time: `411d50c8b0795057a13b867e8a3134a55bc06538`
- `git status --short`: clean
- Inspection method: `rg`/`grep` recon across `src/` and `tests/` (TypeScript only), followed by direct `Read` verification of definition sites for every cited line number in this document.
- Definition sites spot-checked against actual file contents: AltitudePacket (370–396), V17 (524–556), TranscriptModel (72–76), SourceRef (162–166), CostKbEntryPayload (388–396), BLACKBOARD_RAILS (49–56), VERTICAL_SLICE_FLOW_PACKET_ID (11), hosting registry (1–115).
