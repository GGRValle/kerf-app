import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetChangeOrderFlowForTests } from '../src/app/lib/changeOrderFlow.js';
import type { BuilderLine } from '../src/app/lib/builderEngine.js';

const line: BuilderLine = {
  line_id: 'ln_api_1',
  line_type: 'labor',
  description: 'Shelving line',
  quantity: 1,
  unit: 'ea',
  unit_cost_cents: 10_000,
};

test.beforeEach(() => {
  resetChangeOrderFlowForTests();
});

test('POST submit-for-review requires operator_confirm and returns decision redirect', async () => {
  const app = createAuthenticatedApiRouter();

  const blocked = await app.request('/change-orders/submit-for-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: 'prj_014', title: 'CO test', lines: [line], total_cents: 13500 }),
  });
  assert.equal(blocked.status, 400);

  const res = await app.request('/change-orders/submit-for-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: 'prj_014',
      title: 'CO test',
      lines: [line],
      total_cents: 13_500,
      operator_confirm: true,
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { decision_id: string; redirect: string };
  assert.match(body.decision_id, /^co_dec_/);
  assert.equal(body.redirect, `/decisions/${body.decision_id}`);
});

test('POST decide adjusts contract only with operator_confirm', async () => {
  const app = createAuthenticatedApiRouter();
  const submit = await app.request('/change-orders/submit-for-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: 'prj_014',
      title: 'CO approve',
      lines: [line],
      total_cents: 13_500,
      operator_confirm: true,
    }),
  });
  const { change_order_id } = (await submit.json()) as { change_order_id: string };

  const blocked = await app.request(`/change-orders/${change_order_id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', operator_confirm: false }),
  });
  assert.equal(blocked.status, 400);

  const approved = await app.request(`/change-orders/${change_order_id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', operator_confirm: true }),
  });
  assert.equal(approved.status, 200);
  const result = (await approved.json()) as { contract_adjusted: boolean; contract: { adjusted_total_cents: number } };
  assert.equal(result.contract_adjusted, true);
  assert.equal(result.contract.adjusted_total_cents, 13_500);
});
