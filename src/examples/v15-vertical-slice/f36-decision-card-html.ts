import type { ValidatorResult } from '../../altitude/types.js';
import { formatDisplayDollarsFromCents } from '../f35-draft-review.js';
import type { F36DecisionCardModel } from './f36-decision-mock.js';
import { f36ExternalSendAllowed } from './f36-decision-mock.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validatorTone(v: ValidatorResult): 'pass' | 'warn' | 'block' {
  if (v.passed) {
    return 'pass';
  }
  return v.critical ? 'block' : 'warn';
}

function safeActionCopy(v: ValidatorResult, gateSafeNext: string): string {
  if (validatorTone(v) !== 'block') {
    return '';
  }
  if (v.validator_id === 'V2') {
    return 'Hold the outbound message until an owner records approval on this decision.';
  }
  return `Follow gate safe next action: ${gateSafeNext.replace(/_/g, ' ')}.`;
}

export function buildF36DecisionCardHtml(model: F36DecisionCardModel, routeDecisionId: string): string {
  const { packet, decisionTitle, surfaceWorkflow, surfaceStatus, riskFlags } = model;
  const gate = packet.policy_gate_result;
  const client = packet.extracted_facts.client_name ?? 'Client';
  const project = packet.project_id ?? packet.extracted_facts.project_id ?? '—';
  const extAllowed = f36ExternalSendAllowed(packet);

  const blockedList =
    gate.blocked_reasons.length > 0
      ? `<ul class="kerf-v15-f36-list">${gate.blocked_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : `<p class="kerf-v15-f36-muted">No blocked reasons recorded.</p>`;

  const refs =
    packet.source_refs.length > 0
      ? `<ul class="kerf-v15-f36-refs">${packet.source_refs
          .map((ref) => {
            const uri = ref.uri !== undefined ? `<span class="kerf-v15-f36-ref__uri">${esc(ref.uri)}</span>` : '';
            const ex = ref.excerpt !== undefined ? esc(ref.excerpt) : '';
            return `<li><span class="kerf-v15-f36-ref__kind">${esc(ref.kind)}</span>${uri ? ` · ${uri}` : ''}${ex ? `<div class="kerf-v15-f36-ref__ex">${ex}</div>` : ''}</li>`;
          })
          .join('')}</ul>`
      : `<p class="kerf-v15-f36-muted">No source refs on this packet.</p>`;

  const risks =
    riskFlags.length > 0
      ? `<ul class="kerf-v15-f36-list">${riskFlags.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : `<p class="kerf-v15-f36-muted">No additional risk flags.</p>`;

  const mf = packet.money_fields;
  const cents = mf?.amount_cents;
  const centsLabel = cents !== undefined && Number.isFinite(cents) ? String(cents) : '';
  const centsValue = centsLabel === '' ? '—' : centsLabel;
  const displayUsd =
    cents !== undefined && Number.isFinite(cents) ? formatDisplayDollarsFromCents(cents) : '—';
  const srcClassRaw = mf?.source_class !== undefined ? String(mf.source_class) : '';
  const srcStatusRaw = mf?.source_status !== undefined ? String(mf.source_status) : '';
  const srcClassValue = srcClassRaw === '' ? '—' : esc(srcClassRaw);
  const srcStatusValue = srcStatusRaw === '' ? '—' : esc(srcStatusRaw);
  const idSafe = routeDecisionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const idBase = `kerf-f36-${idSafe}`;
  const altitudePacketId = packet.packet_id;
  const auditHref = `/audit/${encodeURIComponent(altitudePacketId)}`;

  const validators = gate.validator_results
    .map((v) => {
      const tone = validatorTone(v);
      const safe = safeActionCopy(v, gate.safe_next_action);
      return `<li class="kerf-v15-f36-val kerf-v15-f36-val--${tone}">
  <div class="kerf-v15-f36-val__head">
    <span class="kerf-v15-f36-val__badge" aria-label="${tone}">${tone === 'pass' ? 'Pass' : tone === 'warn' ? 'Warn' : 'Block'}</span>
    <span class="kerf-v15-f36-val__name">${esc(v.validator_name)}</span>
    <span class="kerf-v15-f36-val__id">${esc(v.validator_id)}</span>
  </div>
  ${v.reason !== undefined ? `<p class="kerf-v15-f36-val__reason">${esc(v.reason)}</p>` : ''}
  ${safe !== '' ? `<p class="kerf-v15-f36-val__safe"><strong>Safe action:</strong> ${esc(safe)}</p>` : ''}
</li>`;
    })
    .join('');

  const auditRail = packet.model_suggested_blackboard_rail ?? '—';
  const auditInference = packet.model_inference_label ?? '—';

  return `<article class="kerf-v15-f36" aria-label="Approval-required decision card">
  <header class="kerf-v15-f36-header">
    <h2 class="kerf-v15-f36-title">${esc(decisionTitle)}</h2>
    <p class="kerf-v15-f36-meta">
      <span class="kerf-v15-f36-pill">${esc(client)}</span>
      <span class="kerf-v15-f36-pill kerf-v15-f36-pill--muted">Project <code>${esc(String(project))}</code></span>
      <span class="kerf-v15-f36-pill">Route id <code>${esc(routeDecisionId)}</code></span>
      <span class="kerf-v15-f36-pill kerf-v15-f36-pill--muted">Altitude packet <code>${esc(altitudePacketId)}</code></span>
    </p>
    <dl class="kerf-v15-f36-dl">
      <div><dt>Workflow (surface)</dt><dd><code>${esc(surfaceWorkflow)}</code> · packet workflow <code>${esc(packet.workflow)}</code></dd></div>
      <div><dt>Status (surface)</dt><dd><code>${esc(surfaceStatus)}</code> · packet status <code>${esc(packet.status)}</code></dd></div>
    </dl>
  </header>

  <div class="kerf-v15-f36-notice" role="note">
    <p><strong>Approval required before any external send.</strong></p>
    <p>AI-assisted. Review before approval.</p>
  </div>

  <section class="kerf-v15-f36-section kerf-v15-f36-section--authority" aria-labelledby="kerf-v15-f36-routing-title">
    <h3 id="kerf-v15-f36-routing-title" class="kerf-v15-f36-h">Authoritative routing</h3>
    <p class="kerf-v15-f36-lead">System final fields and policy gate output drive what Kerf does next. Model suggestions are shown only in the audit panel below.</p>
    <dl class="kerf-v15-f36-grid">
      <div class="kerf-v15-f36-highlight">
        <dt>system_final_altitude</dt>
        <dd><span class="kerf-v15-f36-alt">${esc(packet.system_final_altitude)}</span></dd>
      </div>
      <div><dt>safe_next_action</dt><dd><code>${esc(gate.safe_next_action)}</code></dd></div>
      <div><dt>required_human_approval</dt><dd>${gate.required_human_approval ? 'Yes' : 'No'}</dd></div>
      <div><dt>external_send_allowed</dt><dd>${extAllowed ? 'Yes (demo gate output)' : 'No'}</dd></div>
    </dl>
    <div class="kerf-v15-f36-blocked">
      <h4 class="kerf-v15-f36-subh">blocked_reasons</h4>
      ${blockedList}
    </div>
    <div class="kerf-v15-f36-money" aria-labelledby="kerf-v15-f36-money-h">
      <h4 id="kerf-v15-f36-money-h" class="kerf-v15-f36-subh">Pricing surface (read-only)</h4>
      <p class="kerf-v15-f36-muted">Values from <code>packet.money_fields</code>. Integer cents in storage; USD is display-only.</p>
      <div class="kerf-v15-f36-readonly-grid">
        <div class="kerf-v15-f36-readonly-fieldwrap">
          <label class="kerf-v15-f36-readonly-label" for="${idBase}-amount_cents">amount_cents</label>
          <input id="${idBase}-amount_cents" class="kerf-v15-f36-readonly-input" type="text" readonly tabindex="-1" value="${esc(centsValue)}" aria-readonly="true" />
        </div>
        <div class="kerf-v15-f36-readonly-fieldwrap">
          <label class="kerf-v15-f36-readonly-label" for="${idBase}-source_class">source_class</label>
          <input id="${idBase}-source_class" class="kerf-v15-f36-readonly-input" type="text" readonly tabindex="-1" value="${srcClassValue}" aria-readonly="true" />
        </div>
        <div class="kerf-v15-f36-readonly-fieldwrap">
          <label class="kerf-v15-f36-readonly-label" for="${idBase}-source_status">source_status</label>
          <input id="${idBase}-source_status" class="kerf-v15-f36-readonly-input" type="text" readonly tabindex="-1" value="${srcStatusValue}" aria-readonly="true" />
        </div>
        <div class="kerf-v15-f36-readonly-fieldwrap kerf-v15-f36-readonly-fieldwrap--span">
          <span class="kerf-v15-f36-readonly-label">Display (USD, approx.)</span>
          <p class="kerf-v15-f36-readonly-display">${esc(displayUsd)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="kerf-v15-f36-section" aria-labelledby="kerf-v15-f36-proposed-title">
    <h3 id="kerf-v15-f36-proposed-title" class="kerf-v15-f36-h">Proposed action</h3>
    <p class="kerf-v15-f36-prose"><strong>${esc(packet.proposed_action.description)}</strong></p>
    <h4 class="kerf-v15-f36-subh">Why Kerf recommends it</h4>
    <p class="kerf-v15-f36-prose">${esc(packet.proposed_action.reason)}</p>
    <h4 class="kerf-v15-f36-subh">Source refs</h4>
    ${refs}
    <h4 class="kerf-v15-f36-subh">Risk flags</h4>
    ${risks}
  </section>

  <section class="kerf-v15-f36-section" aria-labelledby="kerf-v15-f36-val-title">
    <h3 id="kerf-v15-f36-val-title" class="kerf-v15-f36-h">Validator summary</h3>
    <p class="kerf-v15-f36-muted">Mock results carried on <code>policy_gate_result.validator_results</code> — this UI does not run validators.</p>
    <ol class="kerf-v15-f36-val-list">${validators}</ol>
  </section>

  <details class="kerf-v15-f36-audit">
    <summary class="kerf-v15-f36-audit__summary">Model suggestion (audit / debug)</summary>
    <p class="kerf-v15-f36-audit__banner"><strong>Audit only.</strong> Routing uses <code>system_final_*</code> fields.</p>
    <dl class="kerf-v15-f36-grid kerf-v15-f36-grid--audit">
      <div><dt>model_suggested_altitude</dt><dd><code>${esc(packet.model_suggested_altitude)}</code></dd></div>
      <div><dt>model_suggested_blackboard_rail</dt><dd><code>${esc(auditRail)}</code></dd></div>
      <div><dt>model_inference_label</dt><dd><code>${esc(auditInference)}</code> <span class="kerf-v15-f36-muted">(model packet inference label)</span></dd></div>
    </dl>
  </details>

  <section class="kerf-v15-f36-section" aria-label="Approval controls (demo)">
    <h3 class="kerf-v15-f36-h">Approval controls</h3>
    <p class="kerf-v15-f36-muted">Buttons are disabled in this shell — no writes, no external sends.</p>
    <div class="kerf-v15-f36-actions" role="group" aria-label="Approval actions (demo)">
      <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" disabled title="Demo only">Approve Draft</button>
      <button type="button" class="kerf-v15-btn" disabled title="Demo only">Reject</button>
      <button type="button" class="kerf-v15-btn" disabled title="Demo only">Request More Info</button>
      <a class="kerf-v15-btn" href="${auditHref}" data-kerf-v15-nav="true" title="Opens read-only audit stream for packet ${esc(altitudePacketId)}">Open Audit</a>
    </div>
  </section>
</article>`;
}
