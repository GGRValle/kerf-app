import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  describeOnboardingAnswerKind,
  ONBOARDING_ANSWER_CONFIDENCES,
  ONBOARDING_CAPTURE_KINDS,
  type OnboardingAnswer,
} from '../src/onboarding/index.js';
import { ggrOnboardingSessionSkeletonFixture } from '../src/test-fixtures/onboardingSession.js';

/** Compile-time exhaustiveness guard for `OnboardingAnswer.kind` (must return a string per arm). */
function probeAnswerKind(answer: OnboardingAnswer): string {
  switch (answer.kind) {
    case 'company_identity':
      return describeOnboardingAnswerKind(answer.kind);
    case 'service_areas':
      return describeOnboardingAnswerKind(answer.kind);
    case 'client_types':
      return describeOnboardingAnswerKind(answer.kind);
    case 'labor_rates':
      return describeOnboardingAnswerKind(answer.kind);
    case 'materials_posture':
      return describeOnboardingAnswerKind(answer.kind);
    case 'vendor_supplier_costs':
      return describeOnboardingAnswerKind(answer.kind);
    case 'crew_roles':
      return describeOnboardingAnswerKind(answer.kind);
    case 'proposal_style':
      return describeOnboardingAnswerKind(answer.kind);
    case 'margin_risk_guardrails':
      return describeOnboardingAnswerKind(answer.kind);
    case 'approval_rules':
      return describeOnboardingAnswerKind(answer.kind);
    case 'source_documents':
      return describeOnboardingAnswerKind(answer.kind);
    case 'past_project_examples':
      return describeOnboardingAnswerKind(answer.kind);
    default: {
      const _never: never = answer;
      return _never;
    }
  }
}

test('OnboardingAnswer discriminated union is exhaustive in switch', () => {
  for (const answer of ggrOnboardingSessionSkeletonFixture.answers) {
    assert.equal(probeAnswerKind(answer), answer.kind);
  }
});

test('skeleton fixture lists twelve captures once each (protocol §3 order)', () => {
  const { answers } = ggrOnboardingSessionSkeletonFixture;
  assert.equal(answers.length, 12);

  const kinds = answers.map((a) => a.kind);
  assert.deepEqual(kinds, [...ONBOARDING_CAPTURE_KINDS]);

  const unique = new Set(kinds);
  assert.equal(unique.size, 12);
  for (const k of ONBOARDING_CAPTURE_KINDS) {
    assert.equal(kinds.filter((x) => x === k).length, 1);
  }
});

test('OnboardingAnswerConfidence is the high | medium | low triad only', () => {
  assert.deepEqual([...ONBOARDING_ANSWER_CONFIDENCES], ['high', 'medium', 'low']);

  const seen = new Set<string>();
  for (const answer of ggrOnboardingSessionSkeletonFixture.answers) {
    seen.add(answer.confidence);
  }
  for (const c of seen) {
    assert.ok(
      c === 'high' || c === 'medium' || c === 'low',
      `unexpected confidence literal ${c}`,
    );
  }
});

test('onboarding types module avoids Dollars branding and documents cents-only money', () => {
  const src = readFileSync(new URL('../src/onboarding/types.ts', import.meta.url), 'utf8');

  assert.match(src, /\bCents\b/);
  assert.equal(/\bDollars\b/.test(src), false);

  // Money-bearing hourly/sell fields must use Cents, not bare number aliases for currency.
  assert.match(src, /baseWageCentsPerHour:\s*Cents/);
  assert.match(src, /loadedRateCentsPerHour:\s*Cents/);
  assert.match(src, /finalSellPriceCents\?:\s*Cents/);
});
