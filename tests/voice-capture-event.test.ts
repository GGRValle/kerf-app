import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEventLog, type Event, type VoiceMemoEvidencePayload } from '../src/blackboard/index.js';
import { voiceCaptureToEventTemplate } from '../src/evidence/index.js';
import { ValidationError } from '../src/shared/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const CAPTURED_AT = '2026-05-05T22:30:00.000Z';

function baseInput() {
  return {
    evidenceId: 'evidence_voice_001',
    projectId: 'project_demo_kitchen',
    uri: 'kerf://tenant/tenant_ggr/evidence/voice/corr_001/2026-05-05T22-30-00.opus',
    durationMs: 12_500,
    capturedAt: CAPTURED_AT,
    actor: ACTORS.christian,
  } as const;
}

test('voiceCaptureToEventTemplate emits evidence.captured with voice_memo payload', () => {
  const template = voiceCaptureToEventTemplate(baseInput());

  assert.equal(template.kind, 'evidence.captured');
  assert.equal(template.payload.kind, 'voice_memo');
  assert.equal(template.payload.evidenceId, 'evidence_voice_001');
  assert.equal(template.payload.projectId, 'project_demo_kitchen');
  assert.equal(template.payload.durationMs, 12_500);
  assert.equal(template.payload.capturedBy, ACTORS.christian.id);
  assert.equal(template.payload.capturedByRole, ACTORS.christian.role);
  assert.equal(template.payload.sourceClass, 'PROJECT_EVIDENCE');
  assert.equal(template.payload.captureSurface, 'mobile_shell');
  assert.equal(template.workflow, 'voice_tour');
  assert.equal(template.action_class, 'read_only');
  assert.equal(template.decision_altitude, 'L0');
});

test('voiceCaptureToEventTemplate threads optional jurisdiction + GPS fields when provided', () => {
  const template = voiceCaptureToEventTemplate({
    ...baseInput(),
    jurisdiction: 'US-CA',
    capturedAtLat: 33.0188,
    capturedAtLon: -116.8467,
    capturedGeofenceId: 'geofence_demo_kitchen',
  });

  assert.equal(template.payload.jurisdiction, 'US-CA');
  assert.equal(template.payload.capturedAtLat, 33.0188);
  assert.equal(template.payload.capturedAtLon, -116.8467);
  assert.equal(template.payload.capturedGeofenceId, 'geofence_demo_kitchen');
});

test('voiceCaptureToEventTemplate omits optional fields entirely when not provided', () => {
  const template = voiceCaptureToEventTemplate(baseInput());

  assert.equal('jurisdiction' in template.payload, false);
  assert.equal('capturedAtLat' in template.payload, false);
  assert.equal('capturedAtLon' in template.payload, false);
  assert.equal('capturedGeofenceId' in template.payload, false);
});

test('voiceCaptureToEventTemplate rejects non-kerf:// URIs', () => {
  for (const badUri of ['https://example.com/audio.opus', '/local/path/audio.opus', '', 'kerf:badscheme']) {
    assert.throws(
      () => voiceCaptureToEventTemplate({ ...baseInput(), uri: badUri }),
      ValidationError,
      'expected throw for uri=' + badUri,
    );
  }
});

test('voiceCaptureToEventTemplate rejects non-positive or non-finite durationMs', () => {
  for (const badDuration of [0, -100, Number.NaN, Number.POSITIVE_INFINITY] as const) {
    assert.throws(
      () => voiceCaptureToEventTemplate({ ...baseInput(), durationMs: badDuration as number }),
      ValidationError,
      'expected throw for durationMs=' + String(badDuration),
    );
  }
});

test('voiceCaptureToEventTemplate produces a SourceRef carrying the audio uri', () => {
  const template = voiceCaptureToEventTemplate(baseInput());
  assert.equal(template.sources.length, 1);
  assert.equal(template.sources[0]?.kind, 'voice');
  assert.equal(template.sources[0]?.uri, baseInput().uri);
});

test('voice capture event round-trips through createMemoryEventLog with frozen payload', async () => {
  const log = createMemoryEventLog();
  const template = voiceCaptureToEventTemplate(baseInput());

  const event: Event<VoiceMemoEvidencePayload> = {
    id: 'evt_voice_test_1',
    at: CAPTURED_AT,
    actor: ACTORS.christian,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
  };

  const stored = await log.append(event);
  assert.equal(stored.kind, 'evidence.captured');
  assert.equal((stored.payload as VoiceMemoEvidencePayload).kind, 'voice_memo');

  const byEntity = await log.byEntity(template.entity.id);
  assert.equal(byEntity.length, 1);
  assert.equal(byEntity[0]?.id, 'evt_voice_test_1');
});
