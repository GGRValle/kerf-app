# Proposal-First F&F Roadmap

Status: active roadmap · Aligned with `main` post-#108/#109 (proposal F&F path copy + Views Master fidelity). Thesis updated 2026-05-04 to clarify the onboarding-driven KB engine underneath the proposal spearpoint.

This note translates the F&F prioritization captured in
[`docs/w1_close_note.md`](./w1_close_note.md) into the next two-to-three weeks
of work. Goal: make the proposal review/follow-up loop usable for
Friends-and-Family demos and first paying-tenant conversations before
expanding breadth into invoice polish, drift polish, or new workflows.

## Updated F&F Thesis (2026-05-04)

Two layers, not one — a **visible spearpoint** sitting on top of a **core engine**:

- **Visible spearpoint:** proposal *review · action · audit*. The F&F demo lands a recipient on a queue of drafted proposal follow-ups, lets them approve / edit / reject one, and shows the audit chain that resulted. This is what a recipient sees and remembers.
- **Core engine:** an **onboarding-driven Kerf Knowledge Base**. The reason the spearpoint feels different from a generic SaaS demo is that the system already knows the contractor's company — service areas, labor rates, vendor cost posture, proposal style, margin guardrails — *because the operator answered structured questions during onboarding, not configured a dashboard*. Those answers compound into typed graph memory ([`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](./architecture/kerf_knowledge_graph_schema_v0_2.md) §3.9 — Guided Onboarding Ingestion) that the proposal review surfaces draw from immediately.

**Implication for the F&F pitch:** the right opening line is *"Kerf doesn't make you configure dashboards. It asks you the right questions, then uses your answers to draft proposals you can review."* Not *"here's a UI for proposal review."* The KB is what makes the proposal feel *yours* on the first use, instead of empty.

**Implication for the F&F build:** the proposal-loop work already on `main` is the demo surface. The next compounding investment isn't more proposal polish — it's the onboarding capture path that produces the typed memory the proposal surface reads.

## Current state

- One Policy Gate. One audit chain. One UI surface.
- Three workflows visible in the W1 mixed queue: `proposal_followup`,
  `invoice_followup`, `drift_detection`.
- Proposal-first queue ordering is landed.
- Proposal detail / review panel is landed.
- Browser demo actions append in-memory `decision.resolved` audit rows using
  the typed operator-decision event-template contract; proposal approve/reject
  also append the matching proposal workflow event in the same EventLog path.
- Seeded proposal read surface is landed: five realistic proposal records
  produce four eligible proposal follow-up DecisionPackets through the real
  detect -> draft -> AltitudePacket -> Policy Gate path.
- The seeded proposal read surface now reads through a local
  `ProposalReadSurfaceAdapter` boundary, so the seed can be swapped for a
  Platform read source without changing the gate or UI.
- Operator summary, workflow-aware buttons / reason form / action log
  verbs are landed.
- Captured proof packet at
  [`src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md`](../src/examples/evidence/2026-05-02-w1/PROOF_PACKET.md)
  documents the W1 close.
- Draft proposal F&F proof packet at
  [`src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](../src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md)
  ties `npm run smoke:proposal-ff`, the golden JSON, the runbook click script,
  and screenshot filenames; smoke stdout is committed, browser PNGs pending.

## F&F core path

```
proposal detected / reviewed
  → drafted follow-up visible to operator (DecisionCard)
  → operator approve / edit / reject
  → audit event chain (proposal_followup.detected → drafted →
    approval_requested → approved / rejected)
  → future: send tracking + client reply attribution
```

The F&F pitch anchors here. Everything else either supports this loop or
doesn't matter for F&F.

## Landed Since This Roadmap Was Drafted

- **Proposal detail / review panel (#72).** Clicking a proposal card opens a
  fuller surface where the operator reads the proposal in context, sees
  the drafted follow-up, and edits or approves.
- **Demo operator decision audit rows (#73).** Browser actions now append
  in-memory `decision.resolved` rows using the same typed
  operator-decision event-template path that production persistence will
  wire durably.
- **Seeded proposal read surface (#74).** The W1 demo proposal slice now
  starts from seeded `ProposalFollowupFacts` with sent, viewed,
  near-expiry, and change-requested records, then runs the real proposal
  workflow and Policy Gate.
- **Seeded proposal scanability polish (#75).** The queue calls out the
  12-card seeded mix and adds demo-only visual rhythm for the four seeded
  proposal cards.

## Required before F&F

- **Cross-restart proposal operator action storage.** The browser demo now
  commits proposal operator decisions and proposal workflow outcomes to the
  in-memory EventLog. Remaining work is a storage-backed EventLog so
  approve/edit/reject survives reload and can be used as F&F evidence.
- **Platform-backed proposal read adapter implementation.** The demo has a
  local/no-network adapter boundary. Remaining work is implementing a
  Platform-backed adapter on the other side of that boundary, then swapping
  data sources without changing the gate or UI.
- **Basic hosted/protected demo access.** A way for an F&F recipient to
  load the demo (read-only, single-tenant, gated by shared link or
  basic auth) without `git clone` + `npm run`.
- **Boring failure states.** Empty queue, loading skeleton, error
  banner. F&F demos can't 404 or blank-screen on a fresh tab.
- **Evidence capture for proposal action audit.** Same shape as the W1
  smoke proof packet, scoped to proposal: gate output on a proposal
  packet, audit chain showing approve/reject, screenshot of operator
  action persisting through reload.

## Onboarding Is Ingestion, Not Setup

The defensible difference between Kerf and a generic SaaS surface is that **the first 30 minutes of using Kerf are not configuration** — they're a guided question flow that produces typed structured memory the rest of the system reads. A new tenant doesn't fill out forms; they answer questions Right Hand asks. Each answer becomes graph entities (per [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](./architecture/kerf_knowledge_graph_schema_v0_2.md) §3.9 Guided Onboarding Ingestion).

**What onboarding should capture, in priority order for the proposal-review loop:**

| # | Capture | Why it matters for the proposal review surface |
|---:|---|---|
| 1 | **Company identity** — legal name, EIN, primary trade(s), license numbers, jurisdictions, brand assets | Drives `company_profile` (D-031); proposal artifacts render with the tenant's name / brand strip / license footer |
| 2 | **Service areas** — geographic reach, primary metros, jurisdictions you'll pull permits in | Tags every proposal with the service-area context; prevents drafts that quote work outside the tenant's lane |
| 3 | **Client types** — homeowner / commercial / GC / sub / mix; price band; typical project size | Tunes the proposal-style draft and language register; an HOA-heavy contractor sees different draft templates than a high-end residential one |
| 4 | **Labor rates** — base wages by role, burden multiplier, loaded rates | Backs `LaborResource` (per KG schema §6.1 + D-031); the proposal review surface can show "this is how your labor priced" without the operator re-typing rates per project |
| 5 | **Materials posture** — primary stocking suppliers, preferred brands, "we always vs. we never" lists | Drives material lookups in the Cost KB layered retrieval; proposal drafts cite the right supplier classes |
| 6 | **Vendor / supplier costs** — favored vendors with trade-account access vs. public retail; freshness expectations | Per D-030 (Cost KB Freshness Contract, DRAFT canon-side): `current_pricing` view must disclose freshness on every Decision Card whose pricing depends on the layer |
| 7 | **Crew roles** — who does what, who can run a job alone, who needs a lead | Routes notifications and approval workflows to the right operator without per-project assignment |
| 8 | **Proposal style** — formal vs. friendly tone, line-item depth, narrative paragraph length, customary attachments (warranty, payment schedule, exclusions) | The drafted follow-up the F&F recipient sees feels like the operator wrote it, not Kerf |
| 9 | **Margin / risk guardrails** — minimum margin per project type, blackout services (we won't quote tile-only jobs under $X), markup posture by trade | Feeds Policy Gate authority routing and `--kerf-source-class` ranking; protects against drafts that violate house rules |
| 10 | **Approval rules** — who approves what at what dollar threshold; per-decision_type altitude floors | Drives `system_baseline_altitude` per Policy Gate; lets the gate raise to OWNER_REVIEW without per-packet config |
| 11 | **Source documents** — sample contracts, scope templates, warranty docs, permit-fee tables, past proposal PDFs | EvidenceObjects with `source_class = TENANT_MEMORY`; Right Hand uses them as draft scaffolding |
| 12 | **Past project examples** — 5–10 closed jobs with scope notes, final price, what went well / wrong, lessons | Each becomes a structured memory the proposal surface can cite back ("we priced a similar Ada-Boise kitchen at $X two months ago — here's what was different") |

Onboarding is also **revisitable**. Every capture above is also editable later — but the system never silently invalidates an answer; updates emit LearningSignals + V10-gated MemoryRecord supersession per the canon graph contract.

**What onboarding is NOT:**
- Not a settings page. Settings pages produce empty schemas; question flows produce typed memory.
- Not optional. The proposal review surface refuses to draft against `MODEL_INFERENCE` alone (V1 / V8); it needs the captured `TENANT_MEMORY` to ground in.
- Not a one-time event. Re-onboarding is the path for new service-area expansion, new vendor relationships, post-incident policy updates.

## GGR/VIA Seed Path

The fastest way to prove the onboarding-driven KB works is to ingest **GGR Design + Remodel** and **Valle Custom Cabinetry / VIA** as the first tenants. Christian already has the answers to all 12 capture categories above — they live in his head, in QBO, in past proposals, in the team's working knowledge.

**Why GGR + VIA are the right seed:**

1. **Real data.** Not synthetic fixtures. The `seededProposalReadSurface` fixture in the W1 demo gives a 4-proposal scan, but those proposals don't trace to a real tenant memory chain. GGR + VIA proposals trace to real `LaborResource`, real material costs, real margin posture.
2. **Low coordination cost.** Christian is the operator; he's the founder; he can answer the 12 capture categories without needing a tenant kickoff call. Any other tenant requires a real intake.
3. **Two distinct contractor shapes in one tenant cluster.** GGR (Design + Remodel; whole-home remodels; HOA + high-end residential) and VIA / Valle Custom Cabinetry (cabinetry-only; smaller projects; longer-tail material lists) exercise very different proposal-style and margin postures. Validates that the captured KB is parameterized correctly per tenant rather than collapsing into a single shape.
4. **The first proof packets for "useful company memory."** Same proof-packet shape as the W1 + proposal-ff packets already shipping under `src/examples/evidence/`: a captured onboarding session, the resulting `MemoryRecord` rows, and a proposal review surface that visibly cites tenant-specific memory in its drafts (e.g., "this kitchen is similar to the Asdal residence we closed in October — see source basis").

**Suggested GGR/VIA seed PR sequence (after the spearpoint mobile pass):**

1. **GGR onboarding capture session.** Christian sits with Right Hand for 30–60 minutes; answers map to `MemoryRecord` rows; produces a captured `evidence/<date>-ggr-onboarding/PROOF_PACKET.md` with the full session transcript, the resulting graph rows, and a Decision Card screenshot showing GGR-specific draft language.
2. **VIA onboarding capture session.** Same shape, second tenant. Validates the multi-tenant parameterization isn't fudged.
3. **Cross-tenant smoke test.** A `npm run smoke:onboarding-kb` harness that opens a JSONL EventLog, ingests both seeded tenants, runs a proposal draft against each, and asserts that the drafts cite tenant-specific memory (not collapsing into a single generic answer).
4. **F&F demo retargeting.** The hosted F&F URL switches its seeded data from the synthetic `seededProposalReadSurface` to the GGR seeded surface. F&F recipients see proposals that look like real GGR work, not toy demos.

These four PRs are W2-scope; the proposal-review spearpoint and mobile/PWA pass land first because they're what an F&F recipient *interacts with*. The onboarding-driven KB is what makes the interaction feel real — but it's invisible work, and invisible work doesn't pitch by itself.

## Nice-to-have after F&F

Real value, but not blocking the F&F pitch:

- Invoice card polish (richer source-of-truth display, action
  affordances).
- Drift disposition polish (per-disposition handling, recommended
  next-step copy variants).
- Reply attribution (client response to a sent proposal attributed back
  to the operator's approve action).
- Better queue sorting / scoring (rank by altitude × urgency ×
  staleness like the Layer-A decisions projection).
- Spanish localization polish (i18n keys are wired; operator surface
  needs Spanish parity).

## Explicit non-goals

Each of these would expand surface without advancing the proposal loop:

- Full proposal generation (vs. follow-up). F&F reads existing
  proposals; new authorship is W2.5+.
- Full CRM replacement. We are not the source of record for client
  data.
- Multi-tenant admin console. Single-tenant demo is enough.
- Autonomous external sends. Operator approval stays load-bearing;
  the gate's `block_external_send` is a feature, not a bug.
- Payment collection / billing. Out of scope.
- Broad workflow expansion (intake, voice tour, memory promotion,
  etc.). Drift and invoice already prove the gate generalizes; more
  workflows don't strengthen the F&F pitch.

## Suggested PR sequence

Two-to-three weeks, ordered so each PR makes the proposal loop more
usable than the last:

1. **Proposal detail / review panel.** Landed in
   [#72](https://github.com/GGRValle/kerf-app/pull/72). New screen/route from a proposal
   card click. Full proposal context, drafted follow-up, operator
   action affordances. Keeps the workflow-aware copy chain.
2. **Proposal action audit persistence.** Advanced beyond
   [#73](https://github.com/GGRValle/kerf-app/pull/73): browser actions
   append in-memory `decision.resolved` rows using the typed
   event-template contract, and proposal approve/reject now append the
   matching proposal workflow outcome event. Remaining work is
   storage-backed persistence across reload.
3. **Proposal read surface adapter stub.** Advanced beyond #74: seeded
   realistic proposal data feeds the demo through the real workflow and
   gate, and the read surface now has a local/no-network adapter boundary.
   Remaining work is a Platform-backed adapter implementation that can
   swap in at the boundary.

   Historical context: partially landed in
   [#74](https://github.com/GGRValle/kerf-app/pull/74): seeded realistic
   proposal data first fed the demo through the real workflow and gate.
4. **Hosted demo shell.** Static-site or single-server deployment
   target with read-only single-tenant gating. F&F recipient gets a
   URL, not a clone instruction.
5. **F&F evidence packet (drafted; smoke ready).** Same shape as the W1 proof
   packet, scoped to the proposal loop: `npm run smoke:proposal-ff` stdout
   (committed `smoke_output.txt` + golden JSON), approve/reject + JSONL reopen
   durability, runbook click-script steps 14–19, and screenshot filenames in
   [`src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md`](../src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md).
   **Remaining operator work:** add `screenshots/*.png` under that directory;
   re-`tee` `smoke_output.txt` only when the harness contract changes.
   **Distribution lock** still waits on hosted demo + cross-restart persistence.

After this sequence, the F&F pitch has a usable proposal loop with
captured evidence. Nice-to-haves can land in parallel or after,
prioritized by demo feedback.
