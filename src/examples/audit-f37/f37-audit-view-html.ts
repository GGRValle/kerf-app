/**
 * F-37 audit / event stream — pure HTML builders (no DOM, no fetch).
 * Used by the standalone demo bundle and the V1.5 vertical slice (8010).
 */
import type { DecisionPacket, ValidatorResult } from '../../altitude/index.js';
import type { SourceRef } from '../../blackboard/index.js';
import {
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from '../../test-fixtures/index.js';
import {
  verticalSliceFieldCaptureDemoFixture,
  type BlackboardWritePreview,
  type TranscriptModel,
  type VerticalSliceAuditEvent,
  type VerticalSliceDryRunDemoFixture,
  type VerticalSliceSourceRef,
  type VerticalSliceValidatorResult,
} from '../../demo/index.js';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../../demo/verticalSliceFlowIds.js';
import { escapeHtml } from '../../ui/index.js';

export const F37_DEFAULT_PACKET_ID = VERTICAL_SLICE_FLOW_PACKET_ID;

export type F37TimelineKind = string;

export interface F37TimelineEvent {
  id: string;
  kind: F37TimelineKind;
  at: string;
  actorId: string;
  actorLabel: string;
  auditNote: string;
  sourceRefs: readonly SourceRef[];
  beforeAfter?: { before: string; after: string };
  metadata?: Readonly<Record<string, unknown>>;
}

const TRANSCRIPT_ORIGINAL = `[00:00] PM: Walked kitchen with homeowner.\n[04:12] Homeowner: We want the pantry wall opened to the dining room.\n[08:40] PM: Noted — will price as optional scope line.`;

const TRANSCRIPT_EDIT_SNIPPET =
  '[12:05] PM (edit): Clarified pantry is load-bearing — option is cased opening, not full removal.';

function transcriptCurrentDisplay(): string {
  return `${TRANSCRIPT_ORIGINAL}\n\n— overlay —\n${TRANSCRIPT_EDIT_SNIPPET}`;
}

export function resolveF37Packet(packetId: string): DecisionPacket | null {
  if (packetId === verticalSliceFieldCaptureDemoFixture.decision_packet_raw.packet_id) {
    return verticalSliceFieldCaptureDemoFixture.decision_packet_raw;
  }
  if (packetId === proposalDecisionPacketFixture.packet_id) {
    return proposalDecisionPacketFixture;
  }
  if (packetId === invoiceDecisionPacketFixture.packet_id) {
    return invoiceDecisionPacketFixture;
  }
  return null;
}

function offsetIso(iso: string, addMinutes: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  return new Date(t + addMinutes * 60_000).toISOString();
}

function generatedFixtureForPacket(
  packet: DecisionPacket,
  fixtureOverride?: VerticalSliceDryRunDemoFixture,
): VerticalSliceDryRunDemoFixture | null {
  if (
    fixtureOverride !== undefined &&
    packet.packet_id === fixtureOverride.decision_packet_raw.packet_id
  ) {
    return fixtureOverride;
  }
  if (packet.packet_id !== verticalSliceFieldCaptureDemoFixture.decision_packet_raw.packet_id) {
    return null;
  }
  return verticalSliceFieldCaptureDemoFixture;
}

function sourceRefKind(type: string): SourceRef['kind'] {
  if (type === 'voice' || type === 'photo' || type === 'transcript' || type === 'doc') {
    return type;
  }
  return 'external';
}

function sourceRefFromVertical(source: VerticalSliceSourceRef): SourceRef {
  return {
    kind: sourceRefKind(source.type),
    ...(source.uri !== undefined ? { uri: source.uri } : {}),
    ...(source.excerpt !== undefined ? { excerpt: source.excerpt } : {}),
  };
}

function sourceRefsForAuditEvent(
  ev: VerticalSliceAuditEvent,
  fixture: VerticalSliceDryRunDemoFixture,
): readonly SourceRef[] {
  const ids = ev.source_ref_ids ?? [];
  const selected = ids.length > 0
    ? fixture.source_refs.filter((source) => ids.includes(source.id))
    : fixture.source_refs;
  return selected.map(sourceRefFromVertical);
}

function formatAuditValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
}

function formatAuditObject(value: Readonly<Record<string, unknown>> | undefined): string {
  if (value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

function buildGeneratedF37Timeline(fixture: VerticalSliceDryRunDemoFixture): F37TimelineEvent[] {
  return fixture.audit_timeline.map((ev) => ({
    id: ev.id,
    kind: ev.type,
    at: ev.created_at,
    actorId: ev.actor,
    actorLabel: ev.actor,
    auditNote: ev.summary,
    sourceRefs: sourceRefsForAuditEvent(ev, fixture),
    ...(ev.before !== undefined || ev.after !== undefined
      ? {
          beforeAfter: {
            before: formatAuditValue(ev.before),
            after: formatAuditValue(ev.after),
          },
        }
      : {}),
    ...(ev.metadata !== undefined ? { metadata: ev.metadata } : {}),
  }));
}

export function buildF37Timeline(
  packet: DecisionPacket,
  fixtureOverride?: VerticalSliceDryRunDemoFixture,
): F37TimelineEvent[] {
  const generatedFixture = generatedFixtureForPacket(packet, fixtureOverride);
  if (generatedFixture !== null) {
    return buildGeneratedF37Timeline(generatedFixture);
  }

  const t0 = packet.created_at;
  return [
    {
      id: 'ev_field',
      kind: 'field_capture_created',
      at: offsetIso(t0, -25),
      actorId: 'u_field',
      actorLabel: 'Field tech',
      auditNote: 'Voice + photo capture anchored to project; immutable ingest record.',
      sourceRefs: [{ kind: 'external', uri: 'kerf://capture/session_8841', excerpt: 'Kitchen walk + voice note' }],
    },
    {
      id: 'ev_tx_orig',
      kind: 'transcript_original_saved',
      at: offsetIso(t0, -22),
      actorId: 'cos_agent',
      actorLabel: 'Right Hand',
      auditNote: 'Original transcript stored as authoritative source; never rewritten in place.',
      sourceRefs: [{ kind: 'external', uri: 'kerf://transcript/original_tx_8841', excerpt: 'ASR + diarization bundle' }],
    },
    {
      id: 'ev_tx_edit',
      kind: 'transcript_edit_added',
      at: offsetIso(t0, -18),
      actorId: 'u_pm',
      actorLabel: 'PM',
      auditNote: 'Overlay edit event; readers render current view as original + ordered edits.',
      sourceRefs: [{ kind: 'external', uri: 'kerf://transcript/edit_12', excerpt: 'Load-bearing clarification' }],
      beforeAfter: {
        before: 'optional full removal',
        after: 'cased opening (load-bearing)',
      },
    },
    {
      id: 'ev_missing',
      kind: 'missing_info_resolved',
      at: offsetIso(t0, -15),
      actorId: 'u_pm',
      actorLabel: 'PM',
      auditNote: 'Missing structural detail resolved before scope extraction.',
      sourceRefs: [],
    },
    {
      id: 'ev_scope',
      kind: 'scope_items_extracted',
      at: offsetIso(t0, -12),
      actorId: 'cos_agent',
      actorLabel: 'Right Hand',
      auditNote: 'Structured scope lines extracted for estimator + gate context.',
      sourceRefs: [{ kind: 'external', uri: 'kerf://scope/bundle_441', excerpt: '3 scope items' }],
    },
    {
      id: 'ev_draft',
      kind: 'draft_review_created',
      at: offsetIso(t0, -8),
      actorId: 'cos_agent',
      actorLabel: 'Right Hand',
      auditNote: 'Draft client-facing artifact prepared for human review (not sent).',
      sourceRefs: packet.source_refs.slice(0, 1),
    },
    {
      id: 'ev_gate',
      kind: 'policy_gate_ran',
      at: packet.policy_gate_result.evaluated_at,
      actorId: 'system',
      actorLabel: 'Policy Gate',
      auditNote: `Gate ${packet.policy_gate_result.gate_version} evaluated; validator wall recorded (display-only in this demo).`,
      sourceRefs: [{ kind: 'external', uri: `kerf://gate/${packet.policy_gate_result.gate_run_id}`, excerpt: 'Validator run bundle' }],
    },
    {
      id: 'ev_validators',
      kind: 'validator_result_added',
      at: packet.policy_gate_result.evaluated_at,
      actorId: 'system',
      actorLabel: 'Validators',
      auditNote: `${packet.policy_gate_result.validator_results.length}-validator canonical order persisted on DecisionPacket (read-only render).`,
      sourceRefs: [],
    },
    {
      id: 'ev_packet',
      kind: 'decision_packet_emitted',
      at: packet.policy_gate_result.evaluated_at,
      actorId: 'system',
      actorLabel: 'Altitude pipeline',
      auditNote: 'DecisionPacket emitted with authoritative altitude + review requirement.',
      sourceRefs: packet.source_refs,
    },
    {
      id: 'ev_bb',
      kind: 'blackboard_write_previewed',
      at: packet.policy_gate_result.evaluated_at,
      actorId: 'u_christian',
      actorLabel: 'Owner',
      auditNote: 'Preview of rails + summary that would post after explicit operator commit (no write in this demo).',
      sourceRefs: [{ kind: 'external', uri: 'kerf://blackboard/preview', excerpt: 'Dry-run projection' }],
    },
  ];
}

function validatorStatusPill(v: ValidatorResult): { label: string; className: string } {
  if (v.passed) {
    return { label: 'pass', className: 'kerf-f37__pill kerf-f37__pill--pass' };
  }
  if (v.critical) {
    return { label: 'block', className: 'kerf-f37__pill kerf-f37__pill--block' };
  }
  return { label: 'warn', className: 'kerf-f37__pill kerf-f37__pill--warn' };
}

function renderSourceRefs(refs: readonly SourceRef[]): string {
  if (refs.length === 0) {
    return '<p class="kerf-muted">None</p>';
  }
  return `<ul class="kerf-f37__refs">${refs
    .map(
      (r) =>
        `<li><span class="kerf-f37__mono">${escapeHtml(r.kind)} · ${escapeHtml(r.uri ?? '(no uri)')}</span>${
          r.excerpt ? `<div>${escapeHtml(r.excerpt)}</div>` : ''
        }</li>`,
    )
    .join('')}</ul>`;
}

function renderHeader(packet: DecisionPacket): string {
  const client = String(packet.extracted_facts.client_name ?? '—');
  const project = String(packet.extracted_facts.project_id ?? packet.project_id ?? '—');
  return `
  <header class="kerf-f37__header">
    <h1>Audit trail · ${escapeHtml(packet.workflow.replace(/_/g, ' '))}</h1>
    <dl class="kerf-f37__header-grid">
      <div><dt>Packet</dt><dd class="kerf-f37__mono">${escapeHtml(packet.packet_id)}</dd></div>
      <div><dt>Project</dt><dd>${escapeHtml(project)}</dd></div>
      <div><dt>Client</dt><dd>${escapeHtml(client)}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(packet.created_at)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(packet.status)}</dd></div>
      <div><dt>System final altitude</dt><dd>${escapeHtml(packet.system_final_altitude)}</dd></div>
    </dl>
  </header>`;
}

function renderTimeline(events: readonly F37TimelineEvent[], selectedId: string): string {
  return `
  <nav class="kerf-f37__timeline" aria-label="Event timeline">
    <h2>Timeline</h2>
    ${events
      .map((e) => {
        const active = e.id === selectedId ? ' kerf-f37__tl-item--active' : '';
        return `<button type="button" class="kerf-f37__tl-item${active}" data-f37-event="${escapeHtml(e.id)}">
          <span class="kerf-f37__tl-type">${escapeHtml(e.kind)}</span>
          <span class="kerf-f37__tl-time">${escapeHtml(e.at)}</span>
        </button>`;
      })
      .join('')}
  </nav>`;
}

function renderDetail(ev: F37TimelineEvent): string {
  const ba = ev.beforeAfter
    ? `<dt>Before / after</dt><dd><div class="kerf-f37__mono">${escapeHtml(ev.beforeAfter.before)} → ${escapeHtml(
        ev.beforeAfter.after,
      )}</div></dd>`
    : '';
  return `
  <section class="kerf-f37__detail" aria-live="polite">
    <h2>Event detail</h2>
    <dl>
      <dt>Type</dt><dd>${escapeHtml(ev.kind)}</dd>
      <dt>Actor</dt><dd>${escapeHtml(ev.actorLabel)} <span class="kerf-f37__mono">(${escapeHtml(ev.actorId)})</span></dd>
      <dt>Timestamp</dt><dd>${escapeHtml(ev.at)}</dd>
      <dt>Source refs</dt><dd>${renderSourceRefs(ev.sourceRefs)}</dd>
      ${ba}
      ${
        ev.metadata
          ? `<dt>Metadata</dt><dd><pre class="kerf-f37__mono">${escapeHtml(formatAuditObject(ev.metadata))}</pre></dd>`
          : ''
      }
      <dt>Audit note</dt><dd>${escapeHtml(ev.auditNote)}</dd>
    </dl>
  </section>`;
}

function renderTranscriptLines(
  segments: TranscriptModel['transcript_original'] | TranscriptModel['transcript_current'],
): string {
  return segments
    .map((segment) => {
      const speaker = segment.speaker ? `${segment.speaker}: ` : '';
      return `[${Math.round(segment.start_ms / 1000)}s] ${speaker}${segment.text}`;
    })
    .join('\n');
}

function renderTranscriptEdits(transcript: TranscriptModel): string {
  if (transcript.transcript_edits.length === 0) {
    return 'No overlay edits recorded.';
  }
  return transcript.transcript_edits
    .map((edit) => `${edit.actor} (${edit.created_at}): ${edit.original_text} -> ${edit.edited_text}`)
    .join('\n');
}

function renderTranscriptSection(transcript?: TranscriptModel): string {
  const original = transcript ? renderTranscriptLines(transcript.transcript_original) : TRANSCRIPT_ORIGINAL;
  const edits = transcript ? renderTranscriptEdits(transcript) : TRANSCRIPT_EDIT_SNIPPET;
  const current = transcript ? renderTranscriptLines(transcript.transcript_current) : transcriptCurrentDisplay();
  return `
  <details class="kerf-f37__section kerf-f37__support">
    <summary id="f37-transcript-h" class="kerf-f37__support-summary">Transcript preservation</summary>
    <p><strong>Original (immutable)</strong> — stored once; never edited in place.</p>
    <pre class="kerf-f37__mono" aria-label="Original transcript">${escapeHtml(original)}</pre>
    <p><strong>Edits (overlay events)</strong> — each edit is an append-only correction record.</p>
    <pre class="kerf-f37__mono" aria-label="Transcript overlay">${escapeHtml(edits)}</pre>
    <p><strong>Current view</strong> — rendered for operators as original + ordered overlays (demo text below).</p>
    <pre class="kerf-f37__mono" aria-label="Rendered current transcript">${escapeHtml(current)}</pre>
  </details>`;
}

function renderValidators(packet: DecisionPacket): string {
  const rows = packet.policy_gate_result.validator_results
    .map((v) => {
      const pill = validatorStatusPill(v);
      const correction = v.field_corrected
        ? `<div class="kerf-f37__mono">${escapeHtml(v.field_corrected.field)}: ${escapeHtml(
            String(v.field_corrected.from),
          )} → ${escapeHtml(String(v.field_corrected.to))}</div>`
        : '—';
      const explanation = v.reason ? escapeHtml(v.reason) : '—';
      return `<tr>
        <td><span class="kerf-f37__mono">${escapeHtml(v.validator_id)}</span><div>${escapeHtml(v.validator_name)}</div></td>
        <td><span class="${pill.className}">${pill.label}</span></td>
        <td>${explanation}</td>
        <td>${correction}</td>
      </tr>`;
    })
    .join('');
  const safeNext = escapeHtml(packet.policy_gate_result.safe_next_action);
  return `
  <details class="kerf-f37__section kerf-f37__support">
    <summary id="f37-val-h" class="kerf-f37__support-summary">Validator results</summary>
    <p>Authoritative gate output on the DecisionPacket (read-only).</p>
    <p><strong>Safe next action:</strong> <span class="kerf-f37__mono">${safeNext}</span></p>
    <table class="kerf-f37__table">
      <thead><tr><th>Validator</th><th>Status</th><th>Explanation</th><th>Corrected fields</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function generatedValidatorStatusPill(v: VerticalSliceValidatorResult): { label: string; className: string } {
  if (v.status === 'pass') {
    return { label: 'pass', className: 'kerf-f37__pill kerf-f37__pill--pass' };
  }
  if (v.status === 'block') {
    return { label: 'block', className: 'kerf-f37__pill kerf-f37__pill--block' };
  }
  return { label: 'warn', className: 'kerf-f37__pill kerf-f37__pill--warn' };
}

function renderGeneratedValidators(fixture: VerticalSliceDryRunDemoFixture): string {
  const rows = fixture.validator_results
    .map((v) => {
      const pill = generatedValidatorStatusPill(v);
      const correction = v.corrected_fields
        ? `<pre class="kerf-f37__mono">${escapeHtml(JSON.stringify(v.corrected_fields, null, 2))}</pre>`
        : '—';
      return `<tr>
        <td><span class="kerf-f37__mono">${escapeHtml(v.validator_id)}</span><div>${escapeHtml(v.validator_name)}</div></td>
        <td><span class="${pill.className}">${pill.label}</span></td>
        <td>${escapeHtml(v.explanation)}</td>
        <td>${correction}</td>
      </tr>`;
    })
    .join('');
  return `
  <details class="kerf-f37__section kerf-f37__support">
    <summary id="f37-val-h" class="kerf-f37__support-summary">Validator results</summary>
    <p>Authoritative gate output from the field-capture dry run (read-only).</p>
    <p><strong>Safe next action:</strong> <span class="kerf-f37__mono">${escapeHtml(fixture.decision_packet.safe_next_action)}</span></p>
    <table class="kerf-f37__table">
      <thead><tr><th>Validator</th><th>Status</th><th>Explanation</th><th>Corrected fields</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function renderBlackboardPreview(packet: DecisionPacket): string {
  const rail = packet.system_final_blackboard_rail ?? 'holding';
  const artifact =
    packet.workflow === 'invoice_followup'
      ? String(packet.extracted_facts.invoice_number ?? packet.extracted_facts.invoice_id ?? 'invoice')
      : String(packet.extracted_facts.proposal_number ?? packet.extracted_facts.proposal_id ?? 'proposal');
  const movement =
    packet.workflow === 'invoice_followup'
      ? 'Invoice follow-up draft queued for owner review.'
      : 'Proposal follow-up draft queued for owner review.';
  return `
  <details class="kerf-f37__section kerf-f37__support">
    <summary id="f37-bb-h" class="kerf-f37__support-summary">Blackboard write preview</summary>
    <p>What <strong>would</strong> post after an explicit operator commit (no write in this demo).</p>
    <dl class="kerf-f37__rail-grid">
      <dt>Rail · Movement</dt><dd>${escapeHtml(movement)}</dd>
      <dt>Rail · Who's Where</dt><dd>PM on-site; client pending response on ${escapeHtml(artifact)}.</dd>
      <dt>Rail · Pinned</dt><dd>Structural note: load-bearing pantry wall — cased opening option.</dd>
      <dt>Rail · Changed</dt><dd>Scope line count +1 vs prior Blackboard snapshot.</dd>
      <dt>Rail · Holding</dt><dd>External send blocked pending approval (matches <span class="kerf-f37__mono">${escapeHtml(rail)}</span> rail).</dd>
      <dt>Summary</dt><dd>${escapeHtml(packet.proposed_action.description)}</dd>
      <dt>Visibility</dt><dd>Owner + PM (demo labels; production maps to role_visibility on packet).</dd>
      <dt>Source refs</dt><dd>${renderSourceRefs(packet.source_refs)}</dd>
      <dt>Retention / audit</dt><dd>until_close+7y · append-only audit chain (see timeline).</dd>
    </dl>
  </details>`;
}

function renderGeneratedBlackboardPreview(preview: BlackboardWritePreview): string {
  return `
  <details class="kerf-f37__section kerf-f37__support">
    <summary id="f37-bb-h" class="kerf-f37__support-summary">Blackboard write preview</summary>
    <p>What <strong>would</strong> post after an explicit operator commit (no write in this demo).</p>
    <dl class="kerf-f37__rail-grid">
      <dt>Rail</dt><dd>${escapeHtml(preview.rail)}</dd>
      <dt>Mode</dt><dd>${escapeHtml(preview.mode ?? 'preview_only')}</dd>
      <dt>Persistence performed</dt><dd>${preview.persistence_performed === false ? 'false' : 'preview only'}</dd>
      <dt>Summary</dt><dd>${escapeHtml(preview.summary)}</dd>
      <dt>Proposed markdown</dt><dd><pre class="kerf-f37__mono">${escapeHtml(preview.proposed_markdown)}</pre></dd>
      <dt>Affected entities</dt><dd><pre class="kerf-f37__mono">${escapeHtml(preview.affected_entity_ids.join('\n'))}</pre></dd>
      <dt>Source refs</dt><dd>${renderSourceRefs(preview.source_refs.map(sourceRefFromVertical))}</dd>
      <dt>Retention / audit</dt><dd>until_close+7y · append-only audit chain (see timeline).</dd>
    </dl>
  </details>`;
}

export type F37AuditVariant = 'standalone' | 'embedded';

export function buildF37UnknownPacketHtml(packetId: string): string {
  return `<div class="kerf-f37 kerf-f37__error">
      <p>Unknown packet <span class="kerf-f37__mono">${escapeHtml(packetId)}</span>.</p>
      <p class="kerf-f37__hint">Try <span class="kerf-f37__mono">/audit/${escapeHtml(F37_DEFAULT_PACKET_ID)}</span> or the invoice fixture id <span class="kerf-f37__mono">${escapeHtml(
        invoiceDecisionPacketFixture.packet_id,
      )}</span>.</p>
    </div>`;
}

export function buildF37AuditPageHtml(
  packet: DecisionPacket,
  selectedId: string,
  variant: F37AuditVariant,
  fixtureOverride?: VerticalSliceDryRunDemoFixture,
): string {
  const generatedFixture = generatedFixtureForPacket(packet, fixtureOverride);
  const events = buildF37Timeline(packet, fixtureOverride);
  const selected = events.find((e) => e.id === selectedId) ?? events[0];
  if (selected === undefined) {
    return buildF37UnknownPacketHtml(packet.packet_id);
  }
  const top =
    variant === 'standalone'
      ? `<div class="kerf-f37__topbar">
    <div class="kerf-f37__brand">KERF</div>
    <div class="kerf-f37__meta">F-37 · Audit log / event stream · local demo</div>
  </div>`
      : `<p class="kerf-f37-embed-lede kerf-v15-prose" role="note"><strong>Audit stream demo.</strong> Read-only timeline for this DecisionPacket (no writes; no separate server).</p>`;

  return `<div class="kerf-f37${variant === 'embedded' ? ' kerf-f37--embedded' : ''}">
  ${top}
  ${renderHeader(packet)}
  <div class="kerf-f37__layout">
    ${renderTimeline(events, selected.id)}
    ${renderDetail(selected)}
  </div>
  ${renderTranscriptSection(generatedFixture?.field_capture_payload.transcript)}
  ${generatedFixture !== null ? renderGeneratedValidators(generatedFixture) : renderValidators(packet)}
  ${generatedFixture !== null ? renderGeneratedBlackboardPreview(generatedFixture.blackboard_write_preview) : renderBlackboardPreview(packet)}
  <footer class="kerf-f37__notice" role="note">
    AI-assisted output is logged with source refs, validator results, and human review state.
  </footer>
</div>`;
}
