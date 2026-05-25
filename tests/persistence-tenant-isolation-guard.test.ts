/**
 * Lane 0.6 · Tenant-isolation static guard tests.
 *
 * Two enforcement layers covered here:
 *
 *   1. **Type-failure fixtures.** Each `// @ts-expect-error` directive
 *      verifies the TypeScript type guard rejects a bad call shape. If
 *      the directive doesn't fire, `npm run typecheck` fails — that's
 *      the gate. These exist for the cases the compiler can catch:
 *      missing parameter, invalid string literal, wrong rationale shape.
 *
 *   2. **Source-scan rules.** Non-test source files are walked and
 *      checked for guard violations:
 *        - Direct calls to `eventStore.readAll()` / `readByCorrelation()`
 *          / `readByType()` outside this module + tests.
 *        - Enumeration of `VALID_TENANT_IDS` in non-test code.
 *      Known exceptions (the module that exports the primitives, the
 *      module that consumes them inside the guard, the legacy
 *      `serve-v15-vertical-slice.ts` `handleGetProject` walk-tenants
 *      pattern that's pending Lane 0.1 cleanup) are explicit allowlist
 *      entries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPersistenceEventStore } from '../src/persistence/eventStore.ts';
import {
  createTenantScopedEventReader,
  type CrossTenantRationale,
  type TenantScopedEventReader,
} from '../src/persistence/tenantScopedReads.ts';
import type { PersistenceEvent, PersistenceTenantId } from '../src/persistence/events.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const SCRIPTS_ROOT = path.resolve(__dirname, '..', 'scripts');

// ──────────────────────────────────────────────────────────────────────────
// Test event factory · isolated in-memory store
// ──────────────────────────────────────────────────────────────────────────

function ev(over: Partial<PersistenceEvent> & { tenant_id: PersistenceTenantId; type: PersistenceEvent['type'] }): PersistenceEvent {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    correlation_id: 'proj_test_001',
    actor: { id: 'browser_operator', role: 'owner' as const },
    at: '2026-05-25T12:00:00.000Z',
    source_refs: [],
    project_id: 'proj_test_001',
    project_name: 'Test',
    client_name: 'Test',
    ...(over as PersistenceEvent),
  } as PersistenceEvent;
}

async function makeStoreWithEvents(events: PersistenceEvent[]) {
  const tmpDir = await fs.mkdtemp(path.join(SRC_ROOT, '..', '.tmp-tenant-guard-'));
  const filepath = path.join(tmpDir, 'events.jsonl');
  const store = createPersistenceEventStore({ filepath });
  for (const e of events) {
    // Bypass validator for tests · we control the shapes.
    await fs.appendFile(filepath, JSON.stringify(e) + '\n', 'utf8');
  }
  return {
    store,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Happy-path: each scoped reader returns only matching-tenant events
// ──────────────────────────────────────────────────────────────────────────

test('readEventsForTenant returns only events for the given tenant', async () => {
  const { store, cleanup } = await makeStoreWithEvents([
    ev({ tenant_id: 'tenant_ggr', type: 'project.created' }),
    ev({ tenant_id: 'tenant_valle', type: 'project.created' }),
    ev({ tenant_id: 'tenant_hpg', type: 'project.created' }),
    ev({ tenant_id: 'tenant_ggr', type: 'project.created' }),
  ]);
  try {
    const reader = createTenantScopedEventReader(store);
    const ggrEvents = await reader.readEventsForTenant('tenant_ggr');
    assert.equal(ggrEvents.length, 2);
    assert.ok(ggrEvents.every((e) => e.tenant_id === 'tenant_ggr'));

    const hpgEvents = await reader.readEventsForTenant('tenant_hpg');
    assert.equal(hpgEvents.length, 1);
    assert.ok(hpgEvents.every((e) => e.tenant_id === 'tenant_hpg'));
  } finally {
    await cleanup();
  }
});

test('readEventsForProject filters by tenant AND correlation_id', async () => {
  const { store, cleanup } = await makeStoreWithEvents([
    ev({ tenant_id: 'tenant_ggr', type: 'project.created', correlation_id: 'proj_A' }),
    ev({ tenant_id: 'tenant_ggr', type: 'project.created', correlation_id: 'proj_B' }),
    ev({ tenant_id: 'tenant_valle', type: 'project.created', correlation_id: 'proj_A' }),
  ]);
  try {
    const reader = createTenantScopedEventReader(store);
    const result = await reader.readEventsForProject('tenant_ggr', 'proj_A');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.tenant_id, 'tenant_ggr');
    assert.equal(result[0]!.correlation_id, 'proj_A');
  } finally {
    await cleanup();
  }
});

test('readEventsByTypeForTenant filters by tenant AND type', async () => {
  const { store, cleanup } = await makeStoreWithEvents([
    ev({ tenant_id: 'tenant_ggr', type: 'project.created' }),
    ev({ tenant_id: 'tenant_ggr', type: 'capture.recorded' } as never),
    ev({ tenant_id: 'tenant_valle', type: 'project.created' }),
  ]);
  try {
    const reader = createTenantScopedEventReader(store);
    const result = await reader.readEventsByTypeForTenant('tenant_ggr', 'project.created');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.tenant_id, 'tenant_ggr');
    assert.equal(result[0]!.type, 'project.created');
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-tenant escape hatch · rationale required
// ──────────────────────────────────────────────────────────────────────────

test('readEventsAcrossTenants returns all events when rationale is valid', async () => {
  const { store, cleanup } = await makeStoreWithEvents([
    ev({ tenant_id: 'tenant_ggr', type: 'project.created' }),
    ev({ tenant_id: 'tenant_valle', type: 'project.created' }),
    ev({ tenant_id: 'tenant_hpg', type: 'project.created' }),
  ]);
  try {
    const reader = createTenantScopedEventReader(store);
    const rationale: CrossTenantRationale = {
      reason: 'bounded_single_project_lookup',
      project_id: 'proj_test_001',
      operator: 'browser_operator',
    };
    const result = await reader.readEventsAcrossTenants(rationale);
    assert.equal(result.length, 3);
  } finally {
    await cleanup();
  }
});

test('readEventsAcrossTenants rejects invalid rationale (no reason)', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader = createTenantScopedEventReader(store);
    await assert.rejects(
      () => reader.readEventsAcrossTenants({} as never),
      /CrossTenantRationale/,
    );
  } finally {
    await cleanup();
  }
});

test('readEventsAcrossTenants rejects unknown reason', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader = createTenantScopedEventReader(store);
    await assert.rejects(
      () => reader.readEventsAcrossTenants({ reason: 'just_because' } as never),
      /CrossTenantRationale/,
    );
  } finally {
    await cleanup();
  }
});

test('readEventsAcrossTenants accepts each canonical rationale reason', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader = createTenantScopedEventReader(store);
    const rationales: CrossTenantRationale[] = [
      { reason: 'bounded_single_project_lookup', project_id: 'p', operator: 'op' },
      { reason: 'audit_log_review', operator: 'op', justification: 'quarterly audit' },
      { reason: 'admin_diagnostic', operator: 'op', justification: 'debug session' },
      { reason: 'eval_replay_or_test_fixture', fixture_id: 'fx_001' },
    ];
    for (const r of rationales) {
      const result = await reader.readEventsAcrossTenants(r);
      assert.ok(Array.isArray(result), `rationale ${r.reason} returned an array`);
    }
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// TYPE-FAILURE FIXTURES · these directives MUST fire during `npm run typecheck`
//
// If any @ts-expect-error doesn't fire, tsc reports
// "Unused '@ts-expect-error' directive" and `npm run typecheck` fails.
// That's the static-guard enforcement.
// ──────────────────────────────────────────────────────────────────────────

test('static guard: tenant parameter required (compile-time fixture)', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader: TenantScopedEventReader = createTenantScopedEventReader(store);

    // @ts-expect-error — readEventsForTenant requires a PersistenceTenantId argument
    void reader.readEventsForTenant();

    // @ts-expect-error — undefined is not a PersistenceTenantId
    void reader.readEventsForTenant(undefined);

    // @ts-expect-error — 'tenant_acme' is not in the PersistenceTenantId union
    void reader.readEventsForTenant('tenant_acme');

    // @ts-expect-error — bare string not narrowed to the union
    const looseTenant: string = 'tenant_ggr';
    void reader.readEventsForTenant(looseTenant);

    // @ts-expect-error — null is not a PersistenceTenantId
    void reader.readEventsForTenant(null);

    // OK shapes: properly typed
    const tenant: PersistenceTenantId = 'tenant_ggr';
    void reader.readEventsForTenant(tenant);
    void reader.readEventsForTenant('tenant_ggr'); // literal narrows to union

    assert.ok(true, 'compile-time enforcement holds · @ts-expect-error directives all fired');
  } finally {
    await cleanup();
  }
});

test('static guard: readEventsForProject requires tenant + projectId (compile-time fixture)', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader: TenantScopedEventReader = createTenantScopedEventReader(store);

    // @ts-expect-error — missing both parameters
    void reader.readEventsForProject();

    // @ts-expect-error — missing projectId
    void reader.readEventsForProject('tenant_ggr');

    // @ts-expect-error — tenant must come first (not projectId)
    void reader.readEventsForProject('proj_001', 'tenant_ggr');

    // OK: correct order + types
    void reader.readEventsForProject('tenant_ggr', 'proj_001');

    assert.ok(true);
  } finally {
    await cleanup();
  }
});

test('static guard: readEventsAcrossTenants requires CrossTenantRationale shape (compile-time fixture)', async () => {
  const { store, cleanup } = await makeStoreWithEvents([]);
  try {
    const reader: TenantScopedEventReader = createTenantScopedEventReader(store);

    // @ts-expect-error suppresses compile-time error; the line still executes
    // at runtime, where the runtime validator throws. `.catch(() => undefined)`
    // absorbs the runtime throw so the test can verify the compile-time
    // discipline holds without aborting on the expected runtime rejection.
    // (Both layers are belt-and-suspenders per D-048.)

    // @ts-expect-error — string is not CrossTenantRationale
    await reader.readEventsAcrossTenants('bounded_single_project_lookup').catch(() => undefined);

    // @ts-expect-error — empty object missing the reason discriminator
    await reader.readEventsAcrossTenants({}).catch(() => undefined);

    // @ts-expect-error — bounded_single_project_lookup requires project_id + operator
    await reader.readEventsAcrossTenants({ reason: 'bounded_single_project_lookup' }).catch(() => undefined);

    // @ts-expect-error — unknown reason literal
    await reader.readEventsAcrossTenants({ reason: 'curiosity', operator: 'op' }).catch(() => undefined);

    // OK: full shape · this one actually resolves
    const result = await reader.readEventsAcrossTenants({
      reason: 'bounded_single_project_lookup',
      project_id: 'p',
      operator: 'op',
    });
    assert.ok(Array.isArray(result));
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────────
// SOURCE-SCAN RULES · codex-checked at every gate
//
// Walks non-test source files and flags:
//   (a) Direct callers of eventStore.readAll() / readByCorrelation() /
//       readByType() outside the canonical exception list.
//   (b) Enumeration of VALID_TENANT_IDS in non-test code (the
//       walk-tenants anti-pattern) outside the canonical exception list.
//
// Known exceptions are explicit. Adding to the exception list is a
// deliberate canon update — discuss in D-048 review.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Files allowed to use the cross-tenant primitives directly. Each entry
 * has an explicit reason. New entries require justification.
 */
const CROSS_TENANT_PRIMITIVE_ALLOWLIST: ReadonlyArray<{
  readonly file: string;
  readonly reason: string;
}> = [
  {
    file: 'src/persistence/eventStore.ts',
    reason: 'defines the primitive · canonical source',
  },
  {
    file: 'src/persistence/tenantScopedReads.ts',
    reason: 'the tenant-scoped reader module that wraps the primitive · Lane 0.6 canonical gate',
  },
  {
    file: 'src/persistence/kbIngestion.ts',
    reason:
      'pre-existing readAll() in tenant-scoped path · uses tenant_id filter downstream · documented Lane 0.1 cleanup target',
  },
  {
    file: 'scripts/serve-v15-vertical-slice.ts',
    reason:
      'legacy server · being replaced in Lane 0.1 (Astro/SvelteKit/Hono shell · per dispatch ratified Option B) · new callers must use tenantScopedReads.ts',
  },
];

const VALID_TENANT_IDS_ENUMERATION_ALLOWLIST: ReadonlyArray<{
  readonly file: string;
  readonly reason: string;
}> = [
  {
    file: 'src/persistence/events.ts',
    reason: 'defines VALID_TENANT_IDS as the canonical runtime guard · validator-wall internal',
  },
  {
    file: 'src/proposal/validation.ts',
    reason:
      'proposal-validator-internal runtime guard · duplicates the canonical Set (kept in sync with the persistence layer) · pending cleanup imports the canonical Set rather than maintaining a local copy · same validator-internal pattern as events.ts',
  },
  {
    file: 'scripts/serve-v15-vertical-slice.ts',
    reason:
      'handleGetProject walk-tenants pattern · documented Lane 0.1 cleanup · replace with readEventsAcrossTenants({reason: "bounded_single_project_lookup", ...})',
  },
];

async function listSourceFiles(root: string): Promise<readonly string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip generated / vendored
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name.startsWith('.') ||
          entry.name === 'examples' // SPA · being replaced in Lane 0.1
        ) {
          continue;
        }
        await walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
          out.push(full);
        }
      }
    }
  }
  await walk(root);
  return out;
}

function relativePath(absolute: string): string {
  const repoRoot = path.resolve(__dirname, '..');
  return path.relative(repoRoot, absolute).replace(/\\/g, '/');
}

test('source scan: no direct eventStore.readAll/readByCorrelation/readByType outside allowlist', async () => {
  const srcFiles = await listSourceFiles(SRC_ROOT);
  const scriptFiles = await listSourceFiles(SCRIPTS_ROOT);
  const allFiles = [...srcFiles, ...scriptFiles];
  const allowlistFiles = new Set(CROSS_TENANT_PRIMITIVE_ALLOWLIST.map((e) => e.file));

  // Pattern: `.readAll(` / `.readByCorrelation(` / `.readByType(` invoked on something.
  // We're scanning for direct primitive calls. False positives possible on other
  // identifiers; the allowlist + comment-stripping is the discipline.
  const PRIMITIVE_CALL_PATTERN = /\b(?:readAll|readByCorrelation|readByType)\s*\(/;

  const violations: string[] = [];
  for (const file of allFiles) {
    const rel = relativePath(file);
    if (allowlistFiles.has(rel)) continue;
    const text = await fs.readFile(file, 'utf8');
    // Strip block + line comments before scanning so doc-comment mentions
    // (e.g., the eventStore.ts cross-tenant warning text) don't count.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    if (PRIMITIVE_CALL_PATTERN.test(stripped)) {
      violations.push(rel);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Lane 0.6 guard: files outside the allowlist call eventStore.readAll/readByCorrelation/readByType directly. ' +
      'Use tenantScopedReads.ts wrappers, or add an explicit allowlist entry with justification.',
  );
});

test('source scan: no VALID_TENANT_IDS enumeration outside allowlist', async () => {
  const srcFiles = await listSourceFiles(SRC_ROOT);
  const scriptFiles = await listSourceFiles(SCRIPTS_ROOT);
  const allFiles = [...srcFiles, ...scriptFiles];
  const allowlistFiles = new Set(VALID_TENANT_IDS_ENUMERATION_ALLOWLIST.map((e) => e.file));

  const PATTERN = /\bVALID_TENANT_IDS\b/;

  const violations: string[] = [];
  for (const file of allFiles) {
    const rel = relativePath(file);
    if (allowlistFiles.has(rel)) continue;
    const text = await fs.readFile(file, 'utf8');
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    if (PATTERN.test(stripped)) {
      violations.push(rel);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Lane 0.6 guard: files outside the allowlist enumerate VALID_TENANT_IDS. ' +
      'Use tenantScopedReads.ts · readEventsAcrossTenants with an explicit rationale ' +
      'instead of walking the tenant enum.',
  );
});

test('allowlist sanity: every allowlisted file exists', async () => {
  const repoRoot = path.resolve(__dirname, '..');
  for (const entry of CROSS_TENANT_PRIMITIVE_ALLOWLIST) {
    const full = path.join(repoRoot, entry.file);
    const stat = await fs.stat(full).catch(() => null);
    assert.ok(stat?.isFile(), `cross-tenant primitive allowlist entry ${entry.file} must exist`);
  }
  for (const entry of VALID_TENANT_IDS_ENUMERATION_ALLOWLIST) {
    const full = path.join(repoRoot, entry.file);
    const stat = await fs.stat(full).catch(() => null);
    assert.ok(stat?.isFile(), `VALID_TENANT_IDS enumeration allowlist entry ${entry.file} must exist`);
  }
});
