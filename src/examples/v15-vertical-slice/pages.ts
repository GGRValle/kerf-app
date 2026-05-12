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
import { verticalSliceFieldCaptureDemoFixture } from '../../demo/index.js';
import { FIELD_CAPTURE_COPY } from '../field-capture-mock.js';
import { buildTranscriptReviewMainHtml, buildTranscriptReviewRailHtml } from './f34-transcript-review-html.js';
import { F34_REQUIRED_NOTICE } from './f34-transcript-review-mock.js';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../../demo/verticalSliceFlowIds.js';
import { buildF36DecisionCardHtml } from './f36-decision-card-html.js';
import { f36ModelForRouteId } from './f36-decision-mock.js';
import { DEMO_DECISION_ID, DEMO_PACKET_ID } from './mock.js';
import type { MatchedRoute } from './router.js';
import { buildV15FieldCaptureHtml } from './v15-field-capture-html.js';
import { v15FieldCaptureGetState } from './v15-field-capture-state.js';
import { v15F37GetSelectedEventId } from './v15-f37-selection.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      try {
        fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
      } catch {
        fixture = f35DraftReviewDemoFixture;
      }
      return {
        title: 'Draft Review',
        subtitle: 'F-35 · Draft before decisions (read-only demo).',
        notice: F35_AI_NOTICE,
        bodyHtml: `<div class="kerf-v15-f35-embed">${renderF35DraftReviewPage(fixture, { v15Shell: true })}</div>`,
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
      const f36 = f36ModelForRouteId(route.id);
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
      const packet = resolveF37Packet(route.packetId);
      if (packet === null) {
        return {
          title: `Audit · ${esc(route.packetId)}`,
          subtitle: 'Unknown packet for this demo.',
          notice: 'Read-only — no writes.',
          bodyHtml: `<div class="kerf-v15-f37-embed">${buildF37UnknownPacketHtml(route.packetId)}</div>`,
        };
      }
      const events = buildF37Timeline(packet);
      const sel = v15F37GetSelectedEventId(route.packetId, events[0]?.id ?? '');
      return {
        title: `Audit · ${esc(route.packetId)}`,
        subtitle: 'F-37 · Event stream (fixture-backed, read-only).',
        notice: 'Read-only demo — timeline render only; no Policy Gate execution or validator runs.',
        bodyHtml: `<div class="kerf-v15-f37-embed">${buildF37AuditPageHtml(packet, sel, 'embedded')}</div>`,
      };
    }
    case 'blackboard':
      return {
        title: 'Blackboard',
        subtitle: 'System memory surface (graphical rail in production).',
        notice: 'Demo layout only — no graph queries or writes.',
        bodyHtml: `<p class="kerf-v15-prose">Blackboard placeholder. Use this route to validate nav and layout without touching core Blackboard modules.</p>`,
      };
  }
}
