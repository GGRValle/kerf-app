import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSurfaceContext,
  leaveBehindForSurface,
} from '../src/app/lib/surfaceContext.js';
import type { RoleRootContext } from '../src/app/lib/layout-props.js';
import { getLane23ProjectForTenant, LANE23_DRAFT_REVIEW } from '../src/app/lib/lane23Fixtures.js';
import { getLane6ProposalForTenant } from '../src/app/lib/lane6Fixtures.js';
import { moneyTenant } from '../src/app/lib/moneyFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const principal: RoleRootContext = {
  tenantId: 'tenant_ggr',
  roleRoot: 'owner',
  locale: 'en',
};

test('SurfaceContext emits tenant and role from the server principal only', () => {
  const tag = createSurfaceContext(principal, {
    surface: 'estimate',
    project_id: 'proj_wegrzyn_kitchen',
    estimate_id: 'prop_lane23_wegrzyn',
    line_ids: ['line_demo_cabinets', 'line_demo_appliance_allowance'],
    phase: 'draft',
  });

  assert.equal(tag.surface, 'estimate');
  assert.equal(tag.tenant, 'tenant_ggr');
  assert.equal(tag.role, 'owner');
  assert.equal(tag.estimate_id, 'prop_lane23_wegrzyn');
  assert.deepEqual(tag.line_ids, ['line_demo_cabinets', 'line_demo_appliance_allowance']);
});

test('client-supplied tenant or role cannot spoof the SurfaceContext principal', () => {
  const adversarialInput = {
    surface: 'proposal',
    tenant: 'tenant_valle',
    role: 'admin_ops',
    estimate_id: 'prop_lane23_wegrzyn',
    line_ids: ['line_demo_cabinets'],
  } as unknown as Parameters<typeof createSurfaceContext>[1];

  const tag = createSurfaceContext(principal, adversarialInput);

  assert.equal(tag.tenant, 'tenant_ggr');
  assert.equal(tag.role, 'owner');
  assert.equal(tag.surface, 'proposal');
});

test('Estimate leave-behind carries previous ids to Proposal', () => {
  const estimateTag = createSurfaceContext(principal, {
    surface: 'estimate',
    project_id: 'proj_wegrzyn_kitchen',
    estimate_id: 'prop_lane23_wegrzyn',
    line_ids: ['line_demo_cabinets', 'line_demo_appliance_allowance'],
    phase: 'draft',
  });

  const proposalTag = createSurfaceContext(
    principal,
    {
      surface: 'proposal',
      project_id: 'proj_wegrzyn_kitchen',
      estimate_id: 'prop_lane23_wegrzyn',
      proposal_id: 'prop_lane23_wegrzyn',
      line_ids: ['line_demo_cabinets', 'line_demo_appliance_allowance'],
      phase: 'preview',
    },
    leaveBehindForSurface(estimateTag),
  );

  assert.equal(proposalTag.previous?.surface, 'estimate');
  assert.equal(proposalTag.previous?.ids.estimate_id, 'prop_lane23_wegrzyn');
  assert.deepEqual(proposalTag.previous?.ids.line_ids, ['line_demo_cabinets', 'line_demo_appliance_allowance']);
});

test('spine surfaces emit SurfaceContext through Layout props', () => {
  const layout = readFileSync(path.join(ROOT, 'src/app/layouts/Layout.astro'), 'utf8');
  assert.match(layout, /createSurfaceContext/);
  assert.match(layout, /id="kerf-surface-context"/);
  assert.match(layout, /__KERF_SURFACE_CONTEXT__/);

  const home = readFileSync(path.join(ROOT, 'src/app/pages/index.astro'), 'utf8');
  assert.match(home, /surfaceContext=\{\{ surface: 'home'/);

  const estimate = readFileSync(path.join(ROOT, 'src/app/pages/draft-review/[draft_id].astro'), 'utf8');
  assert.match(estimate, /surface: 'estimate'/);
  assert.match(estimate, /line_ids: draft\?\.lines\.map/);

  const proposal = readFileSync(path.join(ROOT, 'src/app/pages/proposals/[id]/preview.astro'), 'utf8');
  assert.match(proposal, /surface: 'proposal'/);
  assert.match(proposal, /proposal_id: proposal\.proposal_id/);

  const money = readFileSync(path.join(ROOT, 'src/app/pages/money/index.astro'), 'utf8');
  assert.match(money, /surfaceContext=\{\{[\s\S]*surface: 'money'/);

  const invoice = readFileSync(path.join(ROOT, 'src/app/pages/money/ar.astro'), 'utf8');
  assert.match(invoice, /surface: 'invoice'/);

  const fieldCapture = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(fieldCapture, /surface: 'field_capture'/);

  const dailyLog = readFileSync(path.join(ROOT, 'src/app/pages/projects/[id]/daily-log.astro'), 'utf8');
  assert.match(dailyLog, /surface: 'daily_log'/);
  assert.match(dailyLog, /log_date: logDate/);
  assert.match(dailyLog, /data-grammar="canon"/);
});

test('proposal preview denies forged cross-tenant proposal ids under the server principal', () => {
  assert.equal(getLane6ProposalForTenant('prop_lane6_pass', 'tenant_ggr')?.tenant_id, 'tenant_ggr');
  assert.equal(getLane6ProposalForTenant('prop_lane6_override_valle', 'tenant_ggr'), null);
  assert.equal(getLane6ProposalForTenant('prop_lane6_override_hpg', 'tenant_ggr'), null);

  const proposalPreview = readFileSync(path.join(ROOT, 'src/app/pages/proposals/[id]/preview.astro'), 'utf8');
  assert.match(proposalPreview, /createLayoutContext/);
  assert.match(proposalPreview, /getLane6ProposalForTenant\(id, context\.tenantId\)/);
  assert.doesNotMatch(proposalPreview, /getLane6Proposal\(id\)/);
  assert.match(proposalPreview, /proposal === null[\s\S]*Astro\.redirect\('\/'\)/);
});

test('draft review and field capture fixture reads are tenant-scoped', () => {
  assert.equal(LANE23_DRAFT_REVIEW.tenant_id, 'tenant_ggr');
  assert.equal(getLane23ProjectForTenant('proj_wegrzyn_kitchen', 'tenant_ggr')?.tenant_id, 'tenant_ggr');
  assert.equal(getLane23ProjectForTenant('proj_wegrzyn_kitchen', 'tenant_valle'), null);
  assert.equal(getLane23ProjectForTenant('proj_moore_cabs', 'tenant_ggr'), null);

  const draftReview = readFileSync(path.join(ROOT, 'src/app/pages/draft-review/[draft_id].astro'), 'utf8');
  assert.match(draftReview, /getLane23ProjectForTenant\(eventDraftEvent\.correlation_id, context\.tenantId\)/);
  assert.match(draftReview, /LANE23_DRAFT_REVIEW\.tenant_id === context\.tenantId/);

  const fieldCapture = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(fieldCapture, /getLane23ProjectForTenant\('proj_wegrzyn_kitchen', context\.tenantId\)/);
  assert.match(fieldCapture, /assignedProject === null[\s\S]*Astro\.redirect\('\/'\)/);
});

test('money fixture surfaces fence GGR-only queues by server tenant', () => {
  assert.equal(moneyTenant(), 'tenant_ggr');

  const moneyHome = readFileSync(path.join(ROOT, 'src/app/pages/money/index.astro'), 'utf8');
  assert.match(moneyHome, /moneyTenant\(\) !== context\.tenantId[\s\S]*Astro\.redirect\('\/'\)/);

  const ar = readFileSync(path.join(ROOT, 'src/app/pages/money/ar.astro'), 'utf8');
  assert.match(ar, /moneyTenant\(\) !== context\.tenantId[\s\S]*Astro\.redirect\('\/'\)/);
});
