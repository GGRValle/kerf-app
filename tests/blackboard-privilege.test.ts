import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  isPrivilegedEvent,
  type Event,
  type PrivilegeClass,
} from '../src/blackboard/index.js';
import { ACTORS, seedWorld } from '../src/test-fixtures/index.js';

const baseEvent: Omit<Event<{ body: string }>, 'privilege_class'> = {
  id: 'evt_priv_test',
  at: '2026-04-27T12:00:00.000Z',
  actor: ACTORS.christian,
  kind: 'memory.noted',
  entity: { id: 'mem_priv_test', kind: 'memory_note' },
  payload: { body: 'test' },
  data_class: 'internal',
  retention_policy: 'until_close+7y',
};

test('isPrivilegedEvent returns false when privilege_class is null', () => {
  const event: Event<{ body: string }> = { ...baseEvent, privilege_class: null };
  assert.equal(isPrivilegedEvent(event), false);
});

test('isPrivilegedEvent returns true for every PrivilegeClass value', () => {
  const classes: PrivilegeClass[] = ['attorney_client', 'hr', 'capital', 'margin'];
  for (const cls of classes) {
    const event: Event<{ body: string }> = { ...baseEvent, privilege_class: cls };
    assert.equal(isPrivilegedEvent(event), true, `expected privileged=true for ${cls}`);
  }
});

test('seed events declare an explicit privilege_class (and default to null)', () => {
  const events = seedWorld();
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.ok('privilege_class' in event, `event ${event.id} missing privilege_class`);
    // Routine seed ops should be non-privileged. If a future seed legitimately
    // needs a privilege class (e.g., a capital decision in a fixture), update
    // this assertion explicitly — silent reclassification is a bug.
    assert.equal(
      event.privilege_class,
      null,
      `seed event ${event.id} should be non-privileged (got ${event.privilege_class})`,
    );
  }
});

test('privileged events round-trip through the event log unchanged', async () => {
  const event: Event<{ body: string }> = {
    ...baseEvent,
    id: 'evt_priv_roundtrip',
    privilege_class: 'attorney_client',
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.privilege_class, 'attorney_client');
  assert.equal(stored?.privilege_class, 'attorney_client');
  assert.equal(isPrivilegedEvent(appended), true);
  assert.equal(Object.isFrozen(appended), true);
});
