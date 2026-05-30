# D-051 - Four-Locality Agent Memory Axis

**Status:** LOCKED  
**Date:** 2026-05-30  
**Owner:** Christian Asdal / Right Hand  
**Applies to:** Right Hand multi-tenant memory, agent learning, RAG, vector stores, Plays, and training data promotion.

## Decision

Right Hand uses a four-locality axis for every persisted learning object, memory object, candidate Play, training example, embedding, and reusable rule:

1. `tenant_private`
2. `org_shared`
3. `platform_structural`
4. `shared_corpus`

No memory object may cross a locality boundary unless a deterministic promotion gate explicitly allows that transition.

## Definitions

| Locality | Boundary | May contain | Cross-customer behavior |
|---|---|---|---|
| `tenant_private` | One tenant | Raw evidence, transcripts, photos, documents, estimates, client facts, margin posture, labor rates, tenant-trained adapters, tenant-specific "feel" profiles, corrections, outcomes | Never crosses customers. This is the direct teaching substrate for that tenant's Right Hand. |
| `org_shared` | One legal owner / tenant group | Memory shared across business units owned by the same organization, such as GGR / Valle / HPG dogfood groupings | Allowed only inside the authenticated tenant group. Still isolated from every unrelated customer. |
| `platform_structural` | Platform-wide | Content-free Plays, schemas, procedures, validators, prompt templates authored without tenant facts, recognition logic, deterministic rules | May be shared now if it passes the structure-only gate. This is the primary safe cross-customer learning channel. |
| `shared_corpus` | Platform-wide, consent-gated | De-identified examples or aggregates derived from tenant data | V2+ only. Requires explicit consent, differential privacy or equivalent formal privacy controls for aggregate release, cohort/diversity checks, composition budget, and human approval. |

## Locked Rules

1. **Tenant data teaches that tenant directly.** Tenant evidence, business memory, learning signals, outcomes, and tenant-trained adapters are `tenant_private` by default.
2. **Shared weights may not be trained on tenant-private content by default.** Serving a model to Tenant B after it was trained on Tenant A's content is an unsafe shared-fine-tune pattern unless a later formal shared-corpus consent and privacy gate explicitly allows it.
3. **Shared Plays must be content-free.** A Play may cross tenant boundaries only if it carries procedure, structure, or schema without client names, addresses, dates, dollar amounts, project identifiers, verbatim traces, or tenant-specific constants.
4. **Embeddings are tenant-sensitive.** Embeddings and vector metadata are treated as plaintext-derived tenant data. They inherit the locality and retention rules of the source evidence.
5. **Every stored fact carries the universal envelope.** Locality, source, state, visibility, consequence, training eligibility, retention, and deletion are first-class fields, not prose.
6. **Isolation proof is continuous.** Tenant isolation must be CI-gated and adversarial every deploy. It is not a one-time launch checklist.

## Implementation Targets, Not Current-State Claims

This decision does not claim the following are fully implemented today:

- `memory_update.proposed`
- `memory_update.confirmed`
- Full V10 memory-promotion flow
- Postgres RLS and composite `(tenant_id, id)` keys
- Per-tenant vector namespaces / collections
- Provider attestation for cross-tenant KV or prefix-cache isolation

Those are build targets defined by the architecture spec and CI brief. Current code should be checked directly before any implementation-status statement is made.

## Rationale

Right Hand's moat is tenant-specific business memory plus safe platform-level procedure. The product should learn each contractor deeply without leaking one contractor's world into another contractor's model, retrieval context, logs, caches, or shared weights.

The market default supports this: major AI platforms generally do not train shared models on business customer data by default, and vector/RAG vendors recommend namespace or collection isolation for tenant separation. The security evidence also supports it: model weights can memorize training content, embeddings can leak source information, and "anonymized" or "aggregated" outputs are not automatically safe.

## References

- NIST SP 800-226, *Guidelines for Evaluating Differential Privacy Guarantees*, final March 2025: https://csrc.nist.gov/pubs/sp/800/226/final
- OWASP Top 10 for LLM Applications 2025, including LLM08 Vector and Embedding Weaknesses: https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- Pinecone multitenancy guidance, namespaces for tenant isolation: https://docs.pinecone.io/guides/get-started/implement-multitenancy
- OpenAI business/API data usage default, no training unless opted in: https://openai.com/policies/api-data-usage-policies/
- Kerf Knowledge Graph Schema v0.2: `docs/architecture/kerf_knowledge_graph_schema_v0_2.md`
- Right Hand onboarding protocol: `docs/onboarding/protocol_v0_1.md`
