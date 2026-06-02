# Inference KV / prefix-cache isolation attestation

**Date:** 2026-05-30  
**Owner:** Christian Asdal / GGR Platform  
**Scope:** Kerf V1 internal deploy — Groq (cheap tier) + Claude frontier (abstraction)

## Attestation

Cross-tenant **prompt**, **prefix**, and **KV-cache** sharing is **disabled** (or equivalently **partitioned per tenant/request**) on both inference tiers used by Right Hand and field synthesis.

This addresses NDSS-2025-class side channels where reused prefix state can leak across tenants on shared inference workers.

## Evidence

| Tier | Config artifact | Review cadence |
|------|-----------------|----------------|
| Groq Llama 70B (cheap) | `inference-kv-cache-attestation-groq.yaml` | Re-attest before paid multi-tenant beta |
| Frontier (Claude via abstraction) | `inference-kv-cache-attestation-frontier.yaml` | Re-attest before paid multi-tenant beta |

## CI

`tests/isolation/d-model-context.test.ts` · **D3** fails if these artifacts are missing or empty.

## Limitation

Application tests cannot observe provider-side KV behavior. This attestation is the standing control until provider APIs expose partition attestations.
