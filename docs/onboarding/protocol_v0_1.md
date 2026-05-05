# Onboarding Protocol Canon — v0.1 (engineer-ready spec)

**Status:** DRAFT · Kerf-app side (`GGRValle/kerf-app`)  
**Date:** 2026-05-05  
**Owner:** Christian Asdal · GGR  
**Companion:** Canon-side parent doc promotes to `kerf-cos/` later; this file is the implementation-facing script + mapping reference.

---

## 1. Purpose / thesis

**Locked F&F build thesis:** *F&F Kerf is a proposal-first operating assistant powered by guided onboarding and source-backed company memory.* The visible spearpoint is proposal *review · action · audit*; the core engine is an **onboarding-driven Kerf Knowledge Base** — the operator does not configure empty dashboards; they answer Right Hand’s questions once, and typed memory compounds into graph rows the proposal surface reads on first serious use.

**Product principle:** *Onboarding is not setup. Onboarding is the first Knowledge Base ingestion workflow.* Configuration pages produce empty schemas; a structured interview produces `EvidenceObject` → `ExtractedClaim` → promoted tenant memory per the same Stage 1 → Stage 2 spine as runtime decisions.

**Origin of the twelve capture lanes:** The canonical priority table lives in [`docs/ff_proposal_first_roadmap.md`](../ff_proposal_first_roadmap.md) under **§ [Onboarding Is Ingestion, Not Setup](../ff_proposal_first_roadmap.md#onboarding-is-ingestion-not-setup)**. This protocol specifies the **question script** for those twelve rows only — no thirteenth category.

**Graph contract:** Row-level answer → entity mapping is defined in [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](../architecture/kerf_knowledge_graph_schema_v0_2.md) **§3.9 Guided Onboarding Ingestion**, especially **§3.9.1** (mapping table) and **§3.9.2** (promotion path). This document **reuses** that mapping; it does not duplicate the full table.

---

## 2. Session shape

- **Duration:** One uninterrupted **30–60 minute** session (calendar block). Partial sessions are allowed only if the operator explicitly saves progress — implementation detail track A2 — not specified here.
- **Participants:** **Right Hand** (asks, transcribes, structures, restates) and the **operator** (answers, confirms, corrects).
- **Interaction model:** **Conversational**, not form-filling. Right Hand proposes a natural-language question; the operator answers in speech or typed chat; Right Hand **restates for confirmation**: *“So you’re saying X — I’m capturing that as Y in your company profile. Right?”* The operator confirms or corrects **before** the capture advances.
- **Spanish-native parity (structural):** Every scripted question in §3 exists in English with an **`(ES: …)`** parenthetical carrying the Spanish wording intent. Full `I18nKey` wiring is W2 — but the rule is fixed now: **EN and ES are co-canonical** for every operator-visible prompt; no English-only “temporary” strings in production surfaces (see [`docs/wireframes/notes.md`](../wireframes/notes.md) state matrix — **Bilingual EN/ES** row — and [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](../architecture/kerf_knowledge_graph_schema_v0_2.md) §9.3 Spanish-native parity).
- **Wireframe posture (pattern only):** Canon mobile operator rhythm (**The One Thing → On Deck → The Pulse**) appears in [`docs/wireframes/kerf_views_master_v1_0.html`](../wireframes/kerf_views_master_v1_0.html) frame **F·02** (`#f2`). Decision-queue density and filter chips follow **F·03** (`#f3`). Schedule and documents surfaces (**F·07a** `#f7a`, **F·16** `#f16`) illustrate **card → detail** conversational patterns for W2+; F&F onboarding uses the **same conversational tone**, not those modules’ full UI (which remain W2+ per §8).

**Confirmation latch (every category):** Before leaving a topic, Right Hand **must** obtain an explicit operator **yes** on the structured restatement. Template:

1. **Reflect:** one sentence mirroring the operator’s words.
2. **Structure:** name the fields that will become graph rows (`LaborResource`, `MemoryRecord`, etc.).
3. **Confirm:** *“Do I have that right?”* / *(ES: ¿Lo tengo bien?)*

If the operator hesitates, **probe once**, then offer **defer** (*“We can park this and come back — ok?”*).

**Intake-pack metaphor (non-binding UI):** Canon **intake** frames (v3 intake pack in [`docs/wireframes/notes.md`](../wireframes/notes.md) coverage matrix — voice / form / draft / capture rows) informed **tone and pacing**, not F&F layout. Onboarding ships as **conversation first**; pixel-perfect intake chrome is out of scope for this canon (§8).

---

## 3. The twelve capture categories — full question script

Labels **#1–#12** match the roadmap capture-priority table **exactly**.

### 3.1 Company identity

**Opening (RH):**  
“I’d like to anchor Kerf in *your* company — not a generic contractor profile. Let’s start with the basics: what’s your **legal business name**, **EIN or equivalent**, **primary trade(s)**, **license numbers**, **jurisdictions where you’re licensed**, and **brand assets** we should show on proposals?”  
**(ES: Quiero anclar Kerf en *tu* empresa. Empecemos por lo básico: nombre legal, identificación fiscal, oficio principal, licencias, jurisdicciones y marca para propuestas.)**

**Probes (if thin):**

- “Do you operate under a **DBA** different from the legal name?”
- “Which **license classes** matter for the work you sell — B-General, CSL specialty, county?”
- “Do you have **logo / letterhead PDFs** you always attach, or should we rely on text-only headers?”

**Structured shape:** `company_profile` + `Tenant` metadata — legal name, EIN, trades[], license_numbers[], jurisdictions[], brand_asset_uris[] (see KG §3.9.1 row 1).

**Worked example (GGR):**  
Operator: “We’re **Get Green Remodeling, Inc.**, DBA **GGR design + remodeling**, California **B-General** with **lead-safe** certification in San Diego County; EIN on file in QuickBooks; brand pack is our navy + amber strip.”
**Captured as:** Legal entity + DBA + sole primary trade “design-build residential remodel” + jurisdiction tags (`US-CA`, `San Diego County`) + pointer to brand EvidenceObjects.

---

### 3.2 Service areas

**Opening:**  
“Where do you **actually take work** — metros, counties, ZIP clusters — and where do you **pull permits**? I want proposal drafts to stay inside the lanes you actually serve.”  
**(ES: ¿Dónde trabajan de verdad — municipios, condados, códigos postales — y dónde sacan permisos?)**

**Probes:**

- “Any **hard excludes** — mountain towns, coast-only, HOA clusters?”
- “Do you cross into **neighboring states** for large jobs?”

**Structured shape:** Geographic tags driving `MemoryRecord` (`approved_project_type_band` per metro/jurisdiction) — see KG §3.9.1 row 2.

**Worked example (GGR):**  
“Mostly **North County San Diego** — Poway, Rancho Bernardo, 4S Ranch — we’ll go coastal for repeat clients but we **won’t** bid Imperial County.”  
**Captured as:** Service-area claims with exclude flag for Imperial County.

---

### 3.3 Client types

**Opening:**  
“Who buys from you day-to-day — **homeowners**, **commercial GCs**, **direct commercial owners**, **subs** — what’s the mix, typical **ticket size**, and **project duration** band?”  
**(ES: ¿Quién les compra — propietarios, comercial, GCs? ¿mezcla, ticket típico, duración?)**

**Probes:**

- “Any segments you **want more of** vs **want to fire**?”
- “HOA-heavy vs rural-large-lot — where do you live?”

**Structured shape:** Client-mix tags on `MemoryRecord` (`approved_project_type_band` + client-type tag) — KG §3.9.1 row 3.

**Worked example (VALLE cabinetry + millwork):**
“We’re **70% homeowner kitchen/bath**, **25% small commercial FF&E**, **5% GC package pricing**; typical cabinet jobs **$25–120k sell**, **4–10 weeks** install window.”  
**Captured as:** Weighted client-type observations + nominal band for proposal tone.

---

### 3.4 Labor rates

**Opening:**  
“Walk me through **labor economics** — for each **role you cost against** (lead carpenter, installer, finisher, PM time), what’s **base wage**, **burden multiplier**, and **loaded rate** you want Kerf to treat as authoritative?”  
**(ES: Por cada rol: salario base, carga, tarifa cargada que Kerf debe usar.)**

**Probes:**

- “Anyone **burden-exempt** (1099 vs W2)?”
- “Effective dates — **raise cycles**, seasonal crews?”

**Structured shape:** Per-role `LaborResource` / `labor_rate` rows — `base_wage_cents_per_hour`, `burden_multiplier`, `loaded_rate_cents_per_hour`, `effective_from` — KG §6.1 + §3.9.1 row 4.

**Worked example (Valle):**
“**Installer** loaded **$68/hr**, **finisher** **$72/hr**, **shop drawer assembler** **$52/hr**; burden **1.42** on W2; rates effective **Jan 1**.”  
**Captured as:** Three `LaborResource` candidates with effective_from.

---

### 3.5 Materials posture

**Opening:**  
“Which **suppliers and brands** are your defaults — what do you **always** specify, what do you **never** want to see in a draft?”  
**(ES: Proveedores y marcas por defecto — siempre / nunca.)**

**Probes:**

- “**Stocking** relationships vs will-call?”
- “**Regional substitutes** when supply tight?”

**Structured shape:** `MemoryRecord` (`approved_assembly` placeholders + `approved_exclusion_pattern` for “never” lists) — KG §3.9.1 row 5.

**Worked example (GGR):**  
“**Medallion** framed overlay on kitchens unless client insists ; **no** particleboard boxes on jobs over **$75k sell**.”  
**Captured as:** Preferred assembly hooks + exclusion pattern record.

---

### 3.6 Vendor / supplier costs

**Opening:**  
“Which vendors give you **trade pricing**, **account numbers**, and how **stale** can a quote be before you won’t trust it on a live proposal?”  
**(ES: ¿Qué proveedores dan precio comercial y cuánta frescura exigen?)**

**Probes:**

- “**Will-call vs delivery** cost assumptions?”
- “Any vendors **blacklisted**?”

**Structured shape:** `CostItem` + `current_pricing` view (freshness) — KG §3.9.1 row 6; D-030 freshness disclosure on Decision Cards consuming the layer.

**Worked example (Valle):**
“**Cabinet distributor** trade login; typical quote freshness **14 days** on specialty veneers.”  
**Captured as:** Supplier_quote-backed price_observation claims + freshness expectation metadata.

---

### 3.7 Crew roles

**Opening:**  
“Who **runs jobs solo**, who **needs a lead**, who **only touches finishes** — map the roles so alerts route to the right human.”  
**(ES: ¿Quién puede dirigir solo, quién necesita jefe de cuadrilla?)**

**Probes:**

- “**Saturday policy** — who’s on-call?”
- “**Language preference** for crew-facing SMS?”

**Structured shape:** `crew` + `role_assignment` rows (§6.1) — KG §3.9.1 row 7. **No HR admin UI** — capture only.

**Worked example (GGR):**  
“**Mike** runs jobs alone under **$400k**; **two-person rule** on occupied homes with demo.”  
**Captured as:** Role routing observations tied to crew entities.

---

### 3.8 Proposal style

**Opening:**  
“When you send a proposal or follow-up, are you **formal or conversational**, **line-item heavy or narrative-first**, what **attachments** are customary — warranty chunk, payment schedule, exclusions block?”  
**(ES: Tono, profundidad de partidas, adjuntos típicos.)**

**Probes:**

- “**Spanish-first** drafts to clients?”
- “**Deposit language** you always include?”

**Structured shape:** `MemoryRecord` (`approved_assembly` boilerplate; `approved_proposal_style` reserved subkind v0.3) — KG §3.9.1 row 8.

**Worked example (GGR):**  
“**Formal register** for HOA boards; **three-tier payment schedule** always; **12-month workmanship** paragraph verbatim from our template.”  
**Captured as:** Style + boilerplate assembly references.

---

### 3.9 Margin / risk guardrails

**Opening:**  
“What **minimum margin** do you protect by project type, what jobs do you **refuse to price** (too small, wrong trade), and what’s your **markup posture** by category?”  
**(ES: Márgenes mínimos, trabajos prohibidos, postura de margen.)**

**Probes:**

- “**Change-order margin** vs **original bid**?”
- “**Allowances** you cap?”

**Structured shape:** `MemoryRecord` (`approved_markup_rule`) + Policy Gate authority floors — KG §3.9.1 row 9. **Owner/MoO sensitivity** — V6.

**Worked example (GGR):**  
“No **full-gut under $175k sell**; **gross margin floor 38%** on remodels; **tile-only** jobs under **$15k** we pass.”  
**Captured as:** Markup rules + exclusion thresholds.

---

### 3.10 Approval rules

**Opening:**  
“Who **approves sends** at what **dollar thresholds** — owner vs PM — and does it vary by **decision type** (proposal vs CO)?”  
**(ES: Umbrales de aprobación por monto y tipo de decisión.)**

**Probes:**

- “**After-hours** approvals?”
- “**Joint-check** rules?”

**Structured shape:** `MemoryRecord` (`approved_markup_rule` + `approved_self_perform_trade` facets) feeding Policy Gate `system_baseline_altitude` — KG §3.9.1 row 10.

**Worked example (Valle):**
“Owner approves **all** client-facing sends; PM drafts only.”  
**Captured as:** Approval altitude observations per decision_type.

---

### 3.11 Source documents

**Opening:**  
“Show me the **artifacts you reuse** — sample contracts, scope templates, warranty PDFs, **permit fee tables**, redacted past proposals.”  
**(ES: Plantillas, garantías, tablas de permisos, propuestas pasadas.)**

**Probes:**

- “Which docs are **client-visible** vs internal?”
- “Version **dates** — which is current?”

**Structured shape:** `EvidenceObject` (plan_pdf / estimate_pdf / field_note) → promoted boilerplate via V10 — KG §3.9.1 row 11.

**Worked example (GGR):**  
“Here’s our **master scope template v2025-03** and **county fee sheet PDF**.”  
**Captured as:** EvidenceObjects + linkage to assembly extraction.

---

### 3.12 Past project examples

**Opening:**  
“Give me **5–10 closed jobs** — short scope note, **final price**, **what went well / wrong**, **lesson** you want Kerf to cite next time someone asks for something similar.”  
**(ES: 5–10 trabajos cerrados: alcance, precio final, lección aprendida.)**

**Probes:**

- “Which jobs are **OK to name** in drafts vs **anonymize**?”
- “**Photos** available?”

**Structured shape:** Per-project `EvidenceObject` + `ExtractedClaim[]` → `MemoryRecord` per comparable anchor — KG §3.9.1 row 12.

**Worked example (Valle):**
“**Ada Boise kitchen** — **$92k sell**, slipped on **long-lead pulls**; lesson: **order decorative hardware at deposit**.”  
**Captured as:** Comparable project memory suitable for “similar job” citations.

---

## 4. Answer → graph mapping (compact reference)

**Do not duplicate** [`§3.9.1`](../architecture/kerf_knowledge_graph_schema_v0_2.md#391-onboarding-answer--graph-entity-mapping) — use that table as source of truth. One-line **primary / secondary** hints for implementation routing:

| # | Primary write target | Secondary / scaffolding |
|---:|---|---|
| 1 | `company_profile` + `Tenant` metadata | `EvidenceObject` intake + `ExtractedClaim[]` |
| 2 | `MemoryRecord` (`approved_project_type_band`) | Scoped `ExtractedClaim` (`scope_observation`) |
| 3 | `MemoryRecord` (client-type tagged band) | `ExtractedClaim` (`client_preference_observation`) |
| 4 | `LaborResource` / `labor_rate` | Price observations (`TENANT_MEMORY`) |
| 5 | `MemoryRecord` (assembly + exclusion patterns) | Material scope claims |
| 6 | `CostItem` + pricing freshness | Supplier quote / intake evidence |
| 7 | `crew` + `role_assignment` | Staffing scope claims |
| 8 | `MemoryRecord` (proposal boilerplate / style) | Client preference claims |
| 9 | `MemoryRecord` (`approved_markup_rule`) | Policy Gate floor linkage |
| 10 | `MemoryRecord` (rules + trade authority) | Altitude / approval routing |
| 11 | `EvidenceObject` corps + promoted boilerplate | `approved_assembly` via V10 |
| 12 | Per-project `MemoryRecord` comparables | Rich `EvidenceObject` + claims |

---

## 5. V10 promotion path (batch approval)

Per [`§3.9.2`](../architecture/kerf_knowledge_graph_schema_v0_2.md#392-promotion-path): onboarding answers **never auto-promote** (R3 — no silent `MemoryRecord` writes). At session end, Right Hand drafts **all** twelve captures as a **single batch review**; the operator approves **once**; **V10** executes **one bulk promotion transaction** to `MemoryRecord` rows (and associated typed entities). This preserves **no auto-promotion** without twelve separate clicks.

---

## 6. Re-onboarding & corrections

Any capture remains **independently editable** post-session. Each edit emits a `LearningSignal` with `signal_kind = field_correction` (see [`§3.7`](../architecture/kerf_knowledge_graph_schema_v0_2.md#37-learningsignal)), referencing `field_path` / prior vs new values. Promoted memory **supersedes** via `MemoryRecord.superseded_by?` chain ([`§3.8`](../architecture/kerf_knowledge_graph_schema_v0_2.md#38-memoryrecord)) — never silent overwrite.

---

## 7. Failure modes (operator-facing behaviors)

| Situation | Right Hand behavior |
|---|---|
| **Skip** — operator cannot answer now | Record **deferred** flag; queue **re-ask** in next session slice; do not block batch promotion on deferred fields if operator confirms partial batch (implementation defines envelope). |
| **Ambiguous** — numeric ranges overlap, contradictory modifiers | **One clarifying probe** max; if still fuzzy, capture **best-effort + uncertainty tag** and schedule follow-up. |
| **Contradiction mid-session** — new answer conflicts with earlier | Surface **both** statements; ask which is **canonical**; emit correction signal if prior capture already staged. |
| **Contradiction vs promoted memory (later)** | Treat as **field_correction** LearningSignal; requires explicit re-approval per V10 rules. |
| **Sensitive HR / PII overshare** | RH **does not** transcribe home addresses or medical detail into PM-visible fields — [`§6.2` HR read lattices](../architecture/kerf_knowledge_graph_schema_v0_2.md#62-read-lattices) govern projection; capture only job-relevant staffing facts unless operator explicitly promotes sensitivity tier (owner-only). |

---

## 8. What this canon does NOT specify

- **Voice capture** — deferred W2+ per [`docs/proposal_ff_mobile_pwa_plan.md`](../proposal_ff_mobile_pwa_plan.md) §3.5 (**Voice capture** — toast-only in F&F) and §9 Non-goals (**Voice capture wiring**).
- **TypeScript types** for `OnboardingSession` / `OnboardingAnswer` — track **A2**, separate PR.
- **GGR/Valle seed importer** — track **A3**, separate PR.
- **Dedicated onboarding UI shell** — W2 mobile / PWA surfaces; F&F stays proposal-queue demo until those land.
- **HR / schedule / documents / comms modules** — graph lanes may ingest per [`§3.9.4`](../architecture/kerf_knowledge_graph_schema_v0_2.md#394-whats-deferred--captured-in-graph-not-yet-ui-widened); **UI widening is W2+**.

---

## 9. Cross-references

| Topic | Doc |
|---|---|
| F&F thesis + twelve-row capture table | [`docs/ff_proposal_first_roadmap.md`](../ff_proposal_first_roadmap.md) § [Updated F&F Thesis](../ff_proposal_first_roadmap.md#updated-f--f-thesis-2026-05-04), § [Onboarding Is Ingestion, Not Setup](../ff_proposal_first_roadmap.md#onboarding-is-ingestion-not-setup) |
| Answer → graph mapping + batch promotion | [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](../architecture/kerf_knowledge_graph_schema_v0_2.md) §3.9 |
| Learning signals + corrections | [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](../architecture/kerf_knowledge_graph_schema_v0_2.md) §3.7–3.8 |
| Mobile / PWA constraints | [`docs/proposal_ff_mobile_pwa_plan.md`](../proposal_ff_mobile_pwa_plan.md) §3 (iPhone surfaces), §9 Non-goals |
| Operator landing metaphor | [`docs/wireframes/kerf_views_master_v1_0.html`](../wireframes/kerf_views_master_v1_0.html) **F·02** `#f2` |
| Decision queue pattern | same file **F·03** `#f3` |
| Schedule / docs deep surfaces (pattern reference) | **F·07a** `#f7a`, **F·16** `#f16` |
| Type + bilingual grid | [`docs/wireframes/notes.md`](../wireframes/notes.md) |

---

## 10. What’s next (outside this file)

1. Land TS types + session envelope (**A2**).  
2. Land seed importer for GGR/Valle proof tenants (**A3**).
3. Wire Right Hand orchestration + V10 batch UI when mobile onboarding shell schedules.

---

*— End Onboarding Protocol Canon v0.1 — Kerf-app engineer-ready spec —*
