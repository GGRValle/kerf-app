import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  APP_SHELL_CONTRACT,
  ATTENTION_ARTIFACT_STATES,
  ATTENTION_STATE_VISUAL,
  KERF_LANE1_SHELL_CONTRACT_VERSION,
  SHELL_BUSINESS_DOMAINS,
  SHELL_ROLE_ROOTS,
  SELECTION_LIFECYCLE_ORDER,
  classifyConsequenceGate,
  validateRegisterSurfaceInput,
  assertSelectionMoneyCents,
  assertSelectionClientVisibility,
  validateProjectSelectionInstance,
  attentionVisualFor,
  type AttentionArtifact,
  type LocalityEnvelope,
  type ProjectSelectionInstance,
  type TwoArtifactPair,
  type WorkArtifactRef,
} from '../src/contracts/lane1/index.js';
import { readBuildStamp, buildStampPayload } from '../src/shell/buildStamp.js';
import { createInMemorySurfaceRegistry } from '../src/shell/inMemorySurfaceRegistry.js';

test('Lane 1 contract version is frozen', () => {
  assert.equal(KERF_LANE1_SHELL_CONTRACT_VERSION, '2026-06-02.1');
  assert.equal(APP_SHELL_CONTRACT.version, KERF_LANE1_SHELL_CONTRACT_VERSION);
});

test('Contract 1 · shell exposes nine domains, D-059 bar, sidebar derivation rule', () => {
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
  assert.equal(
    APP_SHELL_CONTRACT.sidebar.roleVisibilityDerivesFrom,
    'register_surface_role_scope',
  );
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

  const emptyScope = validateRegisterSurfaceInput({
    domain: 'projects',
    route: '/projects',
    roleScope: [],
    component: 'ProjectsIndex',
    backTo: '/',
  });
  assert.equal(emptyScope.ok, false);

  const registry = createInMemorySurfaceRegistry();
  const home = registry.register({
    domain: 'home',
    route: '/',
    roleScope: ['owner', 'pm', 'admin_ops', 'field_hand', 'sub'],
    component: 'RoleHome',
  });
  assert.equal(home.isHome, true);
});

test('Contract 3 · AttentionArtifact five states + frozen visual map', () => {
  assert.deepEqual(ATTENTION_ARTIFACT_STATES, [
    'needs_you',
    'handled',
    'next_options',
    'risk_changed',
    'review_suggested',
  ]);
  assert.deepEqual(Object.keys(ATTENTION_STATE_VISUAL).sort(), [...ATTENTION_ARTIFACT_STATES].sort());
  for (const state of ATTENTION_ARTIFACT_STATES) {
    const visual = attentionVisualFor(state);
    assert.equal(typeof visual.bar, 'string');
    assert.equal(typeof visual.pill, 'string');
    assert.ok(visual.pill.length > 0);
  }
  const sample: AttentionArtifact = {
    id: 'att_1',
    work_artifact_ref: 'work_1',
    state: 'needs_you',
    domain: 'projects',
    headline: 'Review allowance',
    because: 'Over threshold',
    consequence_tier: 'durable',
    source_ref: 'src:fixture',
    role_scope: ['owner'],
    locality: {
      tenant: 'tenant_ggr',
      consequence_tier: 'durable',
    },
  };
  assert.match(JSON.stringify(sample), /work_artifact_ref/);
  assert.doesNotMatch(JSON.stringify(sample), /agent/i);
});

test('Contract 4 · TwoArtifactPair links work_artifact_ref to work.id', () => {
  const work: WorkArtifactRef = {
    id: 'work_1',
    kind: 'job_note',
    locality: { tenant: 'tenant_ggr', consequence_tier: 'durable' },
    surface_route: '/projects/p1',
    created_at: '2026-06-02T00:00:00.000Z',
  };
  const attention: AttentionArtifact = {
    id: 'att_1',
    work_artifact_ref: work.id,
    state: 'handled',
    domain: 'projects',
    headline: 'Filed',
    because: 'Validated path',
    consequence_tier: 'durable',
    source_ref: 'src:voice',
    role_scope: ['owner'],
    locality: work.locality,
  };
  const pair: TwoArtifactPair = { work, attention };
  assert.equal(pair.attention.work_artifact_ref, pair.work.id);
});

test('Contract 5 · Selection cents, lifecycle, line_type, markup visibility, library_ref', () => {
  assert.deepEqual(SELECTION_LIFECYCLE_ORDER, [
    'proposed',
    'approved',
    'ordered',
    'installed',
  ]);
  assert.equal(assertSelectionMoneyCents(12500), 12500);
  assert.throws(() => assertSelectionMoneyCents(12.5));
  assert.deepEqual(assertSelectionClientVisibility('labor', true), { ok: true });
  assert.equal(assertSelectionClientVisibility('markup', true).ok, false);
  assert.deepEqual(assertSelectionClientVisibility('markup', false), { ok: true });
  const leak: Pick<ProjectSelectionInstance, 'line_type' | 'client_visible' | 'amount_cents'> = {
    line_type: 'markup',
    client_visible: true,
    amount_cents: 100,
  };
  assert.equal(validateProjectSelectionInstance(leak).ok, false);
  const ok: Pick<ProjectSelectionInstance, 'line_type' | 'client_visible' | 'amount_cents'> = {
    line_type: 'markup',
    client_visible: false,
    amount_cents: 100,
  };
  assert.deepEqual(validateProjectSelectionInstance(ok), { ok: true });
  const selectionSrc = readFileSync('src/contracts/lane1/selection.ts', 'utf8');
  assert.match(selectionSrc, /readonly library_ref: string/);
  assert.doesNotMatch(selectionSrc, /library_item_id/);
});

test('Contract 6 · locality requires tenant (Wall 1)', () => {
  const envelope: LocalityEnvelope = {
    tenant: 'tenant_ggr',
    bu: 'ggr',
    client: 'client_wegrzyn',
    project: 'proj_1',
    consequence_tier: 'reversible',
  };
  assert.equal(envelope.tenant, 'tenant_ggr');
  assert.equal(SHELL_ROLE_ROOTS.length, 5);
});

test('Contract 7 · consequence gate — reversible free, durable/money/send confirm', () => {
  assert.equal(classifyConsequenceGate('read').requiresConfirm, false);
  assert.equal(classifyConsequenceGate('answer').requiresConfirm, false);
  assert.equal(classifyConsequenceGate('durable_write').requiresConfirm, true);
  assert.equal(classifyConsequenceGate('money_write').autonomousAllowed, false);
  assert.equal(classifyConsequenceGate('send').autonomousAllowed, false);
});

test('build stamp exposes commit + boolean dirty for /health gates', () => {
  const stamp = readBuildStamp();
  assert.equal(typeof stamp.commit, 'string');
  assert.equal(typeof stamp.dirty, 'boolean');
  const payload = buildStampPayload(stamp);
  assert.equal(payload['commit'], stamp.commit);
  assert.equal(payload['dirty'], stamp.dirty);
  assert.equal((payload['build'] as { dirty: boolean }).dirty, stamp.dirty);
});

test('build stamp prefers baked file stamp over mutable runtime env', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-build-stamp-'));
  const stampPath = path.join(dir, 'build-stamp.json');
  const oldCommit = process.env['KERF_BUILD_COMMIT'];
  const oldDirty = process.env['KERF_BUILD_DIRTY'];
  const oldSource = process.env['KERF_BUILD_SOURCE'];
  try {
    await writeFile(
      stampPath,
      JSON.stringify({
        commit: 'file-commit',
        dirty: false,
        built_at: '2026-06-08T19:40:00Z',
      }),
      'utf8',
    );
    process.env['KERF_BUILD_COMMIT'] = 'stale-env-commit';
    process.env['KERF_BUILD_DIRTY'] = 'true';
    process.env['KERF_BUILD_SOURCE'] = 'env';

    const stamp = readBuildStamp({ imageStampPath: stampPath });
    assert.equal(stamp.commit, 'file-commit');
    assert.equal(stamp.dirty, false);
    assert.equal(stamp.source, 'file');
    assert.equal(stamp.built_at, '2026-06-08T19:40:00Z');
    const payload = buildStampPayload(stamp);
    assert.equal((payload['build'] as { source: string }).source, 'file');
    assert.equal((payload['build'] as { built_at: string }).built_at, '2026-06-08T19:40:00Z');
  } finally {
    if (oldCommit === undefined) delete process.env['KERF_BUILD_COMMIT'];
    else process.env['KERF_BUILD_COMMIT'] = oldCommit;
    if (oldDirty === undefined) delete process.env['KERF_BUILD_DIRTY'];
    else process.env['KERF_BUILD_DIRTY'] = oldDirty;
    if (oldSource === undefined) delete process.env['KERF_BUILD_SOURCE'];
    else process.env['KERF_BUILD_SOURCE'] = oldSource;
    await rm(dir, { recursive: true, force: true });
  }
});

test('build stamp checks app-root baked stamp before mutable runtime env', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-root-build-stamp-'));
  const missingBundlePath = path.join(dir, 'dist', 'server', 'build-stamp.json');
  const rootStampPath = path.join(dir, 'build-stamp.json');
  const oldCommit = process.env['KERF_BUILD_COMMIT'];
  const oldDirty = process.env['KERF_BUILD_DIRTY'];
  const oldSource = process.env['KERF_BUILD_SOURCE'];
  try {
    await writeFile(
      rootStampPath,
      JSON.stringify({
        commit: 'root-file-commit',
        dirty: false,
        built_at: '2026-06-14T01:44:50Z',
      }),
      'utf8',
    );
    process.env['KERF_BUILD_COMMIT'] = 'stale-env-commit';
    process.env['KERF_BUILD_DIRTY'] = 'true';
    process.env['KERF_BUILD_SOURCE'] = 'env';

    const stamp = readBuildStamp({ imageStampPath: missingBundlePath, rootStampPath });
    assert.equal(stamp.commit, 'root-file-commit');
    assert.equal(stamp.dirty, false);
    assert.equal(stamp.source, 'file');
  } finally {
    if (oldCommit === undefined) delete process.env['KERF_BUILD_COMMIT'];
    else process.env['KERF_BUILD_COMMIT'] = oldCommit;
    if (oldDirty === undefined) delete process.env['KERF_BUILD_DIRTY'];
    else process.env['KERF_BUILD_DIRTY'] = oldDirty;
    if (oldSource === undefined) delete process.env['KERF_BUILD_SOURCE'];
    else process.env['KERF_BUILD_SOURCE'] = oldSource;
    await rm(dir, { recursive: true, force: true });
  }
});

test('build stamp preserves Fly image ref fallback when no baked file or stamp env exists', () => {
  const oldCommit = process.env['KERF_BUILD_COMMIT'];
  const oldDirty = process.env['KERF_BUILD_DIRTY'];
  const oldSource = process.env['KERF_BUILD_SOURCE'];
  const oldFlyImageRef = process.env['FLY_IMAGE_REF'];
  try {
    delete process.env['KERF_BUILD_COMMIT'];
    delete process.env['KERF_BUILD_DIRTY'];
    delete process.env['KERF_BUILD_SOURCE'];
    process.env['FLY_IMAGE_REF'] = 'registry.fly.io/kerf-v17-internal:deployment-123';

    const stamp = readBuildStamp({ imageStampPath: path.join(tmpdir(), 'missing-build-stamp.json') });
    assert.equal(stamp.commit, 'registry.fly.io/kerf-v17-internal:deployment-123');
    assert.equal(stamp.dirty, true);
    assert.equal(stamp.source, 'fly_image');
  } finally {
    if (oldCommit === undefined) delete process.env['KERF_BUILD_COMMIT'];
    else process.env['KERF_BUILD_COMMIT'] = oldCommit;
    if (oldDirty === undefined) delete process.env['KERF_BUILD_DIRTY'];
    else process.env['KERF_BUILD_DIRTY'] = oldDirty;
    if (oldSource === undefined) delete process.env['KERF_BUILD_SOURCE'];
    else process.env['KERF_BUILD_SOURCE'] = oldSource;
    if (oldFlyImageRef === undefined) delete process.env['FLY_IMAGE_REF'];
    else process.env['FLY_IMAGE_REF'] = oldFlyImageRef;
  }
});
