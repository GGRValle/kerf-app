// Phase 0 intake-tagging tests — closed-taxonomy validation for project type
// and scope. Per Thread 6 brief.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_TYPE_TAGS,
  SCOPE_TAGS,
  isProjectTypeTag,
  isScopeTag,
  validateProjectTags,
  type ProjectTags,
  type ProjectTypeTag,
  type ScopeTag,
} from '../src/projects/index.js';
import { ValidationError } from '../src/shared/index.js';
import { PROJECTS } from '../src/test-fixtures/index.js';

// ──────────────────────────────────────────────────────────────────────────
// Type guards
// ──────────────────────────────────────────────────────────────────────────

test('isProjectTypeTag accepts every member of PROJECT_TYPE_TAGS', () => {
  for (const tag of PROJECT_TYPE_TAGS) {
    assert.equal(isProjectTypeTag(tag), true, `expected ${tag} to be a valid ProjectTypeTag`);
  }
});

test('isProjectTypeTag rejects unknown strings, non-strings, and the empty string', () => {
  assert.equal(isProjectTypeTag('garage_remodel'), false);
  assert.equal(isProjectTypeTag('other'), false);
  assert.equal(isProjectTypeTag(''), false);
  assert.equal(isProjectTypeTag(null), false);
  assert.equal(isProjectTypeTag(undefined), false);
  assert.equal(isProjectTypeTag(42), false);
  assert.equal(isProjectTypeTag({ project_type_tag: 'kitchen_remodel' }), false);
});

test('isScopeTag accepts every member of SCOPE_TAGS', () => {
  for (const tag of SCOPE_TAGS) {
    assert.equal(isScopeTag(tag), true, `expected ${tag} to be a valid ScopeTag`);
  }
});

test('isScopeTag rejects unknown strings, non-strings, and the empty string', () => {
  assert.equal(isScopeTag('roofing'), false);
  assert.equal(isScopeTag('other'), false);
  assert.equal(isScopeTag(''), false);
  assert.equal(isScopeTag(null), false);
  assert.equal(isScopeTag(undefined), false);
});

// ──────────────────────────────────────────────────────────────────────────
// validateProjectTags
// ──────────────────────────────────────────────────────────────────────────

test('validateProjectTags accepts a fully-populated valid pair', () => {
  const tags: ProjectTags = {
    project_type_tag: 'kitchen_remodel',
    scope_tags: ['demolition', 'electrical', 'cabinetry'],
  };
  // Should not throw.
  validateProjectTags(tags);
});

test('validateProjectTags accepts empty scope_tags (project just created, scope not yet solidified)', () => {
  const tags: ProjectTags = {
    project_type_tag: 'addition',
    scope_tags: [],
  };
  validateProjectTags(tags);
});

test('validateProjectTags rejects an unknown project_type_tag with a clear ValidationError', () => {
  const tags = {
    project_type_tag: 'garage_remodel' as ProjectTypeTag,
    scope_tags: ['demolition'] as readonly ScopeTag[],
  };
  assert.throws(
    () => validateProjectTags(tags),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /garage_remodel/);
      assert.match(err.message, /closed taxonomy/);
      return true;
    },
  );
});

test('validateProjectTags rejects an unknown scope_tags entry', () => {
  const tags = {
    project_type_tag: 'kitchen_remodel' as ProjectTypeTag,
    scope_tags: ['demolition', 'roofing'] as readonly ScopeTag[],
  };
  assert.throws(
    () => validateProjectTags(tags),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /roofing/);
      return true;
    },
  );
});

test('validateProjectTags rejects duplicate scope_tags', () => {
  const tags: ProjectTags = {
    project_type_tag: 'kitchen_remodel',
    scope_tags: ['demolition', 'electrical', 'demolition'],
  };
  assert.throws(
    () => validateProjectTags(tags),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /duplicate.*demolition/i);
      return true;
    },
  );
});

test('validateProjectTags rejects when scope_tags is not an array (defensive runtime check)', () => {
  const tags = {
    project_type_tag: 'kitchen_remodel' as ProjectTypeTag,
    // Cast to any to bypass TS so we can exercise the runtime guard.
    scope_tags: 'demolition' as unknown as readonly ScopeTag[],
  };
  assert.throws(
    () => validateProjectTags(tags),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /must be an array/);
      return true;
    },
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Fixtures — every seeded project must carry valid tags.
// ──────────────────────────────────────────────────────────────────────────

test('every PROJECTS fixture entry validates against the canonical taxonomy', () => {
  for (const [key, project] of Object.entries(PROJECTS)) {
    // Will throw if any tag is invalid; the assertion message names which
    // fixture failed so test output is actionable.
    assert.doesNotThrow(
      () => validateProjectTags(project.tags),
      `PROJECTS.${key} carries invalid tags`,
    );
  }
});

test('PROJECTS fixtures cover all three brand-typical scopes (kitchen, primary_bath, cabinetry_only)', () => {
  // This is a thin guardrail — if anyone refactors PROJECTS to drop one of the
  // three, variance-band tests downstream will silently lose coverage of that
  // archetype. Keep the explicit assertion so the loss is loud.
  const types = Object.values(PROJECTS).map((p) => p.tags.project_type_tag);
  assert.ok(types.includes('kitchen_remodel'), 'expected at least one kitchen_remodel fixture');
  assert.ok(types.includes('primary_bath_remodel'), 'expected at least one primary_bath_remodel fixture');
  assert.ok(types.includes('cabinetry_only'), 'expected at least one cabinetry_only fixture');
});

// ──────────────────────────────────────────────────────────────────────────
// Closed-union sanity — make sure the constants and types don't drift.
// ──────────────────────────────────────────────────────────────────────────

test('PROJECT_TYPE_TAGS has no duplicates', () => {
  const seen = new Set(PROJECT_TYPE_TAGS);
  assert.equal(seen.size, PROJECT_TYPE_TAGS.length);
});

test('SCOPE_TAGS has no duplicates', () => {
  const seen = new Set(SCOPE_TAGS);
  assert.equal(seen.size, SCOPE_TAGS.length);
});
