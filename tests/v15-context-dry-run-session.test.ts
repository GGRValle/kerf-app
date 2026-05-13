import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../src/demo/index.js';
import type { FieldCaptureHandoffV1 } from '../src/examples/field-capture-mock.js';
import { buildTranscriptReviewRailHtml } from '../src/examples/v15-vertical-slice/f34-transcript-review-html.js';
import {
  f34ResetDemoState,
  getF34ClarificationAnswers,
  setF34ClarificationAnswer,
} from '../src/examples/v15-vertical-slice/f34-transcript-review-state.js';
import { buildPage } from '../src/examples/v15-vertical-slice/pages.js';
import {
  v15BuildContextDryRunFixtureFromHandoff,
  v15ClearContextDryRunFixture,
  v15PersistContextDryRunFromHandoff,
  v15RefreshContextDryRunFromSession,
} from '../src/examples/v15-vertical-slice/v15-context-dry-run-session.js';

const handoff: FieldCaptureHandoffV1 = {
  v: 1,
  project_id: 'proj_clem_kitchen',
  project_name: 'Clem · kitchen refresh',
  client_name: 'Clem Henderson',
  location: 'North Park, San Diego, CA',
  workflow: 'estimate',
  modes: ['text_note', 'photo', 'manual_transcript'],
  text_note:
    'Client wants to move 2 outlets on the kitchen north wall. Add 2 pantry shelves 12 inches deep. Cabinet scope is unclear and needs confirmation.',
  manual_transcript:
    'Also verify whether the backsplash tile is included or just an allowance. Do not send to the client yet.',
  photos: [
    {
      id: 'photo_context_001',
      label: 'Kitchen north wall',
      tags: ['room', 'measurement'],
    },
  ],
  created_at_iso: '2026-05-12T17:30:00.000Z',
};

function installSessionStorageMock(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  return () => {
    if (original === undefined) {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    } else {
      Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  };
}

test('V1.5 context dry-run builder preserves one spine packet id and project context', () => {
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff);

  assert.equal(fixture.decision_packet.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.decision_packet_raw.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.altitude_packet.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.field_capture_input.project_id, handoff.project_id);
  assert.equal(fixture.field_capture_payload.project_name, handoff.project_name);
  assert.equal(fixture.decision_packet.project_name, handoff.project_name);
  assert.equal(fixture.decision_packet.client_name, handoff.client_name);
});

test('V1.5 context dry-run builder turns typed context into transcript, scope, and draft review data', () => {
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff);
  const currentTranscript = fixture.field_capture_payload.transcript.transcript_current
    .map((segment) => segment.text)
    .join(' ');
  const draftText = fixture.draft_review_payload_ui.draft_lines
    .map((line) => line.description)
    .join(' ');

  assert.match(fixture.field_capture_input.transcript_original, /move 2 outlets/);
  assert.match(currentTranscript, /pantry shelves 12 inches deep/i);
  assert.ok(
    fixture.field_capture_payload.scope_lines.some((line) => line.category === 'electrical' && line.quantity === 2),
    'expected a generated electrical scope line from typed context',
  );
  assert.ok(
    fixture.field_capture_payload.scope_lines.some(
      (line) => line.description.includes('pantry shelves 12 inches deep')
        && line.missing_info?.includes('Quantity requires operator review'),
    ),
    'expected quantity ambiguity to be flagged for operator review',
  );
  assert.match(draftText, /backsplash tile/i);
  assert.ok(
    fixture.source_refs.some(
      (ref) => ref.type === 'photo' && (ref.uri?.includes('photo_context_001') || ref.excerpt?.includes('Kitchen north wall')),
    ),
  );
});

test('V1.5 context dry-run builder keeps pricing and external action authority blocked', () => {
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff);

  for (const line of fixture.draft_review_payload_ui.draft_lines) {
    assert.equal(Number.isInteger(line.amount_cents), true, `${line.id}: amount_cents must be integer cents`);
    assert.equal(line.amount_cents, 0, `${line.id}: local context dry-run must not invent pricing authority`);
    assert.ok(
      line.unsafe_to_send_flags.includes('human_approval_required_before_external_send'),
      `${line.id}: external sends must remain blocked`,
    );
  }

  assert.equal(fixture.decision_packet.external_send_allowed, false);
  assert.equal(fixture.decision_packet.requires_human_approval, true);
  assert.equal(fixture.decision_packet.system_final_altitude, fixture.decision_packet_raw.system_final_altitude);
  assert.equal(fixture.decision_packet.model_suggested_altitude, fixture.decision_packet_raw.model_suggested_altitude);
  assert.match(JSON.stringify(fixture), /audit_redacted|local_dev/);
  assert.doesNotMatch(JSON.stringify(fixture), /Powered by|Llama|Groq/i);
});

test('V1.5 context dry-run builder emits audit and Blackboard preview data for F-37', () => {
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff);

  assert.ok(fixture.audit_timeline.length > 0, 'expected audit timeline events');
  assert.ok(fixture.audit_events.length > 0, 'expected audit event list');
  assert.deepEqual(
    fixture.audit_events.map((event) => event.id),
    fixture.audit_timeline.map((event) => event.id),
  );
  assert.equal(fixture.blackboard_write_preview.mode, 'preview_only');
  assert.equal(fixture.blackboard_write_preview.persistence_performed, false);
  assert.match(fixture.blackboard_write_preview.proposed_markdown, /Policy Gate|DecisionPacket|field-capture/i);
});

test('V1.5 pages render the persisted context dry-run across Draft, Decision, and Audit', () => {
  v15PersistContextDryRunFromHandoff(handoff);
  try {
    const draft = buildPage({ name: 'draft-review' }).bodyHtml;
    const decision = buildPage({ name: 'decision-detail', id: VERTICAL_SLICE_FLOW_PACKET_ID }).bodyHtml;
    const audit = buildPage({ name: 'audit-detail', packetId: VERTICAL_SLICE_FLOW_PACKET_ID }).bodyHtml;
    const blackboard = buildPage({ name: 'blackboard' });

    assert.match(draft, /backsplash tile/i);
    assert.match(draft, /External send requires approval/i);
    assert.match(decision, /Clem · kitchen refresh/);
    assert.match(decision, /system_final_altitude/);
    assert.match(audit, /Client wants to move 2 outlets/i);
    assert.match(audit, /Blackboard write preview/);
    assert.equal(blackboard.notice, 'Preview only — no graph queries or writes.');
    assert.match(blackboard.bodyHtml, /Current dry-run memory preview/);
    assert.match(blackboard.bodyHtml, /Scope memory candidates/);
    assert.match(blackboard.bodyHtml, /Client wants to move 2 outlets/i);
    assert.match(blackboard.bodyHtml, /Persistence<\/dt><dd>Not performed/);
    assert.equal(blackboard.bodyHtml.includes('Blackboard placeholder'), false);
  } finally {
    v15ClearContextDryRunFixture();
  }
});

test('F-34 clarification prompts follow the current context dry-run and reset visibly clears answers', () => {
  const restoreStorage = installSessionStorageMock();
  sessionStorage.setItem('kerf_field_capture_handoff_v1', JSON.stringify(handoff));
  v15PersistContextDryRunFromHandoff(handoff);
  try {
    const initialRail = buildTranscriptReviewRailHtml();
    assert.match(initialRail, /2 shelves at 12 in depth/);
    assert.match(initialRail, /Should cabinetry be priced in this draft/);
    assert.match(initialRail, /Continue to Draft/);
    assert.doesNotMatch(initialRail, /disabled aria-describedby/);
    assert.doesNotMatch(initialRail, /Clear answered clarifications/);

    const quantityId = 'clarify-quantity-field_capture_context_proj_clem_kitchen-scope_002';
    assert.match(initialRail, new RegExp(quantityId));
    setF34ClarificationAnswer(quantityId, '2 shelves');
    v15RefreshContextDryRunFromSession(getF34ClarificationAnswers());

    const resolvedRail = buildTranscriptReviewRailHtml();
    assert.doesNotMatch(resolvedRail, /What quantity should Kerf use for/);
    assert.match(resolvedRail, /Clear answered clarifications/);

    f34ResetDemoState();
    v15RefreshContextDryRunFromSession({});
    const resetRail = buildTranscriptReviewRailHtml();
    assert.match(resetRail, /Open/);
    assert.doesNotMatch(resetRail, /Clear answered clarifications/);
  } finally {
    v15ClearContextDryRunFixture();
    restoreStorage();
  }
});

test('clarification answers update generated draft review and Blackboard preview without pricing authority', () => {
  const restoreStorage = installSessionStorageMock();
  sessionStorage.setItem('kerf_field_capture_handoff_v1', JSON.stringify(handoff));
  v15PersistContextDryRunFromHandoff(handoff);
  try {
    const before = buildPage({ name: 'draft-review' }).bodyHtml;
    assert.match(before, /Missing: Quantity requires operator review/);

    setF34ClarificationAnswer('clarify-quantity-field_capture_context_proj_clem_kitchen-scope_002', '2 shelves');
    setF34ClarificationAnswer('clarify-allowance-field_capture_context_proj_clem_kitchen-scope_004', 'allowance only');
    v15RefreshContextDryRunFromSession(getF34ClarificationAnswers());

    const afterDraft = buildPage({ name: 'draft-review' }).bodyHtml;
    const blackboard = buildPage({ name: 'blackboard' }).bodyHtml;
    const shelfLine = /data-kerf-f35-line-id="field_capture_context_proj_clem_kitchen:draft_line_002"[\s\S]*?<\/li>/.exec(afterDraft)?.[0] ?? '';

    assert.match(shelfLine, />2<\/strong> shelf/);
    assert.match(shelfLine, /Quantity clarified by operator/);
    assert.match(afterDraft, /operator clarified/i);
    assert.doesNotMatch(shelfLine, /Missing: Quantity requires operator review/);
    assert.match(blackboard, /Clarification review/);
    assert.match(blackboard, /Answered: Is this 2 shelves at 12 in depth/);
    assert.match(blackboard, /allowance only/);
  } finally {
    v15ClearContextDryRunFixture();
    restoreStorage();
  }
});

test('V1.5 context dry-run source is local-only and pages consume the active fixture', () => {
  const sessionSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-context-dry-run-session.ts', import.meta.url),
    'utf8',
  );
  const appSrc = readFileSync(new URL('../src/examples/v15-vertical-slice/app.ts', import.meta.url), 'utf8');
  const pagesSrc = readFileSync(new URL('../src/examples/v15-vertical-slice/pages.ts', import.meta.url), 'utf8');

  for (const src of [sessionSrc, appSrc, pagesSrc]) {
    assert.equal(/\bfetch\s*\(/.test(src), false, 'context dry-run must not fetch');
    assert.equal(/createJsonlEventLog|createMemoryEventLog|\.append\s*\(/.test(src), false, 'context dry-run must not persist backend events');
  }

  for (const src of [sessionSrc, appSrc]) {
    assert.equal(/send_external|qbo|quickbooks|stripe|payment/i.test(src), false, 'context dry-run must not add external or money side effects');
  }

  assert.match(appSrc, /v15PersistContextDryRunFromHandoff/);
  assert.match(pagesSrc, /v15GetActiveVerticalSliceFixture/);
  assert.match(pagesSrc, /f35FixtureFromVerticalSliceDryRun\(v15GetActiveVerticalSliceFixture\(\)\)/);
  assert.match(pagesSrc, /f36ModelFromVerticalSliceFixture\(v15GetActiveVerticalSliceFixture\(\)\)/);
  assert.match(pagesSrc, /buildF37AuditPageHtml\(packet, sel, 'embedded', fixtureForPacket\)/);
});
