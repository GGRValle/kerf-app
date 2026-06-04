/**
 * Lane 2 · Win the Work — folded-in clients/portal/success/warranty + fix-queue.
 *
 * Covers: real project↔client binding · distinct `client_approval.confirmed`
 * event (NOT operator `decision.approved`) · approval-needed + warranty-expiring
 * AttentionCards · registerSurface backTo conformance · cross-CLIENT isolation ·
 * proposal-draft → portal-approval seam (client-facing price, no cost/margin).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createApiRouter } from '../src/api/router.js';
import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests, getApiDeps } from '../src/api/lib/deps.js';
import {
  getLane3ClientForProject,
  projectBelongsToClient,
  isWarrantyExpiring,
  listLane3Warranties,
  toClientPortalApprovalView,
} from '../src/app/lib/lane3Fixtures.js';
import {
  validateRegisterSurfaceInput,
} from '../src/contracts/lane1/registerSurface.js';
import {
  LANE2_CLIENT_SURFACES,
  LANE2_ALL_SURFACES,
  approvalNeededAttention,
  warrantyExpiringAttention,
  emitWinTheWorkAttention,
  publishProposalToPortal,
  portalApprovalFromProposal,
  generateProposalDraft,
  estimateTotals,
  type EstimateLine,
} from '../src/sales/index.js';
import type { AttentionArtifact } from '../src/contracts/lane1/attentionArtifact.js';
import type { LocalityEnvelope } from '../src/contracts/lane1/locality.js';

async function withOperatorApi<T>(
  fn: (app: ReturnType<typeof createAuthenticatedApiRouter>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane2-win-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn(createAuthenticatedApiRouter());
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

async function withPortalApi<T>(
  fn: (app: ReturnType<typeof createApiRouter>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane2-portal-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn(createApiRouter());
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Real project↔client binding ──────────────────────────────────────────────

test('project↔client binding resolves the owning client from the project', () => {
  assert.equal(getLane3ClientForProject('proj_dunne_bath'), 'client_dunne');
  assert.equal(getLane3ClientForProject('proj_wegrzyn_kitchen'), 'client_wegrzyn');
  assert.equal(getLane3ClientForProject('proj_unknown'), null);
  assert.equal(projectBelongsToClient('proj_wegrzyn_kitchen', 'client_wegrzyn'), true);
  assert.equal(projectBelongsToClient('proj_wegrzyn_kitchen', 'client_dunne'), false);
});

test('/portal/preview derives client from project; rejects mismatch + unbound', async () => {
  await withOperatorApi(async (app) => {
    const ok = await app.request('/portal/preview?project_id=proj_wegrzyn_kitchen');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.client_id, 'client_wegrzyn');
    for (const a of body.approvals) {
      assert.ok(!('cost_cents' in a));
      assert.ok(!('margin_cents' in a));
    }
    // Cross-client peeking via mismatched client_id → 403.
    const mismatch = await app.request(
      '/portal/preview?project_id=proj_wegrzyn_kitchen&client_id=client_dunne',
    );
    assert.equal(mismatch.status, 403);
    // Unbound project → 404 (no portal to preview).
    const unbound = await app.request('/portal/preview?project_id=proj_nope');
    assert.equal(unbound.status, 404);
  });
});

// ── Distinct client_approval.confirmed event ─────────────────────────────────

test('client confirm emits `client_approval.confirmed`, never operator `decision.approved`', async () => {
  await withPortalApi(async (app) => {
    const res = await app.request(
      '/portal/session/psess_dunne_demo/approvals/appr_dunne_prop/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(res.status, 200);
    const events = await getApiDeps().eventStore.readAll();
    const confirmed = events.filter((e) => e.type === 'client_approval.confirmed');
    assert.equal(confirmed.length, 1, 'exactly one client_approval.confirmed event');
    // The client is the actor and only the client-facing total is recorded.
    const ev = confirmed[0] as Record<string, unknown>;
    assert.equal(ev['client_id'], 'client_dunne');
    assert.ok(!('cost_cents' in ev) && !('margin_cents' in ev));
    // It must NOT reuse the operator decision event.
    assert.equal(events.some((e) => e.type === 'decision.approved'), false);
  });
});

// ── AttentionCards: approval-needed + warranty-expiring ──────────────────────

test('approval-needed cards are needs_you, agent-free, deep-linked', () => {
  const cards = approvalNeededAttention('tenant_ggr', ['client_wegrzyn']);
  assert.ok(cards.length >= 1);
  for (const c of cards) {
    assert.equal(c.state, 'needs_you');
    assert.equal(c.domain, 'clients');
    assert.match(c.source_ref, /^\/projects\/.*\/portal-preview$/);
    // No agent name in copy.
    assert.doesNotMatch(`${c.headline} ${c.because}`, /right hand|mano|agent/i);
  }
});

test('warranty-expiring card fires inside the window only', () => {
  const now = new Date('2026-05-28T00:00:00Z');
  const expiring = listLane3Warranties().filter((w) => isWarrantyExpiring(w, now));
  assert.deepEqual(
    expiring.map((w) => w.client_id),
    ['client_hernandez'],
  );
  const cards = warrantyExpiringAttention('tenant_ggr', now);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.state, 'risk_changed');
  assert.equal(cards[0]!.domain, 'client_success');
});

test('emitWinTheWorkAttention emits both families through the shared emitter', () => {
  const captured: AttentionArtifact[] = [];
  const out = emitWinTheWorkAttention({
    tenant: 'tenant_ggr',
    clientIds: ['client_wegrzyn'],
    emitter: { emit: (a) => captured.push(a) },
    now: new Date('2026-05-28T00:00:00Z'),
  });
  assert.equal(captured.length, out.length);
  assert.ok(out.some((a) => a.state === 'needs_you'));
  assert.ok(out.some((a) => a.state === 'risk_changed'));
});

// ── registerSurface conformance (post-#287) ──────────────────────────────────

test('folded-in client surfaces all declare backTo and carry no query strings', () => {
  for (const s of LANE2_CLIENT_SURFACES) {
    const r = validateRegisterSurfaceInput(s);
    assert.equal(r.ok, true, `surface ${s.route} must validate`);
    assert.ok(s.backTo && s.backTo.length > 0);
    assert.ok(!s.route.includes('?'));
  }
});

test('client-facing portal door is NOT in the operator surface registry', () => {
  const routes = LANE2_ALL_SURFACES.map((s) => s.route);
  assert.ok(!routes.includes('/portal'));
  assert.ok(!routes.includes('/portal/s/:token'));
});

test('client portal astro pages do not render cost, margin, or markup fields', () => {
  const portalSrc = readFileSync(
    path.join(process.cwd(), 'src/app/pages/portal/s/[token].astro'),
    'utf8',
  );
  assert.doesNotMatch(portalSrc, /cost_cents|margin_cents|markup/i);
  assert.match(portalSrc, /client_visible_total_cents/);
});

// ── Cross-CLIENT isolation ───────────────────────────────────────────────────

test('a client session cannot confirm another client\'s approval', async () => {
  await withPortalApi(async (app) => {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo/approvals/appr_dunne_prop/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(res.status, 403);
  });
});

test('publishProposalToPortal refuses a project not bound to the client', () => {
  const totals = estimateTotals([]);
  const draft = {
    proposal_id: 'prop_x',
    project_id: 'proj_wegrzyn_kitchen',
    client_name: 'Wrong Client',
    status: 'draft' as const,
    client_total_cents: 0,
    line_count: 0,
    created_at: '2026-05-28T00:00:00Z',
    surface_route: '/proposals/prop_x',
  };
  assert.throws(() =>
    publishProposalToPortal({
      draft,
      totals,
      tenant: 'tenant_ggr',
      client_id: 'client_dunne', // not bound to proj_wegrzyn_kitchen
      project_id: 'proj_wegrzyn_kitchen',
      project_selection_id: 'psel_x',
    }),
  );
});

// ── Proposal draft → portal approval seam (client price; no cost/margin) ─────

test('proposal draft → portal approval → client confirm propagates client total', async () => {
  await withPortalApi(async (app) => {
    const lines: EstimateLine[] = [
      {
        id: 'l1', estimate_id: 'est1', project_id: 'proj_wegrzyn_kitchen', tenant: 'tenant_ggr',
        line_type: 'material', label: 'Quartz', quantity: 10, unit_cost_cents: 8_900,
        markup_bps: 4000, client_visible: true,
      },
    ];
    const totals = estimateTotals(lines);
    const { draft } = generateProposalDraft({
      project_id: 'proj_wegrzyn_kitchen',
      client_name: 'Mark & Grace Wegrzyn',
      lines,
      locality: { tenant: 'tenant_ggr', consequence_tier: 'durable' } as LocalityEnvelope,
      confirmed: true,
      now: '2026-05-28T00:00:00Z',
      id: 'prop_seam',
    });

    // Client sees only the reconciled client total — no cost/margin on the view.
    const approval = portalApprovalFromProposal({
      draft, totals, tenant: 'tenant_ggr', client_id: 'client_wegrzyn',
      project_id: 'proj_wegrzyn_kitchen', project_selection_id: 'psel_seam',
      approval_id: 'appr_seam',
    });
    const view = toClientPortalApprovalView(approval) as Record<string, unknown>;
    assert.ok(!('cost_cents' in view) && !('margin_cents' in view));
    assert.equal(view['client_visible_total_cents'], draft.client_total_cents);

    // Publish it live, then the client confirms in their portal.
    publishProposalToPortal({
      draft, totals, tenant: 'tenant_ggr', client_id: 'client_wegrzyn',
      project_id: 'proj_wegrzyn_kitchen', project_selection_id: 'psel_seam',
      approval_id: 'appr_seam',
    });
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo/approvals/appr_seam/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.propagated.client_visible_total_cents, draft.client_total_cents);
    assert.equal(body.propagated.project_selection_id, 'psel_seam');
    assert.match(body.propagated.schedule_assignment_ref, /^sched_/);
  });
});
