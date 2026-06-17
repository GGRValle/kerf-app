import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createSurfaceContext } from '../src/app/lib/surfaceContext.js';
import { DEFAULT_ROLE_ROOT_CONTEXT } from '../src/app/lib/layout-props.js';
import { WIREFRAME_SPINE_MAP } from '../src/app/lib/wireframeSpineMap.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('F-CL0 client create is a Canon graph-write surface with explicit next routes', () => {
  const src = read('src/app/pages/clients/new.astro');
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /surface: 'client'/);
  assert.match(src, /phase: 'create'/);
  assert.match(src, /id="new-client-form"/);
  assert.match(src, /data-next="client"/);
  assert.match(src, /data-next="project"/);
  assert.match(src, /data-next="intake"/);
  assert.match(src, /confirm\(`Create client record/);
  assert.match(src, /\/api\/v1\/clients\?tenant_id=\$\{tenantId\}/);
  assert.match(src, /\/projects\/new\?client_id=\$\{encodeURIComponent\(data\.client_id\)\}/);
  assert.match(src, /\/relay\?src=client_intake&client_id=/);
  assert.doesNotMatch(src, /\/invoice\/issue|record payment|\/api\/v1\/.*send/i);
});

test('F-PR0 project setup carries voice/capture context but writes only after operator confirm', () => {
  const src = read('src/app/pages/projects/new.astro');
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /surface: 'project'/);
  assert.match(src, /phase: fromCamera \? 'capture_route' : 'create'/);
  assert.match(src, /id="rh-project-handoff"/);
  assert.match(src, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(src, /VOICE_CONVERSATION_STORAGE_KEY/);
  assert.match(src, /workingDraft\?\.rawText/);
  assert.match(src, /workingDraft\?\.projectName/);
  assert.match(src, /workingDraft\?\.clientName/);
  assert.match(src, /workingDraft\.scopeFacts\.join/);
  assert.match(src, /data-next="project"/);
  assert.match(src, /data-next="estimate"/);
  assert.match(src, /data-next="daily_log"/);
  assert.match(src, /confirm\(`Create project/);
  assert.match(src, /\/api\/v1\/projects\?tenant_id=\$\{tenantId\}/);
  assert.match(src, /\/estimate\/\$\{data\.project_id\}\?src=project_setup/);
  assert.match(src, /\/projects\/\$\{data\.project_id\}\/daily-log\?src=project_setup/);
  assert.doesNotMatch(src, /\/invoice\/issue|record payment|\/api\/v1\/.*send/i);
});

test('F-DES1/F-DS1 design workspace is a review-gated bridge to estimate', () => {
  const src = read('src/app/pages/design/[projectId].astro');
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /surface: 'design'/);
  assert.match(src, /project_id: projectId/);
  assert.match(src, /phase: 'review_gate'/);
  assert.match(src, /class="ds-back"/);
  assert.match(src, /href=\{`\/estimate\/\$\{projectId\}`\}/);
  assert.match(src, /href="\/library"/);
  assert.match(src, /\/api\/v1\/design\/\$\{projectId\}\/pull/);
  assert.match(src, /\/api\/v1\/design\/\$\{projectId\}\/selections\/\$\{selId\}\/approve/);
  assert.match(src, /Pull this Selection onto the job/);
  assert.match(src, /Approve this Selection into the job/);
  assert.doesNotMatch(src, /\/invoice\/issue|record payment|\/api\/v1\/.*send/i);
});

test('SurfaceContext supports P2 client, project, and design tags', () => {
  for (const surface of ['client', 'project', 'design'] as const) {
    const tag = createSurfaceContext(DEFAULT_ROLE_ROOT_CONTEXT, {
      surface,
      project_id: surface === 'client' ? undefined : 'proj_intake_demo',
      phase: surface === 'design' ? 'review_gate' : 'create',
    });
    assert.equal(tag.surface, surface);
    assert.equal(tag.tenant, DEFAULT_ROLE_ROOT_CONTEXT.tenantId);
    assert.equal(tag.role, DEFAULT_ROLE_ROOT_CONTEXT.roleRoot);
  }
});

test('wireframe spine marks intake/sales P2 routes as Canon wired', () => {
  const byRoute = new Map(WIREFRAME_SPINE_MAP.map((entry) => [entry.route, entry]));
  for (const route of ['/clients/new', '/projects/new', '/design/:projectId']) {
    assert.equal(byRoute.get(route)?.status, 'canon_wired', `${route} should be canon_wired`);
  }
  assert.deepEqual(byRoute.get('/clients/new')?.wireframes, [
    'F-CL0a_mobile_client_create.html',
    'F-CL0b_desktop_client_create.html',
  ]);
  assert.deepEqual(byRoute.get('/projects/new')?.wireframes, [
    'F-PR0a_mobile_project_setup.html',
    'F-PR0b_desktop_project_setup.html',
  ]);
  assert.ok(
    byRoute.get('/design/:projectId')?.wireframes.includes('F-DES1a_mobile_design_workspace.html'),
    'design route should include mobile design face',
  );
  assert.ok(
    byRoute.get('/design/:projectId')?.wireframes.includes('F-DS1_desktop_design_workspace.html'),
    'design route should include desktop design face',
  );
});
