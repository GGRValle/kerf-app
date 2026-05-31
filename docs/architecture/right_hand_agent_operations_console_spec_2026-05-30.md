# Right Hand Agent Operations Console — Internal Control Plane Spec (DRAFT)

- **Date:** 2026-05-30
- **Status:** Draft architecture/product spec. Not customer-facing. Not yet scheduled.
- **Working names:** Right Hand Studio, Agent Operations Console, Agent Ops.
- **Related canon:** D-049 failure as training signal; D-051 four-locality memory axis; Right Hand Turn + Attention Manager draft; stored-fact envelope v1.1; multi-tenant isolation CI brief; **Wireframe Object Ownership Audit (#257, merged)** and its **8-primitive object model** (Turn · Resolution Packet · Work Artifact · Attention Artifact · Decision · Business Graph Node · Agent · Source / Evidence; gates are enforcement edges, screens are projections).

## 0. Thesis

Right Hand needs an internal control plane where the company can see how agents are performing, inspect failures, approve learning proposals, refine Plays, run evals, and promote safe structural improvements without sharing tenant data across customers.

This is the background UI for the agentic harness. The customer sees Right Hand doing work. The company sees the machinery that lets Right Hand improve on purpose.

Core rule:

> Tenant agents learn privately. Platform agents learn structurally. Company operators approve promotion.

## 1. What This Is / Is Not

**This is:**

- Internal company software for Right Hand operators, support, product, and engineering.
- The place where agents, Plays, failures, evals, tool permissions, prompts, schemas, and promotion proposals are reviewed.
- The safe path for turning repeated tenant-private failures into content-free platform improvements.
- The operating surface for improving the harness after dogfood and customer usage.

**This is not:**

- A customer-facing dashboard.
- A place for agents to freely inspect other tenants.
- A shadow admin portal that bypasses tenant isolation.
- A prompt playground where production behavior changes without audit.
- A route around validators, consent, role visibility, or consequence gates.

## 2. Users

| User | Job in the console | Hard boundary |
|---|---|---|
| Founder / product lead | Review product failures, approve Play direction, prioritize improvements | Cannot casually browse tenant-private data outside authorized support context |
| Agent operator | Triage failures, label issue types, approve/reject learning proposals | Cannot promote tenant content to platform knowledge |
| Engineer | Add tests, fix tools, change registry permissions, ship updates | All changes require audit and eval proof |
| Support / success | Inspect tenant-specific issue with explicit tenant/support scope | No cross-tenant comparison unless data is structural/sanitized |
| Evaluation owner | Maintain replay suites and acceptance thresholds | Cannot lower thresholds without audit |

## 3. The Five Internal Surfaces

### 3.1 Agent Registry

Single source of truth for each specialist agent:

- `agent_id`
- Display name
- Domain: estimating, daily log, money, schedule, procurement, client, PM, field hand, admin, etc.
- Allowed inputs
- Allowed outputs
- Allowed tools
- Allowed memory scopes
- Consequence ceiling
- Forbidden actions
- Validator requirements
- Current eval score
- Recent failure signatures
- Owner / maintainer

The registry is the least-privilege map. No agent should gain a tool, memory scope, or consequence tier without a registry change and audit event.

### 3.2 Failure Inbox

Queue of issues surfaced from production/dogfood:

- wrong route
- bad draft
- rejected suggestion
- repeated operator correction
- failed validator
- low-confidence parse
- missing source ref
- slow response
- confused role visibility
- tenant-specific complaint
- agent timeout or fallback

Every issue carries:

- tenant locality
- user/role
- surface
- agent/play involved
- source event ids
- failure class
- consequence tier
- whether tenant-private content is present
- recommended triage path

The inbox is not a raw-data lake. It is an issue queue with privacy-aware drill-down.

### 3.3 Learning Proposal Queue

Agents and validators can propose improvements, but they cannot apply them.

Proposal types:

- update a Play
- add an eval case
- adjust a prompt rule
- add a schema field
- add a parser guard
- alter attention ranking weights
- add a source-class rule
- mark an agent-tool permission as too broad or too narrow

Each proposal must state:

- observed failure pattern
- evidence refs
- locality: tenant-private, org-shared, platform-structural candidate, shared-corpus candidate
- proposed change
- affected agents/surfaces
- expected benefit
- risk
- evals required before promotion
- human approver

No proposal becomes platform behavior until approved and tested.

### 3.4 Replay + Eval Workbench

The workbench turns failures into durable tests:

- replay a voice turn
- replay a draft synthesis
- replay a routing decision
- replay a validator block
- replay a role-visibility projection
- compare old vs. proposed Play behavior
- test against adversarial tenant-leak and consequence-escape cases

Minimum outputs:

- pass/fail
- diff of work artifact
- diff of attention artifact
- source refs preserved?
- role/tenant visibility preserved?
- consequence gate preserved?
- latency/cost
- operator-facing copy quality

This is where "learning" stops being vibes and becomes measurable.

### 3.5 Promotion Gate

The promotion gate decides whether a learning can cross locality boundaries:

| From | To | Allowed now? | Required gate |
|---|---|---:|---|
| tenant_private | tenant_private | Yes | tenant/user scoped approval or correction |
| tenant_private | org_shared | Future | org consent + role visibility + support policy |
| tenant_private | platform_structural | Yes, only if content-free | structure-only proof + human approval + eval pass |
| tenant_private | shared_corpus | No for V1 | explicit consent + privacy controls + cohort checks + human approval |
| platform_structural | platform_structural | Yes | eval pass + change audit |

The promotion gate is the bridge between "each tenant learns" and "the platform gets better" without leaking tenant facts.

## 4. Agentic Database / Knowledge Graph

The console should expose an internal Agent Knowledge Graph. This is the "agentic database" layer, but it must be content-separated.

Nodes:

- Agent
- Tool
- Play
- Prompt rule
- Schema
- Validator
- Eval case
- Replay
- Failure signature
- Learning proposal
- Promotion decision
- Release
- Tenant-scoped issue reference

Edges:

- agent uses tool
- agent emits artifact
- play calls agent
- validator blocks artifact
- issue came from event
- issue generated proposal
- proposal updates play
- eval covers failure signature
- release included proposal

Agents can query this graph to improve their work, but cross-tenant answers must come from structural nodes only: Plays, schemas, validators, failure signatures stripped of content, eval cases approved for platform use, and content-free prompt rules.

## 5. Agent-to-Agent Learning Without Tenant Leakage

The console may let agents benefit from problems found in other tenant instances, but only through structural intermediaries.

Allowed:

- "This class of estimate failed because source refs were missing."
- "For field notes with no keyword, default to saveable note."
- "When a money figure appears in draft synthesis, trigger money guard."
- "This route pattern needs a clarification question before filing."
- "This Play needs a required `project_id` before persistence."

Forbidden:

- "Tenant A's estimate line should teach Tenant B's model."
- "Show Tenant B a corrected Tenant A proposal."
- "Use another tenant's job history as comparables."
- "Promote raw transcript, photos, client names, pricing, or schedule data into platform memory."

Implementation posture:

- Store tenant-private issue content in tenant-local storage.
- Store platform-visible failure signatures as content-free descriptors.
- Link from platform signature to tenant evidence only through access-controlled support refs.
- Require explicit promotion status before any cross-tenant retrieval.

## 6. First Version (V0.1)

Build the smallest useful internal console:

1. **Agent Registry (read-mostly)**
   - static registry file or table
   - agent permissions/consequence ceiling visible
   - no runtime mutation at first

2. **Failure Inbox**
   - reads existing `learning_signal.drafted`, validator blocks, rejected drafts, and voice-route failures
   - groups by failure signature
   - supports labeling and assignment

3. **Learning Proposal Queue**
   - manually create proposal from an issue
   - approve/reject/defer
   - promotion status visible

4. **Replay/Eval Links**
   - link issue to a replay command/test
   - record pass/fail artifact

5. **Audit Log**
   - every label, proposal, approval, and registry change is logged

No autonomous Play updates in V0.1.

## 7. V0.2 / V1 Expansion

After V0.1 is useful:

- Add agent-authored learning proposals.
- Add structured diff view for Play/prompt/schema changes.
- Add eval gating before approval.
- Add release bundle view: "these proposals shipped in vX."
- Add per-agent scorecards.
- Add "customer pain heatmap" by failure class, without exposing tenant content.
- Add support-mode drill-down with explicit tenant access audit.
- Add promotion-gate enforcement against the D-051 locality axis.

## 8. Data Contracts

### 8.1 Agent Registry Entry

```ts
interface AgentRegistryEntry {
  agent_id: string;
  display_name: string;
  domain: string;
  allowed_inputs: string[];
  allowed_outputs: string[];
  allowed_tools: string[];
  allowed_memory_scopes: string[];
  consequence_ceiling: 'draft' | 'durable_record' | 'external_send_request' | 'money_review_only';
  forbidden_actions: string[];
  required_validators: string[];
  owner: string;
  status: 'draft' | 'active' | 'restricted' | 'retired';
}
```

### 8.2 Failure Signature

```ts
interface FailureSignature {
  signature_id: string;
  tenant_id?: string; // omitted from platform-visible projection unless authorized
  locality: 'tenant_private' | 'platform_structural';
  surface: string;
  agent_id?: string;
  play_id?: string;
  failure_class:
    | 'wrong_route'
    | 'bad_draft'
    | 'missing_source_ref'
    | 'validator_block'
    | 'role_visibility_block'
    | 'slow_or_timeout'
    | 'operator_rejected'
    | 'correction_repeated'
    | 'fallback_used'
    | 'unknown';
  consequence_tier: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  has_tenant_private_content: boolean;
}
```

### 8.3 Learning Proposal

```ts
interface LearningProposal {
  proposal_id: string;
  source_signature_ids: string[];
  locality_from: 'tenant_private' | 'org_shared' | 'platform_structural' | 'shared_corpus';
  locality_to: 'tenant_private' | 'org_shared' | 'platform_structural' | 'shared_corpus';
  proposed_change_type:
    | 'play_update'
    | 'prompt_rule'
    | 'schema_change'
    | 'validator_rule'
    | 'agent_permission'
    | 'attention_ranking'
    | 'eval_case';
  summary: string;
  risk_summary: string;
  eval_requirements: string[];
  status: 'draft' | 'queued' | 'approved' | 'rejected' | 'deferred' | 'shipped';
  approver_id?: string;
  approved_at?: string;
}
```

## 9. UI Wireframes Needed

Before runtime build, wireframe these internal surfaces:

1. **Agent Registry Detail**
   - agent identity, tools, permissions, memory scope, consequence ceiling, recent failures

2. **Failure Inbox**
   - grouped failure signatures, severity, locality badge, triage owner

3. **Learning Proposal Review**
   - what failed, proposed fix, locality boundary, eval requirements, approve/reject

4. **Replay/Eval Workbench**
   - replay input, expected output, actual output, diff, validator results

5. **Promotion Gate**
   - tenant-private evidence on one side, content-free structural proposal on the other, with red/yellow/green gate checks

> **Drift rule + object-model mapping.** These five are net-new internal surfaces. Under the rule merged in the ownership audit (#257) — *no new surface lands in production without a canon source or vendored mirror* — each must carry an owner object from the 8-primitive model: Agent Registry → **Agent**; Failure Inbox → **Attention Artifact** (a ranked queue over failure signatures); Learning Proposal Review → **Resolution Packet → Decision**; Replay/Eval Workbench → **Source / Evidence**; Promotion Gate → **Decision** (the gate itself is an enforcement edge, not a primitive). They are company-facing, so they live outside the customer-facing 109 but inherit the same object discipline and consequence/gate vocabulary.

This UI should use internal/admin density, not phone-first contractor chrome. It is for company operators.

## 10. Acceptance Criteria

V0.1 is acceptable when:

- Every active specialist agent has a registry entry.
- Existing `learning_signal.drafted` events can surface in a Failure Inbox.
- A company operator can turn an issue into a learning proposal.
- A proposal cannot be approved across locality boundaries without a promotion gate result.
- The console never shows tenant-private content in a platform-wide view.
- Registry changes are audited.
- Approved proposals require linked eval/replay evidence before release.
- No agent can update its own Play, prompt, schema, or tool permissions without human approval.

## 11. Open Questions

1. Name: Right Hand Studio, Agent Operations Console, or another internal brand?
2. Should this live under the customer app's admin route, or be a separate internal app?
3. Who has support-mode access to tenant-private issue drill-down?
4. What is the first failure source: voice overlay, draft synthesis, estimate, or money guard?
5. Should V0.1 persist to the same event log, or use a separate internal operations store with references back to tenant events?

## 12. Build Sequencing

Recommended order:

1. Finish Right Hand phone loop and Turn Resolution Packet.
2. Land isolation CI spine for tenant/role boundaries.
3. Define Agent Registry contract.
4. Build internal read-only Agent Registry + Failure Inbox.
5. Add Learning Proposal Queue and Replay/Eval links.
6. Add Promotion Gate enforcement.
7. Only then allow agent-authored proposals.

This keeps the console useful without letting internal learning outrun trust.
