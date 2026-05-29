// Tenant synthesis consent — the data-into-model gate (D-049 §6).
//
// Per D-049 §6 ("Data discipline at the layer boundary"), tenant captures may
// flow INTO a hosted model only when the tenant has `tenant_synthesis_consent:
// true`. The Right Hand Voice Overlay (right_hand_voice_overlay_spec_2026-05-29
// §10) applies the same gate to the realtime transcription session: live mic
// audio is streamed to OpenAI only for consenting tenants. Non-consenting
// tenants fall back to Groq record-then-send (`/api/v1/transcribe`) — no audio
// is streamed to a frontier vendor.
//
// V1 SCOPE: a fixture-backed registry, intentionally simple and explicit, like
// `tenant/store.ts`. GGR is the only consenting tenant for the internal launch.
// Default is DENY — a tenant must be explicitly listed to be granted consent,
// so a new/unknown tenant never silently streams audio to a vendor.
//
// V1.5+ replaces this with a per-tenant settings row; the boundary (server-
// authoritative `hasSynthesisConsent(tenantId)`) does not change.

import type { EntityId } from '../blackboard/types.js';

/**
 * Tenants that have granted synthesis consent for V1. Explicit allow-list:
 * GGR (the dogfood tenant) only. Everything else falls back to Groq
 * record-then-send.
 */
export const SYNTHESIS_CONSENT_TENANTS: readonly EntityId[] = [
  'tenant_ggr' as EntityId,
];

/**
 * Server-authoritative consent check. The client never decides its own
 * eligibility — the ephemeral-token endpoint calls this and returns 403 +
 * `fallback: 'groq_record_then_send'` when it returns false.
 *
 * Default DENY: unknown / unlisted tenants return false.
 */
export function hasSynthesisConsent(tenantId: EntityId | string): boolean {
  return SYNTHESIS_CONSENT_TENANTS.includes(tenantId as EntityId);
}

/** The fallback transcript path a non-consenting tenant uses. */
export const SYNTHESIS_CONSENT_FALLBACK = 'groq_record_then_send' as const;
export type SynthesisConsentFallback = typeof SYNTHESIS_CONSENT_FALLBACK;
