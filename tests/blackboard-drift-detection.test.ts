import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  DRIFT_DISPOSITIONS,
  DRIFT_PATTERNS,
  DRIFT_SEVERITIES,
  SIGNAL_SOURCE_TYPES,
  type DriftDetectedPayload,
  type DriftDisposition,
  type DriftDispositionedPayload,
  type DriftPattern,
  type DriftSeverity,
  type DriftSurfacedPayload,
  type EntityKind,
  type Event,
  type EventKind,
  type SignalCapturedPayload,
  type SignalSourceType,
  type WorkflowKind,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const SIGNAL_ID = 'sig_clem_pmt_promise_2026_04_22';
const ALERT_ID = 'drift_clem_callback_overdue';

const signalCapturedPayload: SignalCapturedPayload = {
  signalId: SIGNAL_ID,
  sourceType: 'slack',
  sourceRef: 'slack:C0123/p1745345600.000100',
  capturedAt: '2026-04-28T09:00:00.000Z',
  observedAt: '2026-04-22T16:30:00.000Z',
  actorHint: 'u-client-clem',
  canonicalLanguage: 'en',
  contentSnippet: 'Hey - any update on the kitchen timeline? Last we spoke you were going to call back Friday.',
  contextRefs: [
    { id: 'proj_clem_kitchen', kind: 'project' },
    { id: 'client_clem', kind: 'client' as EntityKind },
  ],
};

const driftDetectedPayload: DriftDetectedPayload = {
  alertId: ALERT_ID,
  pattern: 'callback_promised',
  severity: 'high',
  confidence: 0.82,
  signalRefs: [SIGNAL_ID],
  contextRefs: [{ id: 'proj_clem_kitchen', kind: 'project' }],
  summary:
    'Callback promised to Clem on the kitchen timeline (Apr 17 commitment, Apr 22 chase) has not been executed; client is escalating tone.',
  recommendedAction: 'Call Clem today before 5pm; bring the updated timeline draft.',
  detectedAt: '2026-04-28T09:00:00.000Z',
};

const driftSurfacedPayload: DriftSurfacedPayload = {
  alertId: ALERT_ID,
  surfacedAt: '2026-04-28T09:00:30.000Z',
  channel: 'slack',
  recipient: 'U_CHRISTIAN_SLACK',
  surfaceMessage:
    '3 drift items caught this morning. Top: callback to Clem overdue 5 days. Review?',
};

const driftDispositionedActedPayload: DriftDispositionedPayload = {
  alertId: ALERT_ID,
  disposition: 'act',
  dispositionedBy: ACTORS.christian.id,
  dispositionedAt: '2026-04-28T09:05:12.000Z',
  followUpNote: 'Calling Clem at 4pm; will update after.',
};

const driftDispositionedNotedPayload: DriftDispositionedPayload = {
  alertId: ALERT_ID,
  disposition: 'noted',
  dispositionedBy: ACTORS.christian.id,
  dispositionedAt: '2026-04-28T09:05:30.000Z',
};

const driftDispositionedFalsePositivePayload: DriftDispositionedPayload = {
  alertId: ALERT_ID,
  disposition: 'false_positive',
  dispositionedBy: ACTORS.christian.id,
  dispositionedAt: '2026-04-28T09:05:45.000Z',
  promptTuningHint:
    'Client said "I will call you" not "you will call me" — flip the actor parsing for inbound callback promises.',
};

type W3Payload =
  | SignalCapturedPayload
  | DriftDetectedPayload
  | DriftSurfacedPayload
  | DriftDispositionedPayload;

function eventFor(kind: EventKind): Event<W3Payload> {
  let payload: W3Payload;
  let entityKind: EntityKind;
  let entityId: string;
  let actionClass: 'read_only' | 'draft' | 'send_external';

  switch (kind) {
    case 'signal.captured':
      payload = signalCapturedPayload;
      entityKind = 'signal';
      entityId = SIGNAL_ID;
      actionClass = 'read_only';
      break;
    case 'drift.detected':
      payload = driftDetectedPayload;
      entityKind = 'drift_alert';
      entityId = ALERT_ID;
      actionClass = 'draft';
      break;
    case 'drift.surfaced':
      payload = driftSurfacedPayload;
      entityKind = 'drift_alert';
      entityId = ALERT_ID;
      actionClass = 'send_external';
      break;
    case 'drift.acted':
      payload = driftDispositionedActedPayload;
      entityKind = 'drift_alert';
      entityId = ALERT_ID;
      actionClass = 'draft';
      break;
    case 'drift.noted':
      payload = driftDispositionedNotedPayload;
      entityKind = 'drift_alert';
      entityId = ALERT_ID;
      actionClass = 'draft';
      break;
    case 'drift.false_positive':
      payload = driftDispositionedFalsePositivePayload;
      entityKind = 'drift_alert';
      entityId = ALERT_ID;
      actionClass = 'draft';
      break;
    default:
      throw new Error(`unexpected event kind: ${kind}`);
  }

  return {
    id: `evt_${kind.replaceAll('.', '_')}`,
    at: '2026-04-28T09:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind,
    entity: { id: entityId, kind: entityKind },
    payload,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'drift_detection',
    action_class: actionClass,
    sources: [{ kind: 'external', uri: `signal://${SIGNAL_ID}` }],
  };
}

test('drift_detection is a valid WorkflowKind and signal/drift_alert are valid EntityKinds', () => {
  const workflow: WorkflowKind = 'drift_detection';
  const signalKind: EntityKind = 'signal';
  const alertKind: EntityKind = 'drift_alert';

  assert.equal(workflow, 'drift_detection');
  assert.equal(signalKind, 'signal');
  assert.equal(alertKind, 'drift_alert');
});

test('drift detection EventKind values round-trip through the event log', async () => {
  const kinds = [
    'signal.captured',
    'drift.detected',
    'drift.surfaced',
    'drift.acted',
    'drift.noted',
    'drift.false_positive',
  ] satisfies EventKind[];
  const log = createMemoryEventLog();

  for (const kind of kinds) {
    const appended = await log.append(eventFor(kind));
    const stored = await log.byId(appended.id);

    assert.equal(appended.kind, kind);
    assert.equal(appended.workflow, 'drift_detection');
    assert.equal(Object.isFrozen(appended), true);
    assert.equal(stored?.kind, kind);

    const expectedEntityKind: EntityKind =
      kind === 'signal.captured' ? 'signal' : 'drift_alert';
    assert.equal(appended.entity.kind, expectedEntityKind);
  }
});

test('SIGNAL_SOURCE_TYPES enumerates the V1 closed source set', () => {
  const expected = ['slack', 'email', 'calendar', 'qbo', 'notes'] satisfies SignalSourceType[];
  assert.deepEqual([...SIGNAL_SOURCE_TYPES], expected);
});

test('DRIFT_PATTERNS enumerates the V1 closed pattern set', () => {
  const expected = [
    'commitment_not_followed',
    'stalled_approval',
    'permit_deadline_approaching',
    'callback_promised',
  ] satisfies DriftPattern[];
  assert.deepEqual([...DRIFT_PATTERNS], expected);
});

test('DRIFT_SEVERITIES enumerates the severity ladder in ascending order', () => {
  const expected = ['low', 'medium', 'high', 'critical'] satisfies DriftSeverity[];
  assert.deepEqual([...DRIFT_SEVERITIES], expected);

  // Index ordering is the contract surfacing layers rely on for sort order.
  // 'critical' must be last (highest). Lock it.
  assert.equal(DRIFT_SEVERITIES[DRIFT_SEVERITIES.length - 1], 'critical');
  assert.equal(DRIFT_SEVERITIES[0], 'low');
});

test('DRIFT_DISPOSITIONS enumerates the V1 closed disposition set', () => {
  const expected = ['act', 'noted', 'false_positive'] satisfies DriftDisposition[];
  assert.deepEqual([...DRIFT_DISPOSITIONS], expected);
});

test('drift detected payload satisfies the source-or-silent invariant (signalRefs >= 1)', () => {
  // The schema documents the invariant; the workflow module (PR #2)
  // enforces it at construction time. The scaffold test asserts the
  // canonical fixture conforms, so an accidental zero-signal payload
  // shows up as a fixture regression in CI.
  assert.ok(
    driftDetectedPayload.signalRefs.length >= 1,
    'DriftDetectedPayload.signalRefs must have at least one entry',
  );
  assert.equal(driftDetectedPayload.signalRefs[0], SIGNAL_ID);
});

test('drift detection payloads do not expose margin language', () => {
  // Margin is permission-gated to owner + moo per architecture invariant
  // 3.2. Drift summaries and recommended actions are LLM-generated on
  // signal windows that may include money-bearing context (QBO invoices,
  // proposal totals). The Kerf-side schema cannot block the LLM at
  // generation time, but tests pin the canonical fixtures so a margin
  // leak in our examples surfaces immediately.
  const marginRe = /\bmargin\b/i;
  assert.doesNotMatch(driftDetectedPayload.summary, marginRe);
  assert.doesNotMatch(driftDetectedPayload.recommendedAction, marginRe);
  assert.doesNotMatch(driftSurfacedPayload.surfaceMessage, marginRe);
});

test('signal captured payload supports both EN and ES canonical language', () => {
  // Spanish-native is a structural moat per architecture invariant 3.6.
  // Signals can originate in either language (Slack messages from
  // Spanish-speaking field crew, English emails from clients, etc.).
  const enSignal: SignalCapturedPayload = {
    ...signalCapturedPayload,
    canonicalLanguage: 'en',
  };
  const esSignal: SignalCapturedPayload = {
    ...signalCapturedPayload,
    signalId: 'sig_clem_pmt_promise_2026_04_22_es',
    canonicalLanguage: 'es',
    contentSnippet:
      'Oye - alguna actualizacion sobre la cocina? La ultima vez ibas a llamar el viernes.',
  };

  assert.equal(enSignal.canonicalLanguage, 'en');
  assert.equal(esSignal.canonicalLanguage, 'es');
});

test('drift disposition events carry a payload disposition that matches the event kind discriminator', async () => {
  // The kind drives projection routing; the payload field documents the
  // decision. The two must agree -- a drift.acted event carrying
  // disposition='noted' would be a bug. Lock the cross-check here.
  const log = createMemoryEventLog();

  const acted = await log.append(eventFor('drift.acted'));
  const noted = await log.append(eventFor('drift.noted'));
  const fp = await log.append(eventFor('drift.false_positive'));

  assert.equal((acted.payload as DriftDispositionedPayload).disposition, 'act');
  assert.equal((noted.payload as DriftDispositionedPayload).disposition, 'noted');
  assert.equal((fp.payload as DriftDispositionedPayload).disposition, 'false_positive');
});
