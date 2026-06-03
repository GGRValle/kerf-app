/**
 * UI affordances for Contract 7 — wraps frozen classifyConsequenceGate (no parallel rules).
 */
import {
  classifyConsequenceGate,
  type ConsequenceActionKind,
} from '../contracts/lane1/consequenceGate.js';

export function requiresConfirmation(action: ConsequenceActionKind): boolean {
  return classifyConsequenceGate(action).requiresConfirm;
}

export function isAutonomousAllowed(action: ConsequenceActionKind): boolean {
  return classifyConsequenceGate(action).autonomousAllowed;
}

export interface GateAffordance {
  readonly action: ConsequenceActionKind;
  readonly confirmRequired: boolean;
  readonly label: string;
}

export function affordanceForAction(action: ConsequenceActionKind, actionLabel: string): GateAffordance {
  const decision = classifyConsequenceGate(action);
  return {
    action,
    confirmRequired: decision.requiresConfirm,
    label: decision.requiresConfirm ? `Confirm ${actionLabel}` : actionLabel,
  };
}
