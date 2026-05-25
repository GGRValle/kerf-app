import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS_GRAPH_SLICE, projectForRole, ROLE_ROOTS } from '../src/app/lib/roleRootProjection.js';
import type { RoleRootContext } from '../src/app/lib/layout-props.js';

const ctx = (roleRoot: RoleRootContext['roleRoot']): RoleRootContext => ({ tenantId: 'tenant_ggr', roleRoot, locale: 'en' });

test('projectForRole · owner sees all domains and margin', () => {
  const out = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, ctx('owner'), { ok: true });
  assert.equal(out.visibleDomains.length, DEFAULT_BUSINESS_GRAPH_SLICE.availableDomains.length);
  assert.equal(out.hiddenDomains.length, 0);
  assert.equal(out.capabilities.marginVisible, true);
});

test('projectForRole · pm hides margin, sales, marketing', () => {
  const out = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, ctx('pm'), null);
  assert.ok(!out.visibleDomains.includes('margin'));
  assert.ok(!out.visibleDomains.includes('sales'));
  assert.equal(out.capabilities.moneyWrite, false);
});

test('projectForRole · admin_ops hides margin but allows money write', () => {
  const out = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, ctx('admin_ops'), null);
  assert.ok(!out.visibleDomains.includes('margin'));
  assert.ok(out.visibleDomains.includes('audit'));
  assert.equal(out.capabilities.moneyWrite, true);
});

test('projectForRole · field_hand is capture-first with no money', () => {
  const out = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, ctx('field_hand'), null);
  assert.ok(out.visibleDomains.includes('capture'));
  assert.ok(!out.visibleDomains.includes('money'));
});

test('projectForRole · sub portal is work-order + invoice scoped', () => {
  const out = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, ctx('sub'), null);
  assert.deepEqual([...out.visibleDomains].sort(), ['comms', 'home', 'invoices', 'settings', 'work_orders']);
});

test('projectForRole · five role roots are covered', () => {
  assert.equal(ROLE_ROOTS.length, 5);
});
