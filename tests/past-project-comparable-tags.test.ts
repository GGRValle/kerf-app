// Phase 0 intake tagging on PastProjectComparable — Thread 6.5.
//
// Verifies that every comparable in every onboarding-session fixture carries
// valid `project_type_tag` + `scope_tags` per the closed taxonomy from
// PR #126. Without these, variance-band lookups would degrade to free-text
// matching on `scopeSummary` (lossy) or no match at all.
//
// Tests reuse `validateProjectTags` from src/projects/index.ts — no separate
// validator is needed because PastProjectComparable is structurally
// assignable to ProjectTags once it carries the two fields.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_TYPE_TAGS,
  SCOPE_TAGS,
  validateProjectTags,
  type ProjectTags,
} from '../src/projects/index.js';
import { ValidationError } from '../src/shared/index.js';
import {
  ggrOnboardingSession,
  valleOnboardingSession,
  ggrOnboardingSessionSkeletonFixture,
} from '../src/test-fixtures/index.js';
import type {
  OnboardingAnswerPastProjectExamples,
  PastProjectComparable,
} from '../src/onboarding/index.js';

// ──────────────────────────────────────────────────────────────────────────
// Helpers — fish the past_project_examples answer out of each session.
// ──────────────────────────────────────────────────────────────────────────

function comparablesFromSession(session: {
  answers: readonly { kind: string }[];
}): readonly PastProjectComparable[] {
  const answer = session.answers.find((a) => a.kind === 'past_project_examples') as
    | OnboardingAnswerPastProjectExamples
    | undefined;
  assert.ok(answer, 'session should include a past_project_examples answer');
  return answer.payload.examples;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-session tag presence + validity.
// ──────────────────────────────────────────────────────────────────────────

test('every GGR fixture comparable carries valid project_type_tag + scope_tags', () => {
  const comparables = comparablesFromSession(ggrOnboardingSession);
  assert.equal(comparables.length, 7, 'GGR fixture expected to seed 7 comparables');
  for (const c of comparables) {
    assert.doesNotThrow(
      () => validateProjectTags(c),
      `GGR comparable "${c.projectLabel}" failed tag validation`,
    );
    assert.ok(PROJECT_TYPE_TAGS.includes(c.project_type_tag));
    assert.ok(Array.isArray(c.scope_tags));
    for (const tag of c.scope_tags) {
      assert.ok(SCOPE_TAGS.includes(tag), `scope tag ${tag} not in canonical list`);
    }
  }
});

test('every Valle fixture comparable carries valid project_type_tag + scope_tags', () => {
  const comparables = comparablesFromSession(valleOnboardingSession);
  assert.equal(comparables.length, 7, 'Valle fixture expected to seed 7 comparables');
  for (const c of comparables) {
    assert.doesNotThrow(
      () => validateProjectTags(c),
      `Valle comparable "${c.projectLabel}" failed tag validation`,
    );
    assert.ok(PROJECT_TYPE_TAGS.includes(c.project_type_tag));
    assert.ok(Array.isArray(c.scope_tags));
  }
});

test('the generic skeleton onboarding session comparable carries valid tags', () => {
  const comparables = comparablesFromSession(ggrOnboardingSessionSkeletonFixture);
  assert.equal(comparables.length, 1, 'skeleton fixture expected to seed 1 comparable');
  for (const c of comparables) {
    assert.doesNotThrow(() => validateProjectTags(c));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Brand-typical archetype coverage — guard against silent fixture drift.
// ──────────────────────────────────────────────────────────────────────────

test('GGR fixture covers expected archetype mix (kitchen, primary_bath, multi-room, adu, targeted)', () => {
  const comparables = comparablesFromSession(ggrOnboardingSession);
  const types = new Set(comparables.map((c) => c.project_type_tag));
  assert.ok(types.has('kitchen_remodel'), 'GGR should include at least one kitchen_remodel comparable');
  assert.ok(types.has('primary_bath_remodel'), 'GGR should include at least one primary_bath_remodel comparable');
  assert.ok(types.has('multi_room_remodel'), 'GGR should include at least one multi_room_remodel comparable');
  assert.ok(types.has('adu'), 'GGR should include at least one adu comparable');
  assert.ok(
    types.has('targeted_remodel'),
    'GGR should include at least one targeted_remodel comparable (bounded scope, not a full remodel) ' +
      'so variance bands can discriminate kitchen-typed bounded scope from kitchen_remodel costs',
  );
});

test('Valle fixture covers cabinetry_only + millwork_only archetypes', () => {
  const comparables = comparablesFromSession(valleOnboardingSession);
  const types = new Set(comparables.map((c) => c.project_type_tag));
  assert.ok(types.has('cabinetry_only'), 'Valle should include at least one cabinetry_only comparable');
  assert.ok(types.has('millwork_only'), 'Valle should include at least one millwork_only comparable');
});

// ──────────────────────────────────────────────────────────────────────────
// scope_tags on every comparable: well-formed, no duplicates.
// ──────────────────────────────────────────────────────────────────────────

test('no comparable has duplicate scope_tags', () => {
  const allComparables: PastProjectComparable[] = [
    ...comparablesFromSession(ggrOnboardingSession),
    ...comparablesFromSession(valleOnboardingSession),
    ...comparablesFromSession(ggrOnboardingSessionSkeletonFixture),
  ];
  for (const c of allComparables) {
    const seen = new Set<string>();
    for (const tag of c.scope_tags) {
      assert.ok(!seen.has(tag), `comparable "${c.projectLabel}" has duplicate scope tag ${tag}`);
      seen.add(tag);
    }
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Structural typing check — validateProjectTags accepts a comparable directly.
// ──────────────────────────────────────────────────────────────────────────

test('validateProjectTags accepts a PastProjectComparable directly via structural typing', () => {
  // Sanity: confirm we don't need a separate `validatePastProjectComparable`
  // wrapper. PastProjectComparable has the project_type_tag + scope_tags
  // shape that ProjectTags requires; TS structural typing handles the rest.
  const sample = comparablesFromSession(ggrOnboardingSession)[0];
  assert.ok(sample);
  // `sample` is typed as PastProjectComparable; this call should typecheck
  // and pass at runtime if our type extension is correct.
  const tags: ProjectTags = {
    project_type_tag: sample.project_type_tag,
    scope_tags: sample.scope_tags,
  };
  validateProjectTags(tags);
});

test('validateProjectTags throws when a comparable is hand-mutated to invalid tags', () => {
  // Defensive: confirm the validation we lean on actually catches bad data.
  const tags = {
    project_type_tag: 'roofing_only' as never,
    scope_tags: ['cabinetry'] as const,
  };
  assert.throws(
    () => validateProjectTags(tags),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.message, /roofing_only/);
      return true;
    },
  );
});
