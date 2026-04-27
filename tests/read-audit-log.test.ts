import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  type Actor,
  type Event,
} from '../src/blackboard/index.js';
import {
  createMemoryReadAuditLog,
  withReadAudit,
  type ReadAuditEntry,
} from '../src/audit/index.js';
import { createIdFactory } from '../src/shared/ids.js';
import { fixedClock } from '../src/shared/time.js';
import { ValidationError } from '../src/shared/errors.js';
import { ACTORS, seedWorld } from '../src/test-fixtures/index.js';

const AUDIT_AT = '2026-04-28T10:00:00.000Z';

function deterministicAuditLog() {
  const clock = fixedClock(AUDIT_AT);
  return createMemoryReadAuditLog({
    clock,
    ids: createIdFactory({ clock: () => clock.now(), random: () => 0.125 }),
  });
}

test('records actor, role, timestamp, target, and result count for a Blackboard read', async () => {
  const auditLog = deterministicAuditLog();
  const entry = await auditLog.record({
    actor: ACTORS.christian,
    operation: 'by_entity',
    target: { kind: 'entity', id: 'proj_clem_kitchen' },
    resultCount: 2,
  });

  assert.match(entry.id, /^read_/);
  assert.equal(entry.at, AUDIT_AT);
  assert.equal(entry.actor.id, ACTORS.christian.id);
  assert.equal(entry.actor.role, 'owner');
  assert.equal(entry.operation, 'by_entity');
  assert.deepEqual(entry.target, { kind: 'entity', id: 'proj_clem_kitchen' });
  assert.equal(entry.resultCount, 2);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.actor), true);
  assert.equal(Object.isFrozen(entry.target), true);
});

test('withReadAudit wraps EventLog read methods and logs zero-result reads', async () => {
  const baseLog = createMemoryEventLog();
  const auditLog = deterministicAuditLog();
  const audited = withReadAudit(baseLog, auditLog, ACTORS.christian);
  const [projectEvent, decisionEvent] = seedWorld();

  await audited.append(projectEvent as Event);
  await audited.append({ ...(decisionEvent as Event), correlationId: 'corr_demo' });

  await audited.byId(projectEvent.id);
  await audited.byEntity('proj_clem_kitchen');
  await audited.byCorrelation('corr_demo');
  await audited.all();
  await audited.byId('missing_event');

  const entries = await auditLog.query();
  assert.deepEqual(
    entries.map((entry) => [entry.operation, entry.target.kind, entry.target.id ?? null, entry.resultCount]),
    [
      ['by_id', 'event', projectEvent.id, 1],
      ['by_entity', 'entity', 'proj_clem_kitchen', 1],
      ['by_correlation', 'correlation', 'corr_demo', 1],
      ['all', 'all', null, 2],
      ['by_id', 'event', 'missing_event', 0],
    ],
  );
});

test('queries read audit entries by actor, role, operation, target, and limit', async () => {
  const auditLog = deterministicAuditLog();
  const owner: Actor = ACTORS.christian;
  const field: Actor = { id: 'u-field', role: 'field_super' };

  await auditLog.record({
    actor: owner,
    operation: 'all',
    target: { kind: 'all' },
    resultCount: 3,
  });
  await auditLog.record({
    actor: field,
    operation: 'by_entity',
    target: { kind: 'entity', id: 'proj_clem_kitchen' },
    resultCount: 1,
  });
  await auditLog.record({
    actor: owner,
    operation: 'by_entity',
    target: { kind: 'entity', id: 'proj_other' },
    resultCount: 0,
  });

  assert.equal((await auditLog.byActor(owner.id)).length, 2);
  assert.equal((await auditLog.query({ role: 'field_super' })).length, 1);
  assert.equal((await auditLog.query({ operation: 'by_entity' })).length, 2);
  assert.equal((await auditLog.query({ targetKind: 'entity', targetId: 'proj_clem_kitchen' })).length, 1);
  assert.deepEqual(
    (await auditLog.query({ limit: 1 })).map((entry) => entry.target.id),
    ['proj_other'],
  );
});

test('read audit entries store metadata only, not event payloads', async () => {
  const baseLog = createMemoryEventLog();
  const auditLog = deterministicAuditLog();
  const audited = withReadAudit(baseLog, auditLog, ACTORS.christian);
  const [projectEvent] = seedWorld();

  await audited.append(projectEvent as Event);
  await audited.byId(projectEvent.id);

  const [entry] = await auditLog.query();
  assert.equal('payload' in (entry as ReadAuditEntry & { payload?: unknown }), false);
  assert.equal(JSON.stringify(entry).includes('Clem Kitchen Remodel'), false);
});

test('rejects invalid result counts before writing audit entries', async () => {
  const auditLog = deterministicAuditLog();

  await assert.rejects(
    () => auditLog.record({
      actor: ACTORS.christian,
      operation: 'all',
      target: { kind: 'all' },
      resultCount: -1,
    }),
    ValidationError,
  );
  assert.equal((await auditLog.query()).length, 0);
});
