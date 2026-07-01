/**
 * Wall 2 · RBAC role enforcement — behavioral proof through the MOUNTED router.
 *
 * UI hiding does not count. This drives the real createApiRouter() with each
 * role's platform-session token and asserts the server itself denies field/sub
 * (and pm where the capability requires it) with a 403, and lets owner/admin
 * through the gate. We assert on the 403 / not-403 distinction only — a route
 * may legitimately 404/409/500 on missing data or env past the gate; what
 * matters is that the CAPABILITY decision happened server-side.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiRouter } from '../src/api/router.js';

const OWNER = { Authorization: 'Bearer psess_test_ggr_owner' };
const PM = { Authorization: 'Bearer psess_test_valle_pm' };
const ADMIN = { Authorization: 'Bearer psess_test_hpg_admin' };
const FIELD = { Authorization: 'Bearer psess_test_ggr_field' };
const SUB = { Authorization: 'Bearer psess_test_ggr_sub' };

describe('Wall 2 · RBAC role enforcement (mounted createApiRouter)', () => {
  const app = createApiRouter();

  async function status(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<number> {
    const res = await app.request('http://localhost' + path, {
      method,
      headers: { ...headers, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.status;
  }

  it('money.write · invoice/issue: field + sub + pm denied (403); owner + admin pass the gate', async () => {
    const path = '/right-hand/estimates/est_x/invoice/issue';
    const body = { confirmed: true, consequence: 'issue_invoice_milestone' };
    assert.equal(await status('POST', path, FIELD, body), 403);
    assert.equal(await status('POST', path, SUB, body), 403);
    assert.equal(await status('POST', path, PM, body), 403);
    assert.notEqual(await status('POST', path, OWNER, body), 403);
    assert.notEqual(await status('POST', path, ADMIN, body), 403);
  });

  it('money.write · draft/accept: field + sub + pm denied; owner + admin pass', async () => {
    const path = '/review/draft/accept';
    const body = { proposal_id: 'p1', project_id: 'pr1' };
    assert.equal(await status('POST', path, FIELD, body), 403);
    assert.equal(await status('POST', path, SUB, body), 403);
    assert.equal(await status('POST', path, PM, body), 403);
    assert.notEqual(await status('POST', path, OWNER, body), 403);
    assert.notEqual(await status('POST', path, ADMIN, body), 403);
  });

  it('money.read · estimates search: field + sub denied; pm + owner + admin pass (read-only ok)', async () => {
    const path = '/right-hand/estimates/search?q=x';
    assert.equal(await status('GET', path, FIELD), 403);
    assert.equal(await status('GET', path, SUB), 403);
    assert.notEqual(await status('GET', path, PM), 403);
    assert.notEqual(await status('GET', path, OWNER), 403);
    assert.notEqual(await status('GET', path, ADMIN), 403);
  });

  it('proposal.send: field + sub + pm denied; owner + admin pass', async () => {
    const path = '/proposals/p1/send';
    const body = { send_gate_event_id: 'e1' };
    assert.equal(await status('POST', path, FIELD, body), 403);
    assert.equal(await status('POST', path, SUB, body), 403);
    assert.equal(await status('POST', path, PM, body), 403);
    assert.notEqual(await status('POST', path, OWNER, body), 403);
    assert.notEqual(await status('POST', path, ADMIN, body), 403);
  });

  it('pay.view · team-ops/compliance: field + sub + pm denied; owner + admin pass', async () => {
    const path = '/team-ops/compliance';
    assert.equal(await status('GET', path, FIELD), 403);
    assert.equal(await status('GET', path, SUB), 403);
    assert.equal(await status('GET', path, PM), 403);
    assert.notEqual(await status('GET', path, OWNER), 403);
    assert.notEqual(await status('GET', path, ADMIN), 403);
  });

  it('sales.view · sales/deals: only owner passes (pm + admin + field + sub denied today)', async () => {
    const path = '/sales/deals';
    assert.equal(await status('GET', path, FIELD), 403);
    assert.equal(await status('GET', path, SUB), 403);
    assert.equal(await status('GET', path, PM), 403);
    assert.equal(await status('GET', path, ADMIN), 403);
    assert.notEqual(await status('GET', path, OWNER), 403);
  });

  it('denial precedes side effects: field invoice/issue with NO confirmation body still 403 (never 400/409)', async () => {
    // The guard is the first statement, so a denied caller never reaches the
    // body-parse or the confirm/consequence check, and no ledger row can form.
    const res = await app.request('http://localhost/right-hand/estimates/est_x/invoice/issue', {
      method: 'POST',
      headers: FIELD,
    });
    assert.equal(res.status, 403);
  });

  it('unauthenticated (no session) is still 401, not silently allowed', async () => {
    const res = await app.request('http://localhost/right-hand/estimates/search?q=x', { method: 'GET' });
    assert.equal(res.status, 401);
  });
});
