/**
 * Contract 7 · Consequence gate.
 * Reversible reads/answers are free (no confirm). Durable write is the only place a
 * confirm affordance appears. Money-write and send are never autonomous.
 */
export type ConsequenceTier = 'reversible' | 'durable';

export type ConsequenceActionKind =
  | 'read'
  | 'answer'
  | 'durable_write'
  | 'money_write'
  | 'send';

export interface ConsequenceGateDecision {
  readonly action: ConsequenceActionKind;
  /** True when the operator must explicitly confirm before the action proceeds. */
  readonly requiresConfirm: boolean;
  /** False for money_write and send — always human-gated. */
  readonly autonomousAllowed: boolean;
}

const GATE_TABLE: Record<ConsequenceActionKind, ConsequenceGateDecision> = {
  read: { action: 'read', requiresConfirm: false, autonomousAllowed: true },
  answer: { action: 'answer', requiresConfirm: false, autonomousAllowed: true },
  durable_write: { action: 'durable_write', requiresConfirm: true, autonomousAllowed: false },
  money_write: { action: 'money_write', requiresConfirm: true, autonomousAllowed: false },
  send: { action: 'send', requiresConfirm: true, autonomousAllowed: false },
};

/** Pure classifier — lanes must not invent parallel gating rules. */
export function classifyConsequenceGate(action: ConsequenceActionKind): ConsequenceGateDecision {
  return GATE_TABLE[action];
}

export function tierForAction(action: ConsequenceActionKind): ConsequenceTier {
  return action === 'read' || action === 'answer' ? 'reversible' : 'durable';
}
