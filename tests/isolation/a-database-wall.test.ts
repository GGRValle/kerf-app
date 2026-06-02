import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isolation,
  withIsolationStore,
  ev,
  ISOLATION_CONTROL_TENANT,
  scopedReadAs,
  assertNoCrossTenantAuditViolations,
  tenantHeaders,
} from './_harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

isolation('A1 cross-tenant row read returns zero rows', async () => {
  await withIsolationStore(
    [
      ev({
        tenant_id: ISOLATION_CONTROL_TENANT,
        type: 'project.created',
        correlation_id: 'proj_other_only',
        project_id: 'proj_other_only',
      }),
    ],
    async ({ reader }) => {
      const rows = await scopedReadAs('tenant_ggr', () =>
        reader.readEventsForProject('tenant_ggr', 'proj_other_only'),
      );
      assert.equal(rows.length, 0);
      await assertNoCrossTenantAuditViolations();
    },
  );
});

isolation('A2 forged body tenant_id ignored; server session tenant wins', async () => {
  await withIsolationStore([], async ({ app }) => {
    const res = await app.request(
      '/projects/proj_forged/daily-log/entries?tenant_id=tenant_ggr',
      {
        method: 'POST',
        headers: tenantHeaders('tenant_ggr'),
        body: JSON.stringify({
          tenant_id: ISOLATION_CONTROL_TENANT,
          entry_kind: 'progress_update',
          transcript_text: 'isolation probe',
        }),
      },
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { event?: { tenant_id?: string } };
    assert.equal(body.event?.tenant_id, 'tenant_ggr');
    await assertNoCrossTenantAuditViolations();
  });
});

isolation('A3 service_role / BYPASSRLS unreachable from request-handling paths', async () => {
  const roots = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'scripts')];
  const pattern = /\b(?:service_role|BYPASSRLS|supabase\.service)\b/i;
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        await walk(full);
      } else if (e.isFile() && e.name.endsWith('.ts')) {
        const text = await fs.readFile(full, 'utf8');
        if (pattern.test(text)) hits.push(path.relative(REPO_ROOT, full));
      }
    }
  }
  for (const root of roots) await walk(root);
  assert.deepEqual(hits, [], `service_role/BYPASSRLS must not appear in: ${hits.join(', ')}`);
});

isolation(
  'A4 join leak — both tables enforce RLS on JOIN',
  async () => {
    assert.ok(true);
  },
  {
    pending:
      'TODO: Postgres RLS + JOIN integration when persistence migrates off JSONL (RightHand_Storage_Learning_Isolation_Canon §5.A4)',
  },
);

isolation(
  'A5 missing-RLS guard — every tenant_id table has RLS',
  async () => {
    assert.ok(true);
  },
  {
    pending:
      'TODO: CI scan of supabase/migrations/*.sql when Postgres tenant tables exist (§5.A5)',
  },
);

isolation(
  'A6 view/secdef guard — security_invoker views, flag SECURITY DEFINER',
  async () => {
    assert.ok(true);
  },
  {
    pending: 'TODO: static scan of SQL views/functions when DB layer lands (§5.A6)',
  },
);
