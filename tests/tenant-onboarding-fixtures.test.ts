import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { OnboardingAnswerClientTypes, OnboardingAnswerMarginRiskGuardrails } from '../src/onboarding/types.js';
import { ONBOARDING_CAPTURE_KINDS } from '../src/onboarding/types.js';
import type { OnboardingSession } from '../src/onboarding/types.js';
import { ggrOnboardingSession } from '../src/test-fixtures/ggrOnboardingSession.js';
import { valleOnboardingSession } from '../src/test-fixtures/valleOnboardingSession.js';

function assertSessionShape(s: OnboardingSession, label: string): void {
  assert.ok(s.sessionId.length > 0, `${label} sessionId`);
  assert.ok(s.tenantId.length > 0, `${label} tenantId`);
  assert.equal(s.answers.length, 12, `${label} twelve captures`);
  const kinds = s.answers.map((a) => a.kind);
  assert.deepEqual(kinds, [...ONBOARDING_CAPTURE_KINDS], `${label} capture order`);
}

function primaryClientSegment(payload: OnboardingAnswerClientTypes['payload']): string {
  let best = payload.segmentWeights[0]?.segment ?? 'mixed_other';
  let bestW = -1;
  for (const row of payload.segmentWeights) {
    const w = row.weightPercentApprox ?? 0;
    if (w > bestW) {
      bestW = w;
      best = row.segment;
    }
  }
  return best;
}

function marginPayload(session: OnboardingSession): OnboardingAnswerMarginRiskGuardrails['payload'] {
  const hit = session.answers.find((a): a is OnboardingAnswerMarginRiskGuardrails => a.kind === 'margin_risk_guardrails');
  assert.ok(hit, 'margin_risk_guardrails answer');
  return hit.payload;
}

const CENT_MONEY_KEYS =
  /(baseWageCentsPerHour|loadedRateCentsPerHour|finalSellPriceCents|soloCeilingSellCents|dollarThresholdCents)\s*:\s*([^,\n]+)/g;

function assertIntegerCentAssignments(fixtureSrc: string, pathLabel: string): void {
  for (const match of fixtureSrc.matchAll(CENT_MONEY_KEYS)) {
    const rhs = match[2]?.trim() ?? '';
    assert.match(rhs, /^[0-9_]+$/, `${pathLabel}: ${match[1]} must be integer cents, got ${rhs}`);
    assert.equal(rhs.includes('.'), false, `${pathLabel}: decimal cents forbidden on ${match[1]}`);
  }
}

test('GGR and Valle overlay fixtures are valid OnboardingSession shapes', () => {
  assertSessionShape(ggrOnboardingSession, 'ggr');
  assertSessionShape(valleOnboardingSession, 'valle');
  const _ggrSatisfies: OnboardingSession = ggrOnboardingSession;
  const _valleSatisfies: OnboardingSession = valleOnboardingSession;
  void _ggrSatisfies;
  void _valleSatisfies;
});

test('fixtures bind distinct tenant ids', () => {
  assert.notEqual(ggrOnboardingSession.tenantId, valleOnboardingSession.tenantId);
});

test('GGR vs Valle margin posture differs at direct-homeowner emphasis (overlay proof)', () => {
  const ggr = marginPayload(ggrOnboardingSession);
  const valle = marginPayload(valleOnboardingSession);

  const ggrDirectRow = ggr.minimumGrossMarginBpsByProjectType.find((r) =>
    r.projectTypeLabel.toLowerCase().includes('direct_homeowner'),
  );
  assert.ok(ggrDirectRow, 'GGR lists direct_homeowner margin row');
  assert.ok(
    ggrDirectRow.minimumGrossMarginBps >= 4000,
    `GGR direct homeowner policy bps ${ggrDirectRow.minimumGrossMarginBps} should be ≥ 4000 (40%)`,
  );

  const valleMax = Math.max(...valle.minimumGrossMarginBpsByProjectType.map((r) => r.minimumGrossMarginBps));
  assert.ok(
    valleMax <= 3500,
    `Valle max policy bps ${valleMax} should be ≤ 3500 to stay below GGR remodel floors`,
  );
});

test('GGR vs Valle primary client segment differs', () => {
  const ggrClient = ggrOnboardingSession.answers.find((a): a is OnboardingAnswerClientTypes => a.kind === 'client_types');
  const valleClient = valleOnboardingSession.answers.find((a): a is OnboardingAnswerClientTypes => a.kind === 'client_types');
  assert.ok(ggrClient && valleClient);
  const pg = primaryClientSegment(ggrClient.payload);
  const pv = primaryClientSegment(valleClient.payload);
  assert.notEqual(pg, pv, `expected distinct primaries, got ${pg} vs ${pv}`);
});

test('each fixture carries at least five past-project comparables', () => {
  for (const session of [ggrOnboardingSession, valleOnboardingSession]) {
    const past = session.answers.find((a) => a.kind === 'past_project_examples');
    assert.ok(past && past.kind === 'past_project_examples');
    assert.ok(past.payload.examples.length >= 5);
  }
});

test('fixture sources use integer cents for monetary fields (no decimal currency literals)', () => {
  const ggrSrc = readFileSync(new URL('../src/test-fixtures/ggrOnboardingSession.ts', import.meta.url), 'utf8');
  const valleSrc = readFileSync(new URL('../src/test-fixtures/valleOnboardingSession.ts', import.meta.url), 'utf8');
  assertIntegerCentAssignments(ggrSrc, 'ggrOnboardingSession.ts');
  assertIntegerCentAssignments(valleSrc, 'valleOnboardingSession.ts');
});

test('fixtures avoid realistic EIN / taxpayer id digit patterns (placeholder only)', () => {
  const einLike = /\b\d{2}-\d{7}\b/;
  for (const rel of ['../src/test-fixtures/ggrOnboardingSession.ts', '../src/test-fixtures/valleOnboardingSession.ts'] as const) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(einLike.test(src), false, `${rel} must not contain XX-XXXXXXX style numeric EIN`);
  }
});
