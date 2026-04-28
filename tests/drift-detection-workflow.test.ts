import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedClock } from '../src/shared/index.js';
import { ValidationError } from '../src/shared/errors.js';
import {
  applyDriftDisposition,
  assembleDriftAlert,
  assertDriftDetectedPayloadValid,
  classifyDriftSeverity,
  renderDriftSurface,
  shapeRecommendedAction,
  validateLlmDriftCandidate,
  type DriftAlert,
  type LlmDriftCandidate,
} from '../src/workflows/index.js';
import {
  DRIFT_PATTERNS,
  type DriftDetectedPayload,
  type DriftDispositionedPayload,
  type DriftSurfacedPayload,
} from '../src/blackboard/index.js';

const CLOCK = fixedClock('2026-04-28T09:00:00.000Z');
const ACTOR_CHRISTIAN = 'u-christian';

function baseCandidate(overrides: Partial<LlmDriftCandidate> = {}): LlmDriftCandidate {
  return {
    pattern: 'callback_promised',
    signalRefs: ['sig_clem_callback_2026_04_22'],
    contextRefs: [{ id: 'proj_clem_kitchen', kind: 'project' }],
    confidence: 0.82,
    summary:
      'Callback promised to Clem on Apr 17 has not been executed; follow-up signal Apr 22 escalated tone.',
    recommendedAction: 'Call Clem today before 5pm with the updated timeline.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateLlmDriftCandidate
// ---------------------------------------------------------------------------

test('validateLlmDriftCandidate accepts a well-formed candidate', () => {
  const out = validateLlmDriftCandidate(baseCandidate());
  assert.equal(out.pattern, 'callback_promised');
  assert.deepEqual(out.signalRefs, ['sig_clem_callback_2026_04_22']);
  assert.equal(out.confidence, 0.82);
});

test('validateLlmDriftCandidate rejects a non-object', () => {
  assert.throws(() => validateLlmDriftCandidate(null), ValidationError);
  assert.throws(() => validateLlmDriftCandidate('not-an-object'), ValidationError);
  assert.throws(() => validateLlmDriftCandidate(42), ValidationError);
});

test('validateLlmDriftCandidate rejects an unknown pattern', () => {
  const bad = { ...baseCandidate(), pattern: 'made_up_pattern' };
  assert.throws(() => validateLlmDriftCandidate(bad), ValidationError);
});

test('validateLlmDriftCandidate rejects empty signalRefs (source-or-silent)', () => {
  const bad = { ...baseCandidate(), signalRefs: [] };
  assert.throws(() => validateLlmDriftCandidate(bad), ValidationError);
});

test('validateLlmDriftCandidate rejects non-string signalRef entries', () => {
  const bad = { ...baseCandidate(), signalRefs: [42] };
  assert.throws(() => validateLlmDriftCandidate(bad), ValidationError);
});

test('validateLlmDriftCandidate rejects confidence outside [0, 1]', () => {
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), confidence: -0.01 }),
    ValidationError,
  );
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), confidence: 1.01 }),
    ValidationError,
  );
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), confidence: Number.NaN }),
    ValidationError,
  );
});

test('validateLlmDriftCandidate rejects empty summary or recommendedAction', () => {
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), summary: '' }),
    ValidationError,
  );
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), summary: '   ' }),
    ValidationError,
  );
  assert.throws(
    () => validateLlmDriftCandidate({ ...baseCandidate(), recommendedAction: '' }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// classifyDriftSeverity
// ---------------------------------------------------------------------------

test('classifyDriftSeverity ladders permit_deadline_approaching by daysToDeadline', () => {
  const high = classifyDriftSeverity('permit_deadline_approaching', {
    confidence: 0.9,
    daysToDeadline: 2,
  });
  const critical = classifyDriftSeverity('permit_deadline_approaching', {
    confidence: 0.9,
    daysToDeadline: -1,
  });
  const medium = classifyDriftSeverity('permit_deadline_approaching', {
    confidence: 0.9,
    daysToDeadline: 5,
  });
  const low = classifyDriftSeverity('permit_deadline_approaching', {
    confidence: 0.9,
    daysToDeadline: 30,
  });
  assert.equal(critical, 'critical');
  assert.equal(high, 'high');
  assert.equal(medium, 'medium');
  assert.equal(low, 'low');
});

test('classifyDriftSeverity ladders stalled_approval and callback_promised by daysOverdue', () => {
  const tiers = [
    { daysOverdue: 1, expected: 'low' as const },
    { daysOverdue: 4, expected: 'medium' as const },
    { daysOverdue: 8, expected: 'high' as const },
    { daysOverdue: 21, expected: 'critical' as const },
  ];
  for (const { daysOverdue, expected } of tiers) {
    assert.equal(
      classifyDriftSeverity('stalled_approval', { confidence: 0.9, daysOverdue }),
      expected,
    );
    assert.equal(
      classifyDriftSeverity('callback_promised', { confidence: 0.9, daysOverdue }),
      expected,
    );
  }
});

test('classifyDriftSeverity for commitment_not_followed scales with confidence', () => {
  assert.equal(
    classifyDriftSeverity('commitment_not_followed', { confidence: 0.7 }),
    'medium',
  );
  assert.equal(
    classifyDriftSeverity('commitment_not_followed', { confidence: 0.9 }),
    'high',
  );
});

test('classifyDriftSeverity floors at low when confidence < 0.5', () => {
  for (const pattern of DRIFT_PATTERNS) {
    assert.equal(
      classifyDriftSeverity(pattern, { confidence: 0.4, daysOverdue: 30, daysToDeadline: -5 }),
      'low',
      `pattern ${pattern} should floor to low under low confidence`,
    );
  }
});

// ---------------------------------------------------------------------------
// shapeRecommendedAction
// ---------------------------------------------------------------------------

test('shapeRecommendedAction prefers a non-blank LLM hint', () => {
  const action = shapeRecommendedAction({
    pattern: 'stalled_approval',
    severity: 'high',
    daysOverdue: 9,
    llmHint: 'Reach out to MoO; the approver is on PTO.',
  });
  assert.equal(action, 'Reach out to MoO; the approver is on PTO.');
});

test('shapeRecommendedAction falls back to template when hint is blank', () => {
  const action = shapeRecommendedAction({
    pattern: 'stalled_approval',
    severity: 'high',
    daysOverdue: 9,
    llmHint: '   ',
  });
  assert.match(action, /chase the approver|escalate/i);
  assert.match(action, /9 day/);
});

test('shapeRecommendedAction template per pattern is shaped and English-only', () => {
  for (const pattern of DRIFT_PATTERNS) {
    const out = shapeRecommendedAction({
      pattern,
      severity: 'medium',
      daysOverdue: 4,
      daysToDeadline: 4,
      llmHint: null,
    });
    assert.ok(typeof out === 'string' && out.length > 0, `${pattern} produced empty action`);
  }
});

// ---------------------------------------------------------------------------
// assembleDriftAlert
// ---------------------------------------------------------------------------

test('assembleDriftAlert produces a typed payload + drift.detected event template', () => {
  const alert = assembleDriftAlert(baseCandidate(), {
    clock: CLOCK,
    severityContext: { daysOverdue: 6 },
  });

  assert.equal(alert.payload.pattern, 'callback_promised');
  assert.equal(alert.payload.severity, 'medium'); // 6 days -> medium
  assert.equal(alert.payload.confidence, 0.82);
  assert.deepEqual(alert.payload.signalRefs, ['sig_clem_callback_2026_04_22']);
  assert.equal(alert.payload.detectedAt, '2026-04-28T09:00:00.000Z');

  assert.equal(alert.event.kind, 'drift.detected');
  assert.equal(alert.event.entity.kind, 'drift_alert');
  assert.equal(alert.event.workflow, 'drift_detection');
  assert.equal(alert.event.action_class, 'draft');
  assert.equal(alert.event.data_class, 'internal');
  assert.equal(alert.event.privilege_class, null);
  assert.ok(alert.event.sources.length >= 1);
});

test('assembleDriftAlert prefers LLM hint over template recommendedAction', () => {
  const alert = assembleDriftAlert(
    baseCandidate({ recommendedAction: 'Call Clem today before 5pm with the updated timeline.' }),
    { clock: CLOCK, severityContext: { daysOverdue: 6 } },
  );
  assert.equal(
    alert.payload.recommendedAction,
    'Call Clem today before 5pm with the updated timeline.',
  );
});

test('assembleDriftAlert respects severity + recommendedAction overrides', () => {
  const alert = assembleDriftAlert(baseCandidate(), {
    clock: CLOCK,
    severity: 'critical',
    recommendedAction: 'Custom override action.',
  });
  assert.equal(alert.payload.severity, 'critical');
  assert.equal(alert.payload.recommendedAction, 'Custom override action.');
});

test('assembleDriftAlert calls the runtime guard and rejects margin language', () => {
  assert.throws(
    () =>
      assembleDriftAlert(
        baseCandidate({ summary: 'Project margin slipped this week — escalate.' }),
        { clock: CLOCK },
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      assembleDriftAlert(
        baseCandidate({ recommendedAction: 'Review the margin against the approved scope.' }),
        { clock: CLOCK },
      ),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// assertDriftDetectedPayloadValid (direct)
// ---------------------------------------------------------------------------

test('assertDriftDetectedPayloadValid rejects empty signalRefs', () => {
  const payload: DriftDetectedPayload = {
    alertId: 'd1',
    pattern: 'callback_promised',
    severity: 'low',
    confidence: 0.6,
    signalRefs: [],
    summary: 'Test summary.',
    recommendedAction: 'Test action.',
    detectedAt: '2026-04-28T09:00:00.000Z',
  };
  assert.throws(() => assertDriftDetectedPayloadValid(payload), ValidationError);
});

test('assertDriftDetectedPayloadValid rejects out-of-range confidence', () => {
  const base: DriftDetectedPayload = {
    alertId: 'd1',
    pattern: 'callback_promised',
    severity: 'low',
    confidence: 0.6,
    signalRefs: ['s1'],
    summary: 'Test summary.',
    recommendedAction: 'Test action.',
    detectedAt: '2026-04-28T09:00:00.000Z',
  };
  assert.throws(
    () => assertDriftDetectedPayloadValid({ ...base, confidence: 1.5 }),
    ValidationError,
  );
  assert.throws(
    () => assertDriftDetectedPayloadValid({ ...base, confidence: -0.1 }),
    ValidationError,
  );
});

test('assertDriftDetectedPayloadValid blocks margin language in summary or recommendedAction', () => {
  const base: DriftDetectedPayload = {
    alertId: 'd1',
    pattern: 'callback_promised',
    severity: 'low',
    confidence: 0.6,
    signalRefs: ['s1'],
    summary: 'Margin appears off — investigate.',
    recommendedAction: 'Call client.',
    detectedAt: '2026-04-28T09:00:00.000Z',
  };
  assert.throws(() => assertDriftDetectedPayloadValid(base), ValidationError);
  assert.throws(
    () =>
      assertDriftDetectedPayloadValid({
        ...base,
        summary: 'OK summary.',
        recommendedAction: 'Re-check the margin.',
      }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// renderDriftSurface
// ---------------------------------------------------------------------------

function makeAlert(
  alertId: string,
  severity: DriftDetectedPayload['severity'],
  detectedAt: string,
  summary = 'Test summary.',
): DriftAlert {
  const candidate = baseCandidate({
    summary,
    recommendedAction: 'Do the thing.',
  });
  return assembleDriftAlert(candidate, {
    alertId,
    clock: fixedClock(detectedAt),
    severity,
  });
}

test('renderDriftSurface sorts by severity desc then detectedAt asc', () => {
  const alerts = [
    makeAlert('a-low', 'low', '2026-04-28T08:00:00.000Z'),
    makeAlert('b-critical-late', 'critical', '2026-04-28T08:30:00.000Z'),
    makeAlert('c-critical-early', 'critical', '2026-04-28T08:10:00.000Z'),
    makeAlert('d-medium', 'medium', '2026-04-28T08:00:00.000Z'),
  ];
  const surface = renderDriftSurface(alerts, {
    recipient: 'U_CHRISTIAN_SLACK',
    clock: CLOCK,
  });
  assert.deepEqual(surface.surfacedAlertIds, [
    'c-critical-early',
    'b-critical-late',
    'd-medium',
    'a-low',
  ]);
});

test('renderDriftSurface limits to topN', () => {
  const alerts = Array.from({ length: 10 }, (_, i) =>
    makeAlert(`alert-${i}`, 'medium', `2026-04-28T08:0${i}:00.000Z`),
  );
  const surface = renderDriftSurface(alerts, {
    recipient: 'U_CHRISTIAN_SLACK',
    clock: CLOCK,
    topN: 3,
  });
  assert.equal(surface.surfacedAlertIds.length, 3);
  assert.equal(surface.surfacedEvents.length, 3);
});

test('renderDriftSurface emits one drift.surfaced event per surfaced alert with shared surfacedAt + message', () => {
  const alerts = [
    makeAlert('alpha', 'high', '2026-04-28T08:00:00.000Z', 'Alpha summary.'),
    makeAlert('beta', 'medium', '2026-04-28T08:01:00.000Z', 'Beta summary.'),
  ];
  const surface = renderDriftSurface(alerts, {
    recipient: 'U_CHRISTIAN_SLACK',
    clock: CLOCK,
  });

  assert.equal(surface.surfacedEvents.length, 2);
  for (const ev of surface.surfacedEvents) {
    assert.equal(ev.kind, 'drift.surfaced');
    assert.equal(ev.workflow, 'drift_detection');
    assert.equal(ev.action_class, 'send_external');
    assert.equal((ev.payload as DriftSurfacedPayload).surfacedAt, surface.surfacedAt);
    assert.equal((ev.payload as DriftSurfacedPayload).surfaceMessage, surface.surfaceMessage);
    assert.equal((ev.payload as DriftSurfacedPayload).channel, 'slack');
    assert.equal((ev.payload as DriftSurfacedPayload).recipient, 'U_CHRISTIAN_SLACK');
  }
  assert.match(surface.surfaceMessage, /2 drift items caught this morning/);
  assert.match(surface.surfaceMessage, /Alpha summary/);
  assert.match(surface.surfaceMessage, /Beta summary/);
});

test('renderDriftSurface handles empty alert list', () => {
  const surface = renderDriftSurface([], {
    recipient: 'U_CHRISTIAN_SLACK',
    clock: CLOCK,
  });
  assert.equal(surface.surfacedAlertIds.length, 0);
  assert.equal(surface.surfacedEvents.length, 0);
  assert.equal(surface.surfaceMessage, 'No drift items detected this morning.');
});

test('renderDriftSurface uses singular wording for exactly one alert', () => {
  const surface = renderDriftSurface(
    [makeAlert('only', 'high', '2026-04-28T08:00:00.000Z')],
    { recipient: 'U_CHRISTIAN_SLACK', clock: CLOCK },
  );
  assert.match(surface.surfaceMessage, /1 drift item caught this morning/);
});

// ---------------------------------------------------------------------------
// applyDriftDisposition
// ---------------------------------------------------------------------------

test('applyDriftDisposition routes act -> drift.acted', () => {
  const alert = makeAlert('a1', 'high', '2026-04-28T08:00:00.000Z');
  const result = applyDriftDisposition(
    alert,
    { disposition: 'act', followUpNote: 'Calling at 4pm.' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(result.event.kind, 'drift.acted');
  assert.equal(result.payload.disposition, 'act');
  assert.equal(result.payload.followUpNote, 'Calling at 4pm.');
  assert.equal(result.payload.promptTuningHint, null);
});

test('applyDriftDisposition routes noted -> drift.noted', () => {
  const alert = makeAlert('a2', 'medium', '2026-04-28T08:00:00.000Z');
  const result = applyDriftDisposition(
    alert,
    { disposition: 'noted' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(result.event.kind, 'drift.noted');
  assert.equal(result.payload.disposition, 'noted');
  assert.equal(result.payload.promptTuningHint, null);
});

test('applyDriftDisposition routes false_positive -> drift.false_positive and preserves the prompt-tuning hint', () => {
  const alert = makeAlert('a3', 'low', '2026-04-28T08:00:00.000Z');
  const result = applyDriftDisposition(
    alert,
    { disposition: 'false_positive', promptTuningHint: 'Inbound vs outbound parsing.' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(result.event.kind, 'drift.false_positive');
  assert.equal(result.payload.disposition, 'false_positive');
  assert.equal(result.payload.promptTuningHint, 'Inbound vs outbound parsing.');
  assert.equal(result.payload.followUpNote, null);
});

test('applyDriftDisposition discards followUpNote on false_positive and discards promptTuningHint on act/noted', () => {
  const alert = makeAlert('a4', 'high', '2026-04-28T08:00:00.000Z');

  // act: followUpNote preserved, promptTuningHint forced to null
  const acted = applyDriftDisposition(
    alert,
    { disposition: 'act', followUpNote: 'Will call later.' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(acted.payload.followUpNote, 'Will call later.');
  assert.equal(acted.payload.promptTuningHint, null);

  // false_positive with followUpNote slipped in: dropped silently because
  // the discriminated union already excludes it from the input type, but
  // we also never read it from the input on the false_positive branch.
  const fp = applyDriftDisposition(
    alert,
    { disposition: 'false_positive', promptTuningHint: 'tune' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(fp.payload.followUpNote, null);
});

// ---------------------------------------------------------------------------
// End-to-end pipeline
// ---------------------------------------------------------------------------

test('end-to-end pipeline: validate -> assemble -> render -> dispose', () => {
  const raw = {
    pattern: 'permit_deadline_approaching',
    signalRefs: ['sig_permit_001'],
    confidence: 0.9,
    summary: 'Building permit for project Acme expires in 2 days.',
    recommendedAction: 'Submit final inspection request today.',
  };

  // 1. validate
  const candidate = validateLlmDriftCandidate(raw);
  assert.equal(candidate.pattern, 'permit_deadline_approaching');

  // 2. assemble
  const alert = assembleDriftAlert(candidate, {
    alertId: 'drift_acme_permit',
    clock: CLOCK,
    severityContext: { daysToDeadline: 2 },
  });
  assert.equal(alert.payload.severity, 'high');
  assert.equal(alert.event.kind, 'drift.detected');

  // 3. render surface
  const surface = renderDriftSurface([alert], {
    recipient: 'U_CHRISTIAN_SLACK',
    clock: CLOCK,
  });
  assert.equal(surface.surfacedEvents.length, 1);
  assert.match(surface.surfaceMessage, /1 drift item caught this morning/);

  // 4. dispose
  const result = applyDriftDisposition(
    alert,
    { disposition: 'act', followUpNote: 'Submitting today.' },
    { dispositionedBy: ACTOR_CHRISTIAN, clock: CLOCK },
  );
  assert.equal(result.event.kind, 'drift.acted');
  assert.equal((result.payload as DriftDispositionedPayload).alertId, 'drift_acme_permit');
});
