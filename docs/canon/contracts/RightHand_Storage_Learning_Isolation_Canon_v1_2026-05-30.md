# Right Hand · Storage, Learning & Tenant-Isolation Canon · v1.1

**Date:** 2026-05-30 · **Status:** DRAFT for founder review (v1.1 incorporates founder corrections) · **Scope:** how tenant data is stored, how agents learn, how tenants are isolated. Architecture/security canon — also the **architecture spec of record** for the four-layer memory model + promotion gate.
**Companion:** `RightHand_Estimate_Contract_and_Consult_v1_2026-05-30.md` (build-facing front half).
**Evidence base:** `_research/RightHand_MultiTenant_Learning_Isolation_Research_2026-05-30.md` + the inline citations in Appendix A.
**Builds on:** D-048 (tenant-private constraint), D-045 (group-darted + third-party audit).

**v1.1 changelog (founder corrections 2026-05-30):** (1) citations inlined (Appendix A); (2) learning-signal event names relabeled **target architecture**, not current code; (3) DP ε ≤ 1 framed as Right Hand's product default, not a universal standard; (4) embeddings-are-sensitive promoted to a hard rule; (5) added retention/deletion (§6); (6) added observability/egress-leakage (§5 + Wall 12); (7) added the universal stored-fact field envelope (§1).

---

## 0. The two facts this canon is built on

1. **Model weights memorize and leak their training content** (verified, high confidence — Appendix A, C1–C5). A shared model fine-tuned on one tenant's data and served to others is never safe. Only **content-free structure** crosses the customer boundary.
2. **"Anonymized/aggregated" is not automatically safe** (Appendix A, R1–R8). De-identified sharing needs differential privacy + cohort + composition controls — V2+.

> **The line:** *Tenant data teaches that tenant's Right Hand directly. The platform only learns shared structure through gated, content-free Plays.*

This posture is the industry default (OpenAI/Anthropic/Microsoft/Google/Salesforce/Glean run per-tenant isolation, no cross-customer training — Appendix A, M1–M9).

---

## 1. The stored-fact envelope (every record in every layer carries this)

Every stored fact — evidence, typed memory, learning signal, approved memory — carries a uniform metadata envelope. This is what makes locality, drift-protection, deletion, and training-eligibility enforceable rather than aspirational.

| field | meaning | enum / shape |
|---|---|---|
| `tenant_id` | owning tenant-group (the isolation key) | id; composite PK `(tenant_id, id)` |
| `locality` | how far this may travel | `tenant_private` · `org_shared` · `platform_structural` · `shared_corpus` (§3) |
| `source_class` | provenance class — **two taxonomies, don't conflate** | for priced data: the **D-035 pricing ranking** (`PROJECT_ACTUAL` … `MODEL_INFERENCE`); for operational evidence: the **evidence class** (`PROJECT_EVIDENCE`, …) |
| `capture_channel` | how the evidence arrived | `sms` · `voice` · `photo` · `lidar` · `manual` · `import` |
| `evidence_kind` | what kind of evidence | `crew_text` · `transcript` · `photo` · `scan` · `doc` |
| `stated_by` | who asserted it | actor id (e.g. `crew_member_id`, `owner_id`) |
| `source_refs[]` | pointers to the evidence backing this fact | uri + optional excerpt |
| `state` | truth state | `confirmed` · `tenant_rule` · `market_verified` · `measured` · `allowance` · `assumed` · `stale` · `missing` |
| `freshness` | when verified + its window | verified_at + ttl; past ttl ⇒ `state=stale` |
| `visibility` | who may see it | per memory-exposure doctrine (background / inspectable / editable-by-consequence) |
| `consequence_tier` | reversibility of acting on it | `reversible` · `durable_record` · `money` · `send` · `memory` · `irreversible` (gates the draft/execution split; a persisted operational record like a Daily Log = `durable_record`) |
| `training_eligibility` | may this train a model, and which | `none` · `tenant_private_only` · `structural_only` · `shared_corpus_consented` |
| `schema_version` | the contract version this was written under | semver |
| `promotion_status` | where it sits on the path to "known-true" / shared | `candidate` · `tenant_approved` · `play_promoted` |

`training_eligibility` is the field that operationalizes the no-weight-leak rule: a fact tagged `tenant_private_only` can train *that tenant's* adapter and nothing else; only `structural_only` artifacts feed anything shared.

**Model-extracted facts additionally carry `parse_confidence` + `filing_disposition`** (`auto_file` · `needs_pm_review` · `needs_disambiguation`), so a low-confidence or ambiguous extraction does not harden into trusted operational truth without review. This applies to any model-parsed fact (daily-log ingest, draft synthesis, etc.) — canonical routing in the Daily Log SMS spec §3.A.

---

## 2. Four memory layers — pattern per layer

| Layer | Holds | Storage / isolation pattern | Design-against |
|---|---|---|---|
| **1 · Tenant Evidence** | raw immutable capture (transcripts, photos, estimates) | per-tenant silo/namespace · RLS + composite `(tenant_id, id)` keys · per-tenant envelope encryption (crypto-shred) · **embeddings encrypted & treated as plaintext-sensitive (hard rule, §4)** · immutable + identity-bound reads (transcript canon: original immutable + edits overlay) | embedding inversion; over-scoped storage credentials |
| **2 · Typed Business Memory** | structured facts/rules (labor rates, markups, prefs) | per-tenant scoped store · scoped queries + RLS backstop · governed by the validator wall | one missed `tenant_id` filter; join to an unprotected table |
| **3 · Learning Signals** | corrections, approvals, rejections, outcomes | per-tenant, never pooled raw · feeds the promotion gate | treating signals as shareable before promotion |
| **4 · Approved Memory / Plays** | promoted durable memory + reusable Plays | splits by `locality` (§3) · only content-free Plays cross the customer wall, only via the promotion gate (§3) | promotion that smuggles content; small-cohort leaks |

**Target event contract for Layer 3 (NOT current code).** The intended learning-loop event set — specified in the Phase 1H Multimodal Draft Path brief — is `learning_signal.captured → memory_update.proposed → memory_update.confirmed`, where the operator's confirm hardens a lesson. **Current code differs** (it appears to emit `learning_signal.drafted`, and the `memory_update.*` events are not yet landed). Treat the three-event chain as the **target architecture**; closing the gap (adding the `memory_update.*` typed contracts + the confirm step) is a build item, not a description of today.

**Subjective "feel" (discounting gradient, pricing instinct):** tenant-private, Layer 4, stored as a **confidence-scored, inspectable profile** under the judgment edit-category — never baked into shared weights, never stored as deterministic truth.

**Drift protection (the "known-true" guarantee):** a fact earns the word *true* only through determination — `source_class` provenance + a confidence/`state` + the promotion gate. `candidate` and `tenant_approved` are **different `promotion_status` values with a reviewed gate between them.** Nothing self-promotes.

---

## 3. The four-locality axis

| `locality` | Crosses? | Contains | Guardrail |
|---|---|---|---|
| `tenant_private` | never | facts, rules, feel, **and any tenant-trained weights/LoRA adapters** | per-tenant adapters over a frozen base, never cross-loaded, **never merged into the shared base** |
| `org_shared` | within one owner's BUs only (GGR/Valle/HPG) | memory shared across business units of one tenant-group | legitimate — one organization; still walled from every other customer |
| `platform_structural` | **yes, now** | content-free Plays, schemas, procedures, recognition logic, owner-authored prompts | the only robustly-safe cross-customer channel; must pass the structure-only gate + independent content scan |
| `shared_corpus` | **V2+, consent-gated** | de-identified examples distilled from tenant data | DP + cohort-k + diversity + composition budget + human gate (see ε note below) |

**The meta-capability line, precise:** "the agent gets better at understanding any operator" is shareable **as procedure/structure** (it knows to elicit and model a discounting gradient) — *not* as weights trained on a tenant's content (which would reconstruct that tenant's gradient). Test for anything crossing the customer wall: *can it carry or reconstruct any tenant's facts?* Yes → private/V2+. Pure procedure/schema/Play → `platform_structural`, now.

**On the DP epsilon (product policy, not a universal law).** Right Hand's conservative **product default is ε ≤ 1** for any cross-tenant aggregate. NIST SP 800-226 does **not** set a universal threshold — it requires meaningful evaluation of the (ε, δ), the unit of privacy, and the accounting, and warns that loose settings (it flags ε > 10) may provide no meaningful protection. So ε ≤ 1 is *our* line for a defensible default; the canonical requirement is "evaluate epsilon meaningfully," and ours is set conservative.

---

## 4. The promotion gate — candidate → shared Play

A candidate clears all gates before it crosses the customer boundary (classify-before-harden, extended):

- **Structure-only:** schema not instance · no verbatim traces · parameterize-don't-embed · **independent content scan** by a non-builder/separate pass.
- **Cohort** (if any tenant statistic informs it): minimum *distinct-tenant* k on the quasi-identifier combination (50 jobs in one tenant = n=1) · diversity check (reject homogeneous cohorts) · outlier exclusion.
- **Aggregate-safety:** aggregation necessary not sufficient · DP noise (ε ≤ 1 product default) on numeric aggregates · **composition budget across the whole Play library** · no hashed/pseudonymized join keys.
- **Human:** approval before first cross-tenant publication · provenance + recall (unpublish + reclaim budget on objection/leak).

---

## 5. The hardening walls (enforced in code/infra, never in the prompt)

Each must **fail closed** and carry `tenant_id` from the server-side session — never a client parameter or model output.

1. **Identity / request-context** — resolve `tenant_id` from the authenticated session at the edge.
2. **Authorization (complete mediation)** — every action checked downstream, not by the LLM.
3. **Database** — scoped queries **+** RLS **+** composite `(tenant_id, id)` keys.
4. **Cache / Blackboard** — keys namespaced `tenant:{id}:…` and **identity-bind every read** (the Mar-2023 ChatGPT/Redis leak was a cache bug — A:M-incident).
5. **Vector / RAG retrieval** — **per-tenant collections/namespaces over shared-index filters**; missing filter ⇒ empty result, never match-all; **filter before similarity ranking**.
6. **Model-context / inference** — clear context between tenant requests; **no shared-model fine-tune on tenant data**; **cross-tenant KV/prefix-cache sharing OFF** or partitioned (NDSS-2025 side channel — invisible to app tests, needs provider attestation).
7. **Tool / agent-permission** — least privilege + least functionality; tools run in the user's auth context.
8. **Autonomy / human-in-the-loop** — irreversible actions require confirmation (existing Right Hand guardrails).
9. **Memory / persistence** — long-term memory, learned facts, derived state namespaced by tenant; background jobs never batch-mix tenants.
10. **Encryption (defense in depth)** — per-tenant keys at rest; logical-isolation failure degrades to ciphertext.
11. **Logging / audit** — immutable logs of `requester_tenant_id` vs `accessed_tenant_id`; cross-tenant access is detectable (and the SOC 2 trail).
12. **Observability / egress** — **tenant data leaks the telemetry plane before it leaks the database.** App logs, traces, error reports (Sentry-class), analytics/eval datasets, support tooling, screenshots, and browser/local storage must all be tenant-scoped or scrubbed. No raw tenant content, transcripts, PII, or embeddings in logs/traces/error payloads; no client-side persistence of tenant data beyond the session; eval datasets are tenant-tagged and consent-gated; support-tool access is logged and least-privilege.

> **HARD RULE — embeddings are sensitive.** Vectors are plaintext-derived tenant data, reconstructable to source text (few-shot/zero-shot black-box inversion, no working defense — Appendix A, E1–E4). Treat every embedding as sensitive as the source text: encrypt at rest, tenant-scope, never log, never export in bulk, never place in a shared index as a "filter-only" boundary.

**Principle:** make isolation *architecturally difficult to violate*, not *procedurally required*.

---

## 6. Retention, deletion & tenant data rights (buyers will ask)

Deletion and export are first-class, not afterthoughts. Per layer and per surface:

- **Tenant export** — a tenant can export their evidence + typed memory + approved memory in a documented format, on request.
- **Crypto-shred deletion** — per-tenant envelope keys mean tenant deletion = destroy the tenant's data key ⇒ data unrecoverable (also satisfies "right to deletion"). This is the primary deletion mechanism for at-rest data.
- **Vector deletion** — deleting a tenant's records must delete their **embeddings and index entries**, not just the source rows. A deletion that leaves vectors behind leaves reconstructable content behind (embeddings are sensitive, §4).
- **Backup retention** — define the backup TTL; crypto-shred must extend to backups (key destruction covers backups encrypted under that key); document the maximum window before a deleted tenant is fully gone from backups.
- **Logs / traces / telemetry deletion** — the egress plane (§5 Wall 12) has its own retention TTL and deletion path; tenant deletion must purge or anonymize tenant-identifiable log/trace/eval data within a stated window.
- **Learning-derived deletion** — if a tenant deletes, their `tenant_private_only` learned profile/adapter is destroyed; any `platform_structural` Play that was already content-free is unaffected (it carried no tenant content by construction); any `shared_corpus` contribution is governed by the consent + recall path (promotion gate §4).
- **`promotion_status` + recall** — deletion respects the recall path: a promoted Play traced to a now-deleted tenant is re-reviewed/unpublished if it ever carried tenant-derived content.

---

## 7. Blackboard reconciliation

The **Blackboard is the coordination + routing substrate** (it holds the working chain — what was heard, inferred, sourced, checked — and the routing envelopes, persistently enough to audit). The **four memory layers are the knowledge substrate.** The chain runs on the Blackboard; its useful outputs are *promoted* into evidence, typed memory, learning signals, or audit. This refines architecture principle 6 (Apr 23: "persistent memory + storage layer for routing envelopes") rather than overturning it. (Recommended as a decision entry so the two definitions don't fight later.)

**Two "fours" do not collide:** the four *storage layers* (evidence/typed/signals/approved) are a lifecycle split; the memory-exposure doctrine's four *categories* (data/judgment/identity/derived-state) are an edit-rule taxonomy. Orthogonal.

---

## 8. Verification (how isolation is proven)

The exact tests live in the companion build brief: `_docs/operations/dispatch_prompts/RightHand_Tenant_Isolation_CI_Suite_2026-05-30.md`. Headlines: CI-gated adversarial cross-tenant suite every deploy (same-`user_id` cross-tenant retrieval → zero rows; colliding cache keys → no bleed; semantic search targeting another tenant → only own rows; cross-tenant JOIN blocked by RLS; IDOR denied; KV/context-bleed checks); independent pen test by a non-builder (D-045); inference-provider attestation on KV/prefix-cache; SOC 2 evidence package instrumented now. **Make the Week-4 "3-tenant boundary verification" adversarial + CI-gated, not one-time.**

---

## 9. Canon elevation (founder-recommended 2026-05-30)

1. **Decision — four-locality axis** → drafted as **D-051** (`tenant_private` · `org_shared` · `platform_structural` · `shared_corpus`); refines D-048.
2. **Architecture spec — four-layer memory model + promotion gate + stored-fact envelope** → **this document is the spec of record.**
3. **Build brief — adversarial tenant-isolation CI suite** → drafted at `_docs/operations/dispatch_prompts/RightHand_Tenant_Isolation_CI_Suite_2026-05-30.md`.
4. (carried) **Blackboard reconciliation** → recommend a small decision entry (§7).

---

## Appendix A — inline citations (URL · date · confidence)

**Weights memorize/leak (the core finding):**
- C1 — Carlini et al., "Extracting Training Data from LLMs," USENIX Security 2021 — https://www.usenix.org/system/files/sec21-carlini-extracting.pdf — 2021 — **very high**
- C2 — Carlini et al., "Quantifying Memorization Across Neural Language Models," 2022 — https://arxiv.org/abs/2202.07646 — 2022 — **very high**
- C3 — Nasr/Carlini et al., divergence attack extracting training data from production ChatGPT — https://arxiv.org/abs/2311.17035 — 2023 — **very high**
- C4 — "TMI! Finetuned Models Leak Private Information from their Pretraining Data," PoPETs 2024 — https://petsymposium.org/popets/2024/popets-2024-0075.pdf — 2024 — **high**
- C5 — Deep Leakage from Gradients (gradients are reconstructable; FL ≠ private) — https://arxiv.org/abs/1906.08935 — 2019 — **very high**

**Embeddings are sensitive (invertible):**
- E1 — Morris et al., embedding inversion recovering ~92% of 32-token inputs — survey arXiv:2411.10023 — 2023 — **high**
- E2 — ALGEN, few-shot black-box embedding inversion; tested defenses failed — https://arxiv.org/abs/2502.11308 — 2025 — **high**
- E3 — OWASP LLM08:2025 Vector & Embedding Weaknesses ("neither GenAI apps nor vector DBs natively enforce permissions") — https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/ — 2025 — **high**

**Anonymized/aggregated ≠ safe:**
- R1 — de Montjoye, "Unique in the Crowd" (4 points → 95% unique), Nature Sci Rep — https://www.nature.com/articles/srep01376 — 2013 — **high**
- R2 — Narayanan & Shmatikov, Netflix de-anonymization — https://arxiv.org/abs/cs/0610105 — 2006 — **high**
- R3 — Sweeney k-anonymity / governor re-identification (textbook) — https://programming-dp.com/chapter2.html — 2002/2025 — **high**
- R4 — FTC, "No, hashing still doesn't make your data anonymous" — https://www.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/07/no-hashing-still-doesnt-make-your-data-anonymous — 2024 — **high**
- R5 — NIST SP 800-226, Guidelines for Evaluating Differential Privacy Guarantees (final; evaluate ε meaningfully, ε>10 may be meaningless) — https://csrc.nist.gov/pubs/sp/800/226/final — 2025-03 — **high**
- R6 — Google, "Private analytics via zero-trust aggregation" (aggregation + TEE + DP; aggregation necessary not sufficient) — https://research.google/blog/private-analytics-via-zero-trust-aggregation/ — 2026-05 — **high**

**Differential privacy / fine-tuning tax / adapters:**
- D1 — "Revisiting Privacy, Utility, Efficiency Trade-offs when Fine-Tuning LLMs" (DP-SGD ~20x cost; LoRA tolerates DP) — https://arxiv.org/html/2502.13313 — 2025 — **high**
- D2 — multi-LoRA per-tenant serving + cross-tenant adapter/KV contamination risk — https://louisphilip.medium.com/multi-lora-serving-how-to-run-hundreds-of-ai-tenants-on-a-single-gpu-07143f1e36f1 — 2026 — **medium-high** (practitioner; mechanism sound)
- D3 — Deduplication reduces memorized emission ~10x — https://arxiv.org/abs/2107.06499 — 2022 — **very high**

**Isolation / hardening:**
- H1 — OWASP Top 10 for LLM Apps 2025 (LLM01 injection, LLM02 sensitive-info-disclosure, LLM06 excessive agency, LLM08 vector/embedding) — https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf — 2025 — **high**
- H2 — NIST AI 600-1 Generative AI Profile (data leakage, de-anon, memorization named) — https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf — 2024 — **high**
- H3 — PromptLeak/PromptPeek: prompt leakage via KV-cache sharing in multi-tenant LLM serving, NDSS 2025 — https://www.ndss-symposium.org/ndss-paper/i-know-what-you-asked-prompt-leakage-via-kv-cache-sharing-in-multi-tenant-llm-serving/ — 2025 — **high**
- H4 — AWS SaaS Tenant Isolation Strategies (silo/pool/bridge) — https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-bridge-model.html — current — **high**
- H5 — Pinecone multitenancy (namespaces = security-first; metadata filter is not an isolation boundary) — https://docs.pinecone.io/guides/index-data/implement-multitenancy — current — **high**
- H6 — Supabase RLS docs / bypass modes (service_role, SECURITY DEFINER, views, JWT claims) — https://supabase.com/docs/guides/database/postgres/row-level-security — current — **high**

**Market defaults / incidents:**
- M1 — OpenAI API data-usage (no training on business/API data by default) — https://help.openai.com/en/articles/5722486-api-data-usage-policies — current — **high**
- M2 — Anthropic commercial terms / no training on commercial data, ZDR — https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training — current — **high**
- M3 — Microsoft 365 Copilot architecture (tenant-scoped, honors RBAC) — https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture — current — **high**
- M4 — Salesforce Einstein Trust Layer (ZDR with LLM providers) — https://help.salesforce.com/s/articleView?id=ai.generative_ai_trust_arch.htm — current — **high**
- M5 — Glean permission-aware retrieval (filter before the model) — https://www.glean.com/blog/secure-generative-ai-for-the-enterprise-requires-the-right-permissions-structure — current — **high**
- M-incident — OpenAI Mar-2023 Redis cache cross-user leak post-mortem (cache bug; fix = identity-bind cache reads) — https://openai.com/blog/march-20-chatgpt-outage — 2023 — **high**

> **Integrity note:** a widely-circulated "Pinecone CVE-2024-41892 / Salesforce 2024 cross-tenant / 200k healthcare records" claim was **verified as fabricated** (the CVE number belongs to an unrelated Craft CMS issue; no advisory/press/NVD record). Excluded. Do not cite.

---

## Cross-references
- Research: `_research/RightHand_MultiTenant_Learning_Isolation_Research_2026-05-30.md`
- Companion build-facing: `RightHand_Estimate_Contract_and_Consult_v1_2026-05-30.md`
- CI build brief: `_docs/operations/dispatch_prompts/RightHand_Tenant_Isolation_CI_Suite_2026-05-30.md`
- D-051 (four-locality axis) · D-048 · D-045 · D-035 · memory-exposure doctrine (principle 7) · `kerf_blackboard_dual_lens_projection` · `feedback_belt_and_suspenders_trust_discipline` · `feedback_agent_names_not_in_operator_copy`

*DRAFT v1.1, 2026-05-30. Architecture spec of record for the four-layer model + promotion gate + stored-fact envelope. Companion decision D-051 and the CI build brief make it operational.*
