// Barrel export for the V1 estimate runner — production entry point.
//
// Composition: tenant store → estimateProject → runPolicyGate →
// event log → DecisionQueue surfacing. See `estimateRunner.ts` for the
// load-bearing flow + honest-blocked-outcomes discipline.

export {
  runEstimate,
} from './estimateRunner.js';

export {
  CrossTenantAccessError,
  RunnerError,
  type EstimateRunResult,
  type RunnerDeps,
  type RunnerInputs,
} from './types.js';
