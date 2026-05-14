import {
  buildF37AuditPageHtml,
  buildF37Timeline,
  buildF37UnknownPacketHtml,
  resolveF37Packet,
} from '../audit-f37/f37-audit-view-html.js';
import {
  F35_AI_NOTICE,
  f35DraftReviewDemoFixture,
  f35FixtureFromVerticalSliceDryRun,
  renderF35DraftReviewPage,
  type F35DraftReviewFixture,
} from '../f35-draft-review.js';
import { FIELD_CAPTURE_COPY } from '../field-capture-mock.js';
import { buildTranscriptReviewMainHtml, buildTranscriptReviewRailHtml } from './f34-transcript-review-html.js';
import { F34_REQUIRED_NOTICE } from './f34-transcript-review-mock.js';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../../demo/verticalSliceFlowIds.js';
import { buildF36DecisionCardHtml } from './f36-decision-card-html.js';
import { f36ModelFromVerticalSliceFixture } from './f36-decision-mock.js';
import { DEMO_DECISION_ID, DEMO_PACKET_ID } from './mock.js';
import type { MatchedRoute } from './router.js';
import { v15GetActiveVerticalSliceFixture } from './v15-context-dry-run-session.js';
import { buildV15FieldCaptureHtml } from './v15-field-capture-html.js';
import { v15FieldCaptureGetState } from './v15-field-capture-state.js';
import { v15F37GetSelectedEventId } from './v15-f37-selection.js';
import { detectBathArchetype } from './v15-bath-archetype.js';
import { instantiateBathScaffold } from './v15-bath-scaffold.js';
import { renderBathScaffoldSection } from './v15-bath-scaffold-html.js';
import { detectKitchenArchetype } from './v15-kitchen-archetype.js';
import { instantiateKitchenScaffold } from './v15-kitchen-scaffold.js';
import { renderKitchenScaffoldSection } from './v15-kitchen-scaffold-html.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * PR #156 helper: read the transcript text from the active vertical-slice
 * fixture (live recording when present; demo fixture otherwise), run the
 * deterministic kitchen-archetype detector against it, and render the
 * scaffold section if a kitchen is detected.
 *
 * Returns an empty string when:
 *   - no active fixture (fallback to demo fixture path threw)
 *   - transcript text is empty
 *   - archetype detector returns null (no kitchen mention)
 *
 * The empty-string contract lets the caller include this unconditionally
 * in the page body composition without branching.
 */
function renderKitchenScaffoldFromActiveFixture(
  activeFixture: ReturnType<typeof v15GetActiveVerticalSliceFixture> | null,
): string {
  if (activeFixture === null) return '';
  const transcriptText = activeFixture.field_capture_input?.transcript_original ?? '';
  if (transcriptText.length === 0) return '';
  const detection = detectKitchenArchetype(transcriptText);
  if (detection === null) return '';
  const scaffold = instantiateKitchenScaffold(detection);
  return renderKitchenScaffoldSection(scaffold);
}

function renderBathScaffoldFromActiveFixture(
  activeFixture: ReturnType<typeof v15GetActiveVerticalSliceFixture> | null,
): string {
  if (activeFixture === null) return '';
  const transcriptText = activeFixture.field_capture_input?.transcript_original ?? '';
  if (transcriptText.length === 0) return '';
  const detection = detectBathArchetype(transcriptText);
  if (detection === null) return '';
  const scaffold = instantiateBathScaffold(detection);
  return renderBathScaffoldSection(scaffold);
}

function buildBlackboardPreviewHtml(): string {
  const fixture = v15GetActiveVerticalSliceFixture();
  const preview = fixture.blackboard_write_preview;
  const decision = fixture.decision_packet;
  const sources = preview.source_refs
    .map((ref) => `<li><strong>${esc(ref.label)}</strong>${ref.excerpt !== undefined ? ` — ${esc(ref.excerpt)}` : ''}</li>`)
    .join('');
  const affected = preview.affected_entity_ids
    .map((id) => `<li><code>${esc(id)}</code></li>`)
    .join('');
  const scopeRows = fixture.field_capture_payload.scope_lines
    .slice(0, 6)
    .map((line) => {
      const missing = line.missing_info !== undefined && line.missing_info.length > 0
        ? ` <span class="kerf-v15-card__meta">Needs: ${esc(line.missing_info.join(', '))}</span>`
        : '';
      return `<li><strong>${esc(line.description)}</strong> <span class="kerf-v15-card__meta">${esc(line.category)}</span>${missing}</li>`;
    })
    .join('');

  return `<section class="kerf-v15-card" aria-labelledby="kerf-v15-blackboard-preview-h">
  <div class="kerf-v15-card__head">
    <p class="kerf-v15-card__meta">Preview only · no Blackboard write happened</p>
    <h2 id="kerf-v15-blackboard-preview-h" class="kerf-v15-card__title">Current dry-run memory preview</h2>
  </div>
  <p class="kerf-v15-prose">This shows what the active field-capture dry run would hand to Blackboard after human review. It follows the context you typed in Field Capture; it does not persist anything.</p>
  <dl class="kerf-fc-preview-dl">
    <div><dt>Project</dt><dd>${esc(decision.project_name)}</dd></div>
    <div><dt>Client</dt><dd>${esc(decision.client_name)}</dd></div>
    <div><dt>Rail</dt><dd><code>${esc(preview.rail)}</code></dd></div>
    <div><dt>Summary</dt><dd>${esc(preview.summary)}</dd></div>
    <div><dt>Persistence</dt><dd>${preview.persistence_performed === false ? 'Not performed' : 'Unknown'}</dd></div>
  </dl>
</section>

<section class="kerf-v15-card" aria-labelledby="kerf-v15-blackboard-note-h">
  <div class="kerf-v15-card__head">
    <h2 id="kerf-v15-blackboard-note-h" class="kerf-v15-card__title">Blackboard write preview</h2>
    <p class="kerf-v15-card__meta">Generated from the same DecisionPacket as Decision and Audit</p>
  </div>
  <pre class="kerf-v15-pre" role="document">${esc(preview.proposed_markdown)}</pre>
</section>

<section class="kerf-v15-card" aria-labelledby="kerf-v15-blackboard-scope-h">
  <div class="kerf-v15-card__head">
    <h2 id="kerf-v15-blackboard-scope-h" class="kerf-v15-card__title">Scope memory candidates</h2>
    <p class="kerf-v15-card__meta">Extracted from transcript_current for review</p>
  </div>
  <ul class="kerf-v15-kicker">${scopeRows}</ul>
</section>

<section class="kerf-v15-card" aria-labelledby="kerf-v15-blackboard-sources-h">
  <div class="kerf-v15-card__head">
    <h2 id="kerf-v15-blackboard-sources-h" class="kerf-v15-card__title">Source refs and affected ids</h2>
  </div>
  <p class="kerf-v15-prose"><strong>Sources</strong></p>
  <ul class="kerf-v15-kicker">${sources}</ul>
  <p class="kerf-v15-prose"><strong>Affected ids</strong></p>
  <ul class="kerf-v15-kicker">${affected}</ul>
</section>`;
}

export interface PageFrameContent {
  title: string;
  subtitle: string;
  notice: string;
  bodyHtml: string;
  railHtml?: string;
}

export function buildPage(route: MatchedRoute): PageFrameContent {
  switch (route.name) {
    case 'dashboard':
      return {
        title: 'Dashboard',
        subtitle: 'Operator home for the V1.5 vertical slice.',
        notice: 'AI-assisted. Review before approval.',
        bodyHtml: `<p class="kerf-v15-prose">Use the navigation to walk the slice: field capture through audit. Nothing here writes to Platform, QBO, or external systems.</p>
<ul class="kerf-v15-kicker">
<li><a href="/field-capture" data-kerf-v15-nav="true">Start at Field Capture</a></li>
<li><a href="/transcript-review" data-kerf-v15-nav="true">Open F-34 Transcript Review</a></li>
<li><a href="/draft-review" data-kerf-v15-nav="true">Open F-35 Draft Review</a></li>
<li><a href="/decisions/${esc(DEMO_DECISION_ID)}" data-kerf-v15-nav="true">Jump to approval card</a></li>
<li><a href="/audit/${esc(DEMO_PACKET_ID)}" data-kerf-v15-nav="true">Open audit stream</a></li>
</ul>`,
      };
    case 'field-capture':
      return {
        title: 'Field Capture',
        subtitle: 'F·33 · Contractor field signal (text, photos, voice placeholder).',
        notice: FIELD_CAPTURE_COPY.gateNotice,
        bodyHtml: buildV15FieldCaptureHtml(v15FieldCaptureGetState()),
      };
    case 'transcript-review':
      return {
        title: 'Transcript Review',
        subtitle: 'F-34 · Post-capture review before draft generation.',
        notice: F34_REQUIRED_NOTICE,
        bodyHtml: buildTranscriptReviewMainHtml(),
        railHtml: buildTranscriptReviewRailHtml(),
      };
    case 'draft-review': {
      // Prefer the generated dry-run fixture (Codex convergence) so /draft-review
      // exercises the same spine packet id, integer amount_cents, and source
      // refs that F-36 / F-37 consume. If the adapter throws at construction
      // time (e.g. mid-migration shape mismatch), fall back to the hand-authored
      // demo fixture so the screen still renders the rich F-35 surface.
      let fixture: F35DraftReviewFixture;
      let activeFixture: ReturnType<typeof v15GetActiveVerticalSliceFixture> | null;
      try {
        activeFixture = v15GetActiveVerticalSliceFixture();
        fixture = f35FixtureFromVerticalSliceDryRun(activeFixture);
      } catch {
        activeFixture = null;
        fixture = f35DraftReviewDemoFixture;
      }
      // PR #156: kitchen archetype scope scaffold. If the active transcript
      // describes a kitchen, render a "Working draft detected" scaffold at
      // the top of /draft-review. The transcript-derived F-35 scope lines
      // still render below for raw-capture audit; the scaffold is the new
      // primary content. Strictly deterministic — regex archetype detect,
      // hardcoded scope template, KB tier-1 lookup per line, never a quote.
      let scaffoldHtml = renderKitchenScaffoldFromActiveFixture(activeFixture);
      if (scaffoldHtml === '') {
        scaffoldHtml = renderBathScaffoldFromActiveFixture(activeFixture);
      }
      return {
        title: 'Draft Review',
        subtitle: 'F-35 · Draft before decisions (read-only demo).',
        notice: F35_AI_NOTICE,
        bodyHtml: `${scaffoldHtml}<div class="kerf-v15-f35-embed">${renderF35DraftReviewPage(fixture, { v15Shell: true })}</div>`,
      };
    }
    case 'decisions-list':
      return {
        title: 'Decisions',
        subtitle: 'Queue of items awaiting operator judgment.',
        notice: 'AI-assisted. Review before approval.',
        bodyHtml: `<p class="kerf-v15-prose">Open a decision card to continue the slice.</p>
<p><a class="kerf-v15-btn" href="/decisions/${esc(DEMO_DECISION_ID)}" data-kerf-v15-nav="true">Open demo decision</a></p>`,
      };
    case 'decision-detail': {
      const spineId = VERTICAL_SLICE_FLOW_PACKET_ID;
      if (route.id !== spineId) {
        return {
          title: 'Decision route',
          subtitle: 'This demo only mounts F-36 on the vertical-slice spine packet id.',
          notice: 'AI-assisted. Review before approval.',
          bodyHtml: `<p class="kerf-v15-prose">The URL <code>${esc(route.id)}</code> is not the spine flow packet for this shell. Use the canonical id so audit and decisions stay aligned.</p>
<p class="kerf-v15-prose">Spine packet: <code>${esc(spineId)}</code></p>
<p><a class="kerf-v15-btn kerf-v15-btn--primary" href="/decisions/${esc(spineId)}" data-kerf-v15-nav="true">Open approval card (spine)</a></p>`,
        };
      }
      const f36 = f36ModelFromVerticalSliceFixture(v15GetActiveVerticalSliceFixture());
      return {
        title: f36.decisionTitle,
        subtitle: `Approval card · ${esc(f36.packet.client_name)} · spine route <code>${esc(spineId)}</code>`,
        notice: 'Approval required before any external send. AI-assisted. Review before approval.',
        bodyHtml: buildF36DecisionCardHtml(f36, route.id),
        railHtml: `<aside class="kerf-v15-rail" aria-label="Review context">
  <h4 class="kerf-v15-rail__title">Review checklist</h4>
  <ul class="kerf-v15-rail__list">
    <li>Confirm <code>system_final_altitude</code> matches what you expect for this workflow.</li>
    <li>Resolve any <strong>Block</strong> validators before approving an external send.</li>
    <li>Compare model audit fields to system final fields if routing looks surprising.</li>
  </ul>
</aside>`,
      };
    }
    case 'audit-detail': {
      const activeFixture = v15GetActiveVerticalSliceFixture();
      const packet = route.packetId === activeFixture.decision_packet_raw.packet_id
        ? activeFixture.decision_packet_raw
        : resolveF37Packet(route.packetId);
      if (packet === null) {
        return {
          title: `Audit · ${esc(route.packetId)}`,
          subtitle: 'Unknown packet for this demo.',
          notice: 'Read-only — no writes.',
          bodyHtml: `<div class="kerf-v15-f37-embed">${buildF37UnknownPacketHtml(route.packetId)}</div>`,
        };
      }
      const fixtureForPacket = route.packetId === activeFixture.decision_packet_raw.packet_id ? activeFixture : undefined;
      const events = buildF37Timeline(packet, fixtureForPacket);
      const sel = v15F37GetSelectedEventId(route.packetId, events[0]?.id ?? '');
      return {
        title: `Audit · ${esc(route.packetId)}`,
        subtitle: 'F-37 · Event stream (fixture-backed, read-only).',
        notice: 'Read-only demo — timeline render only; no Policy Gate execution or validator runs.',
        bodyHtml: `<div class="kerf-v15-f37-embed">${buildF37AuditPageHtml(packet, sel, 'embedded', fixtureForPacket)}</div>`,
      };
    }
    case 'blackboard':
      return {
        title: 'Blackboard',
        subtitle: 'System memory surface (read-only preview).',
        notice: 'Preview only — no graph queries or writes.',
        bodyHtml: buildBlackboardPreviewHtml(),
      };
  }
}
