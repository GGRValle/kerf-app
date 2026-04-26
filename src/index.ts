// @kerf/core — W1 surface.
// Everything else (UI, agents, intake, CoS) consumes from this package.

export * from './blackboard';
export * from './permissions';
export * from './projections';
export * from './contracts';
export * from './shared';
export * from './i18n';
// test-fixtures intentionally NOT re-exported — consume via '@kerf/core/test-fixtures'.
