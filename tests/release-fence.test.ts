import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LINE_COMPONENT_RELEASE_TYPES,
  QUANTITY_USE_LABELS,
  RELEASE_REQUIREMENTS,
  VERIFICATION_STATUSES,
  canReleaseLineComponent,
  isVerificationSensitiveCategory,
  type LineComponentQuantityFence,
} from '../src/releaseFence/index.js';

const VERIFIED_LOG = {
  verification_logged_at: '2026-05-09T12:00:00.000Z',
  verification_method: 'laser_verify',
  verified_by: 'actor_field_super',
} as const;

function component(
  overrides: Partial<LineComponentQuantityFence> = {},
): LineComponentQuantityFence {
  return {
    component_id: 'line_component_1',
    scope_tag: 'cabinetry',
    description: 'Upper cabinet run',
    release_category: 'standard',
    quantity_source: 'scan_derived',
    quantity_use_label: 'estimate_safe',
    release_requirement: 'none',
    verification_status: 'not_required',
    source_metric_id: 'metric_1',
    ...overrides,
  };
}

test('closed release-fence vocabularies expose the canon values', () => {
  assert.deepEqual([...QUANTITY_USE_LABELS], [
    'estimate_safe',
    'verify_before_release',
    'manual_required',
    'n/a',
  ]);
  assert.deepEqual([...RELEASE_REQUIREMENTS], [
    'none',
    'tape_verify',
    'laser_verify',
    'manual_template',
    'supervisor_signoff',
    'multi_method',
  ]);
  assert.deepEqual([...VERIFICATION_STATUSES], [
    'not_required',
    'pending',
    'verified',
    'expired',
  ]);
  assert.ok(LINE_COMPONENT_RELEASE_TYPES.includes('estimate'));
  assert.ok(LINE_COMPONENT_RELEASE_TYPES.includes('purchase_order'));
  assert.ok(LINE_COMPONENT_RELEASE_TYPES.includes('fabrication'));
});

test('estimate_safe can feed estimating without releasing the component for fabrication', () => {
  const cabinet = component({
    release_category: 'cabinetry',
    quantity_use_label: 'estimate_safe',
    verification_status: 'pending',
  });

  const estimate = canReleaseLineComponent(cabinet, 'estimate');
  const fabrication = canReleaseLineComponent(cabinet, 'fabrication');

  assert.equal(estimate.allowed, true);
  assert.ok(estimate.warnings.some((issue) => issue.code === 'release_will_require_verification'));
  assert.equal(fabrication.allowed, false);
  assert.ok(
    fabrication.blocked.some(
      (issue) => issue.code === 'verification_pending',
    ),
  );
  assert.ok(fabrication.required_actions.some((action) => action.code === 'verify_quantity'));
});

test('verify_before_release blocks purchase release until verification is logged', () => {
  const pending = component({
    scope_tag: 'tile',
    release_category: 'standard',
    quantity_use_label: 'verify_before_release',
    release_requirement: 'tape_verify',
    verification_status: 'pending',
  });
  const verified = component({
    ...pending,
    verification_status: 'verified',
    verification_method: 'tape_verify',
    verification_logged_at: '2026-05-09T13:00:00.000Z',
    verified_by: 'actor_pm',
  });

  const blocked = canReleaseLineComponent(pending, 'purchase_order');
  const allowed = canReleaseLineComponent(verified, 'purchase_order');

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blocked[0]?.code, 'verification_pending');
  assert.ok(blocked.required_actions.some((action) => action.code === 'tape_verify'));
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.blocked.length, 0);
});

test('manual_required blocks release until manual verification is logged', () => {
  const manual = component({
    release_category: 'standard',
    quantity_use_label: 'manual_required',
    release_requirement: 'manual_template',
    verification_status: 'verified',
    verification_method: 'laser_verify',
    verification_logged_at: '2026-05-09T13:00:00.000Z',
    verified_by: 'actor_pm',
  });
  const loggedManual = component({
    ...manual,
    verification_method: 'manual_template',
  });

  const blocked = canReleaseLineComponent(manual, 'work_order');
  const allowed = canReleaseLineComponent(loggedManual, 'work_order');

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blocked[0]?.code, 'manual_verification_required');
  assert.ok(blocked.required_actions.some((action) => action.code === 'log_manual_verification'));
  assert.equal(allowed.allowed, true);
});

test('cabinetry, stone, glass, and tight millwork all require verified release logs', () => {
  const categories = ['cabinetry', 'stone', 'glass', 'tight_millwork'] as const;

  for (const release_category of categories) {
    const blocked = canReleaseLineComponent(
      component({
        release_category,
        quantity_use_label: 'n/a',
        verification_status: 'not_required',
      }),
      'fabrication',
    );
    const allowed = canReleaseLineComponent(
      component({
        release_category,
        quantity_use_label: 'n/a',
        release_requirement: 'laser_verify',
        verification_status: 'verified',
        ...VERIFIED_LOG,
      }),
      'fabrication',
    );

    assert.equal(isVerificationSensitiveCategory(release_category), true);
    assert.equal(blocked.allowed, false, `${release_category} should block release`);
    assert.ok(
      blocked.blocked.some(
        (issue) => issue.code === 'sensitive_component_requires_verification',
      ),
      `${release_category} should explain sensitive verification`,
    );
    assert.equal(allowed.allowed, true, `${release_category} should release after verification`);
  }
});

test('expired verification blocks release even when prior log metadata exists', () => {
  const result = canReleaseLineComponent(
    component({
      release_category: 'glass',
      release_requirement: 'multi_method',
      verification_status: 'expired',
      verification_expires_at: '2026-05-01T00:00:00.000Z',
      ...VERIFIED_LOG,
    }),
    'purchase_order',
  );

  assert.equal(result.allowed, false);
  assert.equal(result.blocked[0]?.code, 'verification_expired');
  assert.ok(result.required_actions.some((action) => action.code === 'multi_method_verify'));
});

test('verified release still blocks if method, verifier, or timestamp is missing', () => {
  const result = canReleaseLineComponent(
    component({
      release_category: 'stone',
      release_requirement: 'laser_verify',
      verification_status: 'verified',
      verification_method: 'laser_verify',
    }),
    'fabrication',
  );

  assert.equal(result.allowed, false);
  assert.equal(result.blocked[0]?.code, 'verification_log_incomplete');
});

test('standard estimate_safe components can release when no verification is required', () => {
  const result = canReleaseLineComponent(
    component({
      scope_tag: 'paint',
      release_category: 'standard',
      quantity_source: 'manual_entry',
      quantity_use_label: 'estimate_safe',
      release_requirement: 'none',
      verification_status: 'not_required',
    }),
    'field_install',
  );

  assert.equal(result.allowed, true);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.required_actions.length, 0);
});

test('verified components surface expiration as a warning without blocking current release', () => {
  const result = canReleaseLineComponent(
    component({
      release_category: 'cabinetry',
      release_requirement: 'laser_verify',
      verification_status: 'verified',
      verification_expires_at: '2026-06-01T00:00:00.000Z',
      ...VERIFIED_LOG,
    }),
    'fabrication',
  );

  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some((issue) => issue.code === 'verification_expires'));
});

test('release fence substrate has no RoomPlan integration surface', () => {
  const source = readFileSync(
    new URL('../src/releaseFence/releaseFence.ts', import.meta.url),
    'utf8',
  );
  const types = readFileSync(
    new URL('../src/releaseFence/types.ts', import.meta.url),
    'utf8',
  );

  assert.equal(/RoomPlan|RoomCapture|Apple/i.test(source), false);
  assert.equal(/RoomPlan|RoomCapture|Apple/i.test(types), false);
});
