// Smoke wire-up. Not a test — a runnable example of how the W1 pieces compose.
// `npm run smoke`. Deterministic output given fixed clock + seeded RNG.

import { createMemoryEventLog } from '../blackboard';
import { createPermissionProvider } from '../permissions';
import {
  projectDecisions,
  projectGraph,
  projectLiveMemory,
  projectSystemState,
} from '../projections';
import { createStubPlatformClient } from '../contracts/platform';
import { createTranslator } from '../i18n';
import { ACTORS, seedWorld } from '../test-fixtures';
import { fixedClock } from '../shared';

async function main() {
  const clock = fixedClock('2026-04-28T09:00:00.000Z');
  const log = createMemoryEventLog();
  const permissions = createPermissionProvider();
  const platform = createStubPlatformClient({ clock: () => clock.now() });
  const t = createTranslator('en');

  const actor = ACTORS.christian;

  for (const e of seedWorld({ at: clock.now() })) {
    await log.append(e);
  }

  const events = await log.all();

  const decisions = projectDecisions(events, {
    actorRole: actor.role,
    now: clock.now(),
    limit: 5,
  });
  const state = projectSystemState(events).map((tile) => ({
    ...tile,
    labelResolved: t.t(tile.label),
  }));
  const memory = projectLiveMemory(events, { actor, permissions, limit: 10 });
  const graph = projectGraph(events);

  console.log(JSON.stringify({ decisions, state, memory, graph }, null, 2));

  // Demo Platform attestation — Kerf hands the project to Platform for audit-of-record.
  const attestation = await platform.attestCreate({
    kerfEntityId: 'proj_clem_kitchen',
    kind: 'project',
    actor,
    at: clock.iso(),
    payload: { label: 'Clem Kitchen Remodel' },
  });
  console.log('platform attestation:', attestation);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
