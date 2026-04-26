import type { Actor } from '../blackboard/types';

// Canonical test actors. Use these in smoke runs, unit tests, and demo data.
// Keep the set small — more actors = fuzzier tests.

export const ACTORS = {
  christian: { id: 'u-christian', role: 'owner' },
  moo: { id: 'u-moo-alex', role: 'moo' },
  pm: { id: 'u-pm-jordan', role: 'pm' },
  fieldSuper: { id: 'u-field-ray', role: 'field_super' },
  office: { id: 'u-office-dana', role: 'office' },
  sub: { id: 'u-sub-taylor', role: 'sub' },
  client: { id: 'u-client-clem', role: 'client' },
  estimatorAgent: { id: 'agent-estimator', role: 'owner' },
  cosAgent: { id: 'agent-cos', role: 'owner' },
} as const satisfies Record<string, Actor>;

export type ActorKey = keyof typeof ACTORS;
