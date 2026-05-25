import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dogfoodTenantSurfacePosture,
  firstArchetypeConsumerSurface,
  getConstructionOperatingGradientFixture,
  resolveBlendRuleScore,
  routeWiringStressCasesForSurface,
  runRouteWiringHarnessForDogfoodTenants,
} from '../src/operating-gradient/index.js';

test('first archetype consumer surface is capture_review per fixture', () => {
  assert.equal(firstArchetypeConsumerSurface(), 'capture_review');
});

test('route-wiring stress cases meet min blend scores at primary archetype weight 1', () => {
  const fixture = getConstructionOperatingGradientFixture();

  for (const stressCase of fixture.route_wiring_stress_cases) {
    const mix = [{ archetype_id: stressCase.primary_archetype, weight: 1 }];
    for (const [ruleId, minScore] of Object.entries(stressCase.min_blend_scores)) {
      assert.ok(
        resolveBlendRuleScore(mix, ruleId as keyof typeof stressCase.min_blend_scores) >=
          (minScore ?? 0),
        `${stressCase.id} rule ${ruleId} below minimum`,
      );
    }
  }
});

test('dogfood tenant harness reports cover all three internal tenants', () => {
  const reports = runRouteWiringHarnessForDogfoodTenants();
  assert.ok(reports.tenant_ggr);
  assert.ok(reports.tenant_valle);
  assert.ok(reports.tenant_hpg);
});

test('capture_review surface exposes Henderson and bilingual stress cases', () => {
  const cases = routeWiringStressCasesForSurface('capture_review');
  const ids = cases.map((entry) => entry.id);
  assert.ok(ids.includes('stress_gc_remodeler_capture_review'));
  assert.ok(ids.includes('stress_solo_onboarding_friction'));
});

test('GGR capture_review posture links to Henderson replay case', () => {
  const snapshot = dogfoodTenantSurfacePosture('tenant_ggr', 'capture_review');
  assert.equal(snapshot.stress_cases.length >= 1, true);

  const hendersonCase = snapshot.stress_cases.find(
    (entry) => entry.id === 'stress_gc_remodeler_capture_review',
  );
  assert.ok(hendersonCase);
  assert.ok(hendersonCase.replay_case_ids.includes('replay_henderson_capture_inversion'));
});

test('HPG home surface stress case targets dispatch churn replay', () => {
  const cases = routeWiringStressCasesForSurface('home');
  const hpgCase = cases.find((entry) => entry.id === 'stress_service_trade_home_density');
  assert.ok(hpgCase);
  assert.ok(hpgCase.replay_case_ids.includes('replay_hpg_dispatch_reschedule_churn'));
});

test('review surface aliases to capture_review stress cases', () => {
  const reviewCases = routeWiringStressCasesForSurface('review');
  const captureCases = routeWiringStressCasesForSurface('capture_review');
  assert.deepEqual(
    reviewCases.map((entry) => entry.id),
    captureCases.map((entry) => entry.id),
  );
});
