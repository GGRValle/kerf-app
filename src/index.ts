// @kerf/core — W1 surface.
// Everything else (UI, agents, intake, CoS) consumes from this package.

export * from './blackboard/index.js';
export * from './permissions/index.js';
export * from './projections/index.js';
export * from './contracts/index.js';
export * from './shared/index.js';
export * from './i18n/index.js';
export * from './workflows/index.js';
// test-fixtures intentionally NOT re-exported — consume via '@kerf/core/test-fixtures'.
