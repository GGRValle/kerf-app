/**
 * Wall 2 · RBAC capability map — unit correctness + fail-closed.
 * Pairs with tests/authz-role-enforcement-api.test.ts (the behavioral proof
 * that the gate actually denies field/sub through the real router).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITIES,
  roleHasCapability,
  capabilitiesForRole,
} from '../src/api/authz/capabilities.js';
import { SHELL_ROLE_ROOTS } from '../src/contracts/lane1/domains.js';

test('owner holds every capability', () => {
  for (const cap of CAPABILITIES) {
    assert.equal(roleHasCapability('owner', cap), true, `owner should hold ${cap}`);
  }
});

test('field_hand and sub hold NONE of the sensitive capabilities', () => {
  for (const role of ['field_hand', 'sub'] as const) {
    for (const cap of CAPABILITIES) {
      assert.equal(roleHasCapability(role, cap), false, `${role} must NOT hold ${cap}`);
    }
    assert.deepEqual(capabilitiesForRole(role), [], `${role} capability set must be empty`);
  }
});

test('pm is read-only money — money.read yes; money.write / margin / sales / send no', () => {
  assert.equal(roleHasCapability('pm', 'money.read'), true);
  assert.equal(roleHasCapability('pm', 'money.write'), false);
  assert.equal(roleHasCapability('pm', 'margin.view'), false);
  assert.equal(roleHasCapability('pm', 'sales.view'), false);
  assert.equal(roleHasCapability('pm', 'proposal.send'), false);
});

test('admin_ops runs money + people + portal, but NOT margin or the sales pipeline', () => {
  for (const cap of ['money.read', 'money.write', 'proposal.send', 'user.manage', 'pay.view', 'portal.admin'] as const) {
    assert.equal(roleHasCapability('admin_ops', cap), true, `admin_ops should hold ${cap}`);
  }
  assert.equal(roleHasCapability('admin_ops', 'margin.view'), false);
  assert.equal(roleHasCapability('admin_ops', 'sales.view'), false);
});

test('fails closed — unknown role or unknown capability is denied', () => {
  assert.equal(roleHasCapability('ghost' as never, 'money.read'), false);
  assert.equal(roleHasCapability('owner', 'money.destroy' as never), false);
});

test('money.write holders are exactly owner + admin_ops (no silent widening)', () => {
  const writers = SHELL_ROLE_ROOTS.filter((r) => roleHasCapability(r, 'money.write'));
  assert.deepEqual([...writers].sort(), ['admin_ops', 'owner']);
});

test('margin.view + sales.view are owner-only today', () => {
  for (const cap of ['margin.view', 'sales.view'] as const) {
    const holders = SHELL_ROLE_ROOTS.filter((r) => roleHasCapability(r, cap));
    assert.deepEqual(holders, ['owner'], `${cap} should be owner-only`);
  }
});
