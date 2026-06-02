import assert from 'node:assert/strict';

import {
  tenantCacheKey,
  assertTenantBoundValue,
} from '../../src/tenant/cacheNamespace.js';
import { isolation, ISOLATION_CONTROL_TENANT } from './_harness.js';

isolation('B1 cache key collision — logical keys namespaced per tenant', () => {
  const logical = 'blackboard:relay:rcs_001';
  const ggrKey = tenantCacheKey('tenant_ggr', logical);
  const otherKey = tenantCacheKey(ISOLATION_CONTROL_TENANT, logical);
  assert.notEqual(ggrKey, otherKey);
  assert.match(ggrKey, /^tenant:tenant_ggr:/);
  assert.match(otherKey, /^tenant:tenant_other:/);
});

isolation('B2 identity-bind on read rejects mis-keyed object', () => {
  const misKeyed = { tenant_id: 'tenant_other' as const, payload: 'secret' };
  assert.throws(
    () => assertTenantBoundValue('tenant_ggr', misKeyed),
    /tenant_cache_identity_mismatch/,
  );
  const ok = assertTenantBoundValue('tenant_ggr', { tenant_id: 'tenant_ggr', payload: 'ok' });
  assert.equal(ok.payload, 'ok');
});

isolation(
  'B3 connection-pool race — concurrent multi-tenant responses never mix',
  async () => {
    assert.ok(true);
  },
  {
    pending:
      'TODO: stress harness against shared Redis/HTTP pool when production cache layer is wired (§5.B3)',
  },
);
