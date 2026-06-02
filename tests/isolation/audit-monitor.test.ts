import assert from 'node:assert/strict';

import {
  isolation,
  withIsolationStore,
  ev,
  scopedReadAs,
  assertNoCrossTenantAuditViolations,
} from './_harness.js';
import {
  findCrossTenantAccessViolations,
  recordTenantDataAccess,
  resetTenantAccessAuditForTests,
} from '../../src/tenant/tenantAccessAudit.js';

isolation('audit monitor — authorized cross-tenant rationale does not alarm', async () => {
  resetTenantAccessAuditForTests();
  recordTenantDataAccess({
    requester_tenant_id: 'tenant_ggr',
    accessed_tenant_id: 'tenant_other',
    operation: 'readEventsAcrossTenants',
    authorized: true,
    meta: { reason: 'audit_log_review' },
  });
  await assertNoCrossTenantAuditViolations();
});

isolation('audit monitor — simulated leak surfaces in standing query', () => {
  resetTenantAccessAuditForTests();
  recordTenantDataAccess({
    requester_tenant_id: 'tenant_ggr',
    accessed_tenant_id: 'tenant_other',
    operation: 'readEventsForTenant',
    authorized: false,
  });
  const violations = findCrossTenantAccessViolations();
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.requester_tenant_id, 'tenant_ggr');
  assert.equal(violations[0]!.accessed_tenant_id, 'tenant_other');
  resetTenantAccessAuditForTests();
});

isolation('audit monitor — tenant-scoped reads stay empty under normal use', async () => {
  await withIsolationStore(
    [ev({ tenant_id: 'tenant_ggr', type: 'project.created' })],
    async ({ reader }) => {
      await scopedReadAs('tenant_ggr', () => reader.readEventsForTenant('tenant_ggr'));
      await assertNoCrossTenantAuditViolations();
    },
  );
});
