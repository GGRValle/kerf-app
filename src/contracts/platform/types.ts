import type { Actor, Cents, ISO8601 } from '../../blackboard/types.js';

// ============================================================================
// Kerf ↔ Platform interface contract — VERSIONED.
//
// Boundary:
//   Kerf owns: UI + Blackboard + agents.
//   Platform owns: money writes, audit-of-record, QBO sync.
//
// Kerf calls Platform over REST (types below).
// Platform notifies Kerf via webhooks (PlatformWebhook).
//
// All money = integer cents. Never floats.
// All timestamps = ISO 8601 UTC.
// ============================================================================

export const KERF_PLATFORM_CONTRACT_VERSION = '2026-04-23.0' as const;

// ---------- Kerf → Platform ----------

export interface PlatformClient {
  attestCreate(req: AttestCreateReq): Promise<AttestCreateRes>;
  moneyPropose(req: MoneyProposeReq): Promise<MoneyProposeRes>;
  moneyApprove(req: MoneyApproveReq): Promise<MoneyApproveRes>;
  auditEvent(req: AuditEventReq): Promise<AuditEventRes>;
}

// Attest + create — Kerf registers a locked-of-record entity with Platform.
// Platform mints its own ID and returns it; Kerf stores the mapping.
export interface AttestCreateReq {
  kerfEntityId: string;
  kind: 'project' | 'proposal' | 'change_order' | 'consent_record';
  actor: Actor;
  at: ISO8601;
  payload: Record<string, unknown>;
}
export interface AttestCreateRes {
  platformEntityId: string;
  acceptedAt: ISO8601;
}

// Money proposed — Kerf agents (or humans) propose; Platform records the proposal.
export interface MoneyProposeReq {
  kerfEntityId: string;
  amountCents: Cents;
  description: string;
  actor: Actor;
  sources: string[];         // source-ref ids from Blackboard (trust chain)
  at: ISO8601;
}
export interface MoneyProposeRes {
  proposalId: string;
  acceptedAt: ISO8601;
}

// Money approved — human approval captured. Platform writes the approval to the
// audit log and emits `money.locked` webhook when QBO sync completes.
export interface MoneyApproveReq {
  proposalId: string;
  approver: Actor;
  at: ISO8601;
  redline?: {
    before: unknown;
    after: unknown;
    reason: string;          // approval-gate authoring surface output
  };
}
export interface MoneyApproveRes {
  approvalId: string;
  lockedAt: ISO8601;
}

// Generic audited event — for non-money actions that still need audit-of-record.
export interface AuditEventReq {
  kerfEventId: string;
  kind: string;
  actor: Actor;
  entityId: string;
  at: ISO8601;
  payload: Record<string, unknown>;
}
export interface AuditEventRes {
  auditId: string;
  acceptedAt: ISO8601;
}

// ---------- Platform → Kerf (webhooks) ----------

export type PlatformWebhook =
  | { kind: 'money.locked'; proposalId: string; approvalId: string; at: ISO8601 }
  | { kind: 'audit.locked'; kerfEventId: string; auditId: string; at: ISO8601 }
  | { kind: 'qbo.synced'; platformEntityId: string; qboRef: string; at: ISO8601 };

export interface PlatformWebhookHandler {
  (webhook: PlatformWebhook): Promise<void>;
}
