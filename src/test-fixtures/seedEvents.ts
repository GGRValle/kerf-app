import type { Event } from '../blackboard/types.js';
import { ACTORS } from './seedActors.js';
import { PROJECTS } from './seedProjects.js';
import { fixedClock } from '../shared/time.js';
import { createIdFactory } from '../shared/ids.js';

// Deterministic event seed. Given a fixed clock + seeded id factory, the same
// inputs produce the same outputs. Keeps smoke runs + tests reproducible.

export interface SeedWorldOpts {
  at?: Date | string;
}

export function seedWorld(opts: SeedWorldOpts = {}): Event[] {
  const clock = fixedClock(opts.at ?? '2026-04-28T09:00:00.000Z');
  const ids = createIdFactory({ clock: () => clock.now(), random: mulberry32(1) });
  const at = clock.iso();

  const events: Event[] = [];

  // 1. Clem project is created.
  events.push({
    id: ids.mint('evt'),
    at,
    actor: ACTORS.christian,
    kind: 'entity.created',
    entity: { id: PROJECTS.clemKitchen.id, kind: 'project' },
    payload: { label: PROJECTS.clemKitchen.label },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
  });

  // 2. Estimator agent surfaces a decision blocking the project.
  events.push({
    id: ids.mint('evt'),
    at,
    actor: ACTORS.estimatorAgent,
    kind: 'decision.surfaced',
    entity: {
      id: 'dec_cabinet_finish',
      kind: 'decision',
      decision_authority: { role: 'owner' },
      action_class: 'approve_under_ceiling',
      decision_altitude: 'L1',
    },
    payload: {
      id: 'dec_cabinet_finish',
      title: 'Cabinet finish direction',
      question: 'Shop-finish or on-site finish for the Clem run?',
      options: [
        { id: 'shop', label: 'Valle shop finish (Rubio Monocoat)', preferred: true },
        { id: 'onsite', label: 'On-site finish' },
      ],
      blocks: [PROJECTS.clemKitchen.id],
      requiredRole: 'owner',
      decision_authority: { role: 'owner' },
      action_class: 'approve_under_ceiling',
      decision_altitude: 'L1',
      impact: 0.7,
      urgency: 0.6,
      confidence: 0.82,
    },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'proposal_generation',
    decision_authority: { role: 'owner' },
    action_class: 'approve_under_ceiling',
    decision_altitude: 'L1',
    sources: [{ kind: 'transcript', excerpt: 'client prefers factory finish if similar price' }],
  });

  // 3. A memory note is logged.
  events.push({
    id: ids.mint('evt'),
    at,
    actor: ACTORS.christian,
    kind: 'memory.noted',
    entity: { id: ids.mint('mem'), kind: 'memory_note' },
    payload: { body: 'Clem confirmed budget ceiling is firm at $95k.' },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
  });

  // 4. Decision → project relation (feeds graph projection).
  events.push({
    id: ids.mint('evt'),
    at,
    actor: ACTORS.christian,
    kind: 'relation.created',
    entity: { id: ids.mint('rel'), kind: 'project' },
    payload: {
      from: 'dec_cabinet_finish',
      to: PROJECTS.clemKitchen.id,
      kind: 'blocked_by',
    },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
  });

  return events;
}

// Mulberry32 — deterministic PRNG for test data. NOT cryptographic.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
