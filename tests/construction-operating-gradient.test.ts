import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertFixtureIntegrity,
  blendArchetypeAxes,
  getArchetypeDefinition,
  getConstructionOperatingGradientFixture,
  getDogfoodTenantMapping,
  getReplayCase,
  listReplayCases,
  resolveBlendRuleScore,
  resolveBlendedPosture,
  resolveDogfoodTenantPosture,
  shouldEmphasizeCaptureReviewConfirmation,
  shouldUseDenseListDefaults,
} from '../src/operating-gradient/index.js';

test('construction operating gradient fixture integrity', () => {
  assertFixtureIntegrity();
  const fixture = getConstructionOperatingGradientFixture();
  assert.equal(fixture.id, 'kerf_construction_operating_gradient_v1');
  assert.equal(fixture.archetypes.length, 8);
  assert.equal(fixture.dogfood_tenants.length, 3);
  assert.equal(listReplayCases().length, 10);
});

test('dogfood tenant mapping covers GGR, Valle, and HPG', () => {
  const ggr = getDogfoodTenantMapping('tenant_ggr');
  assert.equal(ggr.primary_archetype, 'gc_remodeler');
  assert.equal(ggr.archetype_mix.length, 2);

  const valle = getDogfoodTenantMapping('tenant_valle');
  assert.equal(valle.primary_archetype, 'cabinet_shop_millwork');

  const hpg = getDogfoodTenantMapping('tenant_hpg');
  assert.equal(hpg.primary_archetype, 'hvac_plumbing_electrical_service');
});

test('blend rules: max rules dominate mixed archetypes', () => {
  const mix = [
    { archetype_id: 'gc_remodeler' as const, weight: 0.7 },
    { archetype_id: 'hvac_plumbing_electrical_service' as const, weight: 0.3 },
  ];

  const density = resolveBlendRuleScore(mix, 'ui_density_compression');
  assert.equal(density, 5);

  const proof = resolveBlendRuleScore(mix, 'proof_irreversibility_weight');
  assert.equal(proof, 5);
});

test('GGR blended posture favors capture confirmation over dense home defaults', () => {
  const posture = resolveDogfoodTenantPosture('tenant_ggr');

  assert.equal(posture.primary_archetype, 'gc_remodeler');
  assert.equal(shouldEmphasizeCaptureReviewConfirmation(posture), true);
  assert.equal(shouldUseDenseListDefaults(posture), false);
  assert.ok(posture.blend_scores.proof_irreversibility_weight >= 5);
});

test('HPG blended posture demands dense list defaults', () => {
  const posture = resolveDogfoodTenantPosture('tenant_hpg');

  assert.equal(posture.primary_archetype, 'hvac_plumbing_electrical_service');
  assert.equal(shouldUseDenseListDefaults(posture), true);
  assert.equal(posture.blend_scores.ui_density_compression, 5);
});

test('weighted blend produces stable per-axis scores', () => {
  const mix = getDogfoodTenantMapping('tenant_valle').archetype_mix;
  const axes = blendArchetypeAxes(mix);
  const posture = resolveBlendedPosture(mix);

  assert.equal(axes.proof_burden, posture.axes.proof_burden);
  assert.ok(axes.proof_burden >= getArchetypeDefinition('cabinet_shop_millwork').axes.proof_burden - 1);
});

test('replay cases carry D-048 classification fields', () => {
  const henderson = getReplayCase('replay_henderson_capture_inversion');
  assert.equal(henderson.tenant_id, 'tenant_ggr');
  assert.equal(henderson.correction_scope, 'one_off');
  assert.ok(henderson.memory_locality.includes('eval_replay_case'));
  assert.ok(henderson.related_events.includes('daily_log.entry_captured'));
});

test('proxy signal event map references existing persistence events', () => {
  const fixture = getConstructionOperatingGradientFixture();
  const scopeMap = fixture.proxy_signal_event_map.scope_summary_edits;
  assert.ok(scopeMap?.existing_events.includes('transcript.reviewed'));
});
