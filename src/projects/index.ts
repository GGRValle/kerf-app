// Barrel export for the projects module — Phase 0 intake tagging foundation.
// Variance-band computation, project entity composition, and onboarding-flow
// integration all build on top of these types in subsequent threads.

export {
  PROJECT_TYPE_TAGS,
  SCOPE_TAGS,
  isProjectTypeTag,
  isScopeTag,
  validateProjectTags,
  type ProjectTypeTag,
  type ScopeTag,
  type ProjectTags,
} from './types.js';
