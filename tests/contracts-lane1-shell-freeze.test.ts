import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_SHELL_CONTRACT,
  KERF_LANE1_SHELL_CONTRACT_VERSION,
  SHELL_BUSINESS_DOMAINS,
  classifyConsequenceGate,
  validateRegisterSurfaceInput,
  assertSelectionMoneyCents,
} from '../src/contracts/lane1/index.js';
import { readBuildStamp, buildStampPayload } from '../src/shell/buildStamp.js';
import { createInMemorySurfaceRegistry } from '../src/shell/inMemorySurfaceRegistry.js';

test('Lane 1 contract version is frozen', () => {
  assert.equal(KERF_LANE1_SHELL_CONTRACT_VERSION, '2026-06-02.0');
  assert.equal(APP_SHELL_CONTRACT.version, KERF_LANE1_SHELL_CONTRACT_VERSION);
});

test('Contract 1 · shell exposes nine domains and D-059 mobile bar', () => {
  assert.equal(SHELL_BUSINESS_DOMAINS.length, 9);
  assert.deepEqual(APP_SHELL_CONTRACT.mobileBottomBar.slots, [
    'home',
    'create',
    'speak',
    'camera',
    'more',
  ]);
  assert.equal(APP_SHELL_CONTRACT.desktopBottomBar, false);
  assert.equal(APP_SHELL_CONTRACT.conversationPanel.dock, 'right');
});

test('Contract 2 · registerSurface enforces backTo on non-home routes', () => {
  assert.deepEqual(validateRegisterSurfaceInput({
    domain: 'projects',
    route: '/projects/abc',
    roleScope: ['owner'],
    component: 'ProjectDetail',
    backTo: '/projects',
  }), { ok: true });

  const missingBack = validateRegisterSurfaceInput({
    domain: 'projects',
    route: '/projects/abc',
    roleScope: ['owner'],
    component: 'ProjectDetail',
  });
  assert.equal(missingBack.ok, false);

  const homeWithBack = validateRegisterSurfaceInput({
    domain: 'home',
    route: '/',
    roleScope: ['owner'],
    component: 'OwnerHome',
    backTo: '/',
  });
  assert.equal(homeWithBack.ok, false);

  const registry = createInMemorySurfaceRegistry();
  const home = registry.register({
    domain: 'home',
    route: '/',
    roleScope: ['owner', 'pm', 'admin_ops', 'field_hand', 'sub'],
    component: 'RoleHome',
  });
  assert.equal(home.isHome, true);
});

test('Contract 7 · consequence gate — reversible free, durable/money/send confirm', () => {
  assert.equal(classifyConsequenceGate('read').requiresConfirm, false);
  assert.equal(classifyConsequenceGate('answer').requiresConfirm, false);
  assert.equal(classifyConsequenceGate('durable_write').requiresConfirm, true);
  assert.equal(classifyConsequenceGate('money_write').autonomousAllowed, false);
  assert.equal(classifyConsequenceGate('send').autonomousAllowed, false);
});

test('Contract 5 · selection money is integer cents only', () => {
  assert.equal(assertSelectionMoneyCents(12500), 12500);
  assert.throws(() => assertSelectionMoneyCents(12.5));
});

test('build stamp exposes commit + boolean dirty for /health gates', () => {
  const stamp = readBuildStamp();
  assert.equal(typeof stamp.commit, 'string');
  assert.equal(typeof stamp.dirty, 'boolean');
  const payload = buildStampPayload(stamp);
  assert.equal(payload['dirty'], stamp.dirty);
  assert.equal((payload['build'] as { dirty: boolean }).dirty, stamp.dirty);
});
