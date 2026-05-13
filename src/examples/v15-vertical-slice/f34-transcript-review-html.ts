/** F-34 transcript review HTML; source resolution lives in `f34-transcript-review-handoff.ts`. */
// F-34 dry-run banner sources its transcript from
// `verticalSliceFieldCaptureDemoFixture` (specifically its
// `field_capture_payload.transcript`). The handoff form (F-33 sessionStorage)
// takes precedence when present. The convergence-contract fields rendered
// below are `transcript_original`, `transcript_edits`, and `transcript_current`.
// Identifiers stay in this comment block so source-text tests continue to lock
// the binding, while operator-visible copy stays implementation-free.

import { FIELD_CAPTURE_HANDOFF_STORAGE_KEY } from '../field-capture-mock.js';
import type { ScopeLine, TranscriptEditEvent, TranscriptModel, TranscriptSegment, VerticalSliceSourceRef } from '../../demo/types.js';
import {
  F34_AUDIT_HINT,
  F34_CAPTURE_META,
  F34_REQUIRED_NOTICE,
  F34_SCOPE_ROWS,
  F34_TRANSCRIPT_EDITS,
  F34_TRANSCRIPT_SEGMENTS,
  type ScopeTagType,
} from './f34-transcript-review-mock.js';
import { resolveF34TranscriptReviewCopy, type F34ResolvedTranscriptCopy } from './f34-transcript-review-handoff.js';
import { getF34ClarificationAnswers, getF34ResolvedMissingIds } from './f34-transcript-review-state.js';
import { deriveV15ClarificationQuestionsFromScopeLines } from './v15-context-clarifications.js';

type ClarificationCardView = {
  readonly id: string;
  readonly title: string;
  readonly sourceQuote: string;
  readonly placeholder: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tagClass(tag: ScopeTagType): string {
  return `kerf-f34-tag kerf-f34-tag--${tag}`;
}

function confidenceClass(c: 'high' | 'medium' | 'low'): string {
  return `kerf-f34-conf kerf-f34-conf--${c}`;
}

function formatMsRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  return `${fmt(startMs)}–${fmt(endMs)}`;
}

function refSummary(id: string, refs: readonly VerticalSliceSourceRef[]): string {
  const r = refs.find((x) => x.id === id);
  if (r === undefined) {
    return `Source ref ${id}`;
  }
  const parts: string[] = [r.label, r.type];
  if (r.timestamp !== undefined) {
    try {
      parts.push(new Date(r.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }));
    } catch {
      parts.push(r.timestamp);
    }
  }
  return parts.filter((p) => p.length > 0).join(' · ');
}

function confidenceBucket(n: number): 'high' | 'medium' | 'low' {
  if (n >= 0.85) return 'high';
  if (n >= 0.65) return 'medium';
  return 'low';
}

function scopeTagFromLine(line: ScopeLine): ScopeTagType {
  const c = line.category.toLowerCase();
  if (c.includes('finish')) return 'material';
  if (c.includes('carpentr') || c.includes('pantry')) return 'scope';
  if (c.includes('elect')) return 'coordination';
  if (c.includes('lf') || c.includes('dim')) return 'dimension';
  if (c.includes('room')) return 'room';
  return 'scope';
}

function timeLabelForScopeLine(line: ScopeLine, segments: readonly TranscriptSegment[]): string {
  if (line.source_ref_ids.length === 0) {
    return '—';
  }
  const matched = segments.filter((s) => line.source_ref_ids.includes(s.source_ref_id));
  if (matched.length === 0) {
    return '—';
  }
  const start = Math.min(...matched.map((s) => s.start_ms));
  const end = Math.max(...matched.map((s) => s.end_ms));
  return formatMsRange(start, end);
}

function segmentBodyHtml(seg: TranscriptSegment): string {
  const inner = esc(seg.text);
  if (seg.confidence < 0.8) {
    return `<span class="kerf-f34-token kerf-f34-token--lowconf" title="Confidence ${(seg.confidence * 100).toFixed(0)}% — verify">${inner}</span>`;
  }
  return inner;
}

function buildFixtureSegmentsHtml(tm: TranscriptModel, refs: readonly VerticalSliceSourceRef[]): string {
  return tm.transcript_current
    .map((seg) => {
      const title = formatMsRange(seg.start_ms, seg.end_ms);
      const src = refSummary(seg.source_ref_id, refs);
      const speaker = seg.speaker !== undefined && seg.speaker.length > 0 ? `${esc(seg.speaker)} · ` : '';
      return `<article class="kerf-f34-segment" aria-labelledby="${esc(seg.id)}-f34h">
  <header class="kerf-f34-segment__head">
    <h3 id="${esc(seg.id)}-f34h" class="kerf-f34-segment__title">${esc(title)}</h3>
    <p class="kerf-f34-segment__src">${speaker}${esc(src)}</p>
  </header>
  <p class="kerf-f34-segment__body">${segmentBodyHtml(seg)}</p>
</article>`;
    })
    .join('');
}

function buildFixtureEditsHtml(edits: readonly TranscriptEditEvent[]): string {
  if (edits.length === 0) {
    return `<p class="kerf-f34-muted">No operator edit overlays on this capture yet.</p>`;
  }
  const items = edits.map(
    (e) =>
      `<li><span class="kerf-f34-edits__ts">${esc(e.created_at)}</span> · <strong>${esc(e.original_text)}</strong> → <strong>${esc(e.edited_text)}</strong> · ${esc(e.actor)}${e.reason !== undefined ? ` · ${esc(e.reason)}` : ''}</li>`,
  );
  return `<ol class="kerf-f34-edits__list">${items.join('')}</ol>`;
}

function buildFixtureOriginalPre(tm: TranscriptModel): string {
  return tm.transcript_original
    .map(
      (s) =>
        `[${s.id}] ${s.speaker ?? 'Speaker'} · ${formatMsRange(s.start_ms, s.end_ms)}\n${s.text}`,
    )
    .join('\n\n');
}

function buildFixtureScopeRows(lines: readonly ScopeLine[], segments: readonly TranscriptSegment[]): string {
  return lines
    .map((row) => {
      const buck = confidenceBucket(row.confidence);
      const tag = scopeTagFromLine(row);
      const timeLabel = timeLabelForScopeLine(row, segments);
      const name =
        row.description.length > 64 ? `${row.description.slice(0, 61)}…` : row.description;
      return `<tr>
  <td>${esc(name)}</td>
  <td>${esc(row.category)}</td>
  <td><span class="${confidenceClass(buck)}">${esc(buck)}</span></td>
  <td><q>${esc(row.description)}</q></td>
  <td>${esc(timeLabel)}</td>
  <td><span class="${tagClass(tag)}">${esc(tag)}</span></td>
</tr>`;
    })
    .join('');
}

function clarificationCardsForResolvedCopy(r: F34ResolvedTranscriptCopy): readonly ClarificationCardView[] {
  if (r.source !== 'fixture') {
    return [];
  }

  return deriveV15ClarificationQuestionsFromScopeLines(r.scopeLines).map((question) => ({
    id: question.id,
    title: question.prompt,
    sourceQuote: question.source_quote,
    placeholder: question.placeholder,
  }));
}

function buildSegmentsHtml(r: F34ResolvedTranscriptCopy): string {
  if (r.source === 'handoff') {
    return `<article class="kerf-f34-segment" aria-labelledby="kerf-f34-seg-handoff-h">
  <header class="kerf-f34-segment__head">
    <h3 id="kerf-f34-seg-handoff-h" class="kerf-f34-segment__title">Captured text</h3>
    <p class="kerf-f34-segment__src">F-33 field capture handoff · sessionStorage</p>
  </header>
  <p class="kerf-f34-segment__body">${esc(r.transcriptCurrent)}</p>
</article>`;
  }
  if (r.source === 'fixture') {
    return buildFixtureSegmentsHtml(r.transcriptModel, r.sourceRefs);
  }
  return F34_TRANSCRIPT_SEGMENTS.map(
    (seg) => `<article class="kerf-f34-segment" aria-labelledby="${esc(seg.id)}-h">
  <header class="kerf-f34-segment__head">
    <h3 id="${esc(seg.id)}-h" class="kerf-f34-segment__title">${esc(seg.timeLabel)}</h3>
    <p class="kerf-f34-segment__src">${esc(seg.sourceRef)}</p>
  </header>
  <p class="kerf-f34-segment__body">${seg.htmlBody}</p>
</article>`,
  ).join('');
}

function originalPreContent(r: F34ResolvedTranscriptCopy): string {
  if (r.source === 'fixture') {
    return esc(buildFixtureOriginalPre(r.transcriptModel));
  }
  return esc(r.transcriptOriginal);
}

export function buildTranscriptReviewMainHtml(): string {
  const r = resolveF34TranscriptReviewCopy();

  const editsList = F34_TRANSCRIPT_EDITS.map(
    (e) =>
      `<li><span class="kerf-f34-edits__ts">${esc(e.atLabel)}</span> · <strong>${esc(e.originalToken)}</strong> → <strong>${esc(e.currentToken)}</strong> · ${esc(e.source)}</li>`,
  ).join('');

  const segmentsHtml = buildSegmentsHtml(r);

  const legendHtml =
    r.source === 'mock' || r.source === 'fixture'
      ? `<div class="kerf-f34-legend" aria-label="Highlight legend">
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--corrected"></span> Corrected (see overlay list)</span>
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--lowconf"></span> Segment confidence &lt; 80%</span>
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--gap"></span> Missing detail (mock cards)</span>
    </div>`
      : `<p class="kerf-f34-muted">Demo token highlights are disabled for handoff text (plain copy only). Use fixture or built-in mock without handoff to see structured transcript.</p>`;

  const editsBody =
    r.source === 'handoff'
      ? `<p class="kerf-f34-muted">No operator edit overlays are recorded for this handoff session yet.</p>`
      : r.source === 'fixture'
        ? buildFixtureEditsHtml(r.transcriptModel.transcript_edits)
        : `<ol class="kerf-f34-edits__list">${editsList}</ol>`;

  const handoffBanner =
    r.source === 'handoff'
      ? `<div class="kerf-f34-callout kerf-f34-callout--handoff" role="status">
    <p>Loaded <strong>F-33 handoff</strong> from <code>${esc(FIELD_CAPTURE_HANDOFF_STORAGE_KEY)}</code>. Project and transcript fields below reflect that payload until you clear sessionStorage.</p>
  </div>`
      : '';

  const fixtureBanner =
    r.source === 'fixture'
      ? `<div class="kerf-f34-callout kerf-f34-callout--fixture" role="status">
    <p>Rendering a <strong>generated dry-run transcript</strong>. The edit history below mirrors how a real captured transcript would behave. If F-33 captures a live session in your browser, that takes precedence.</p>
  </div>`
      : '';

  const locationBlock =
    r.locationLine.length > 0 ? `<p class="kerf-f34-muted">${esc(r.locationLine)}</p>` : '';
  const workflowBlock =
    r.workflowLabel.length > 0 ? `<p class="kerf-f34-muted">${esc(r.workflowLabel)}</p>` : '';

  const scopeRows =
    r.source === 'fixture'
      ? buildFixtureScopeRows(r.scopeLines, r.transcriptModel.transcript_current)
      : F34_SCOPE_ROWS.map(
          (row) => `<tr>
  <td>${esc(row.name)}</td>
  <td>${esc(row.category)}</td>
  <td><span class="${confidenceClass(row.confidence)}">${esc(row.confidence)}</span></td>
  <td><q>${esc(row.quote)}</q></td>
  <td>${esc(row.timeLabel)}</td>
  <td><span class="${tagClass(row.tag)}">${esc(row.tag)}</span></td>
</tr>`,
        ).join('');

  return `<div class="kerf-f34">
  <header class="kerf-f34-pagehead" aria-label="Capture context">
    <div class="kerf-f34-pagehead__row">
      <div>
        <p class="kerf-f34-kicker">Project / client</p>
        <p class="kerf-f34-strong">${esc(r.projectLabel)}</p>
        <p class="kerf-f34-muted">${esc(r.clientLabel)}</p>
        ${locationBlock}
        ${workflowBlock}
      </div>
      <div>
        <p class="kerf-f34-kicker">Capture source</p>
        <p class="kerf-f34-strong">${esc(r.captureSource)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Capture time</p>
        <p class="kerf-f34-strong">${esc(r.captureTimeDisplay)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Status</p>
        <p class="kerf-f34-status">${esc(F34_CAPTURE_META.statusLine)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Spine packet (demo)</p>
        <p class="kerf-f34-muted"><code>${esc(r.decisionPacketId)}</code></p>
      </div>
    </div>
  </header>

  ${handoffBanner}
  ${fixtureBanner}
  <div class="kerf-f34-callout kerf-f34-callout--notice" role="note">
    <p>${esc(F34_REQUIRED_NOTICE)}</p>
  </div>
  <p class="kerf-f34-audit-hint">${esc(F34_AUDIT_HINT)}</p>

  <section class="kerf-f34-panel" aria-labelledby="kerf-f34-transcript-h">
    <h2 id="kerf-f34-transcript-h" class="kerf-f34-h2">Transcript panel · transcript_current</h2>
    <p class="kerf-f34-prose">Kerf wraps confidence, edits, and scope extraction. <strong>transcript_original</strong> stays immutable in the collapsed artifact; what you read here is <strong>transcript_current</strong> (working segments). <strong>transcript_edits</strong> are overlay events, not rewrites of the source file.</p>
    ${legendHtml}
    <div class="kerf-f34-transcript-wrap">
      ${segmentsHtml}
    </div>
    <section class="kerf-f34-edits" aria-label="transcript_edits · operator overlay events">
      <h3 class="kerf-f34-h3">transcript_edits (audit overlay)</h3>
      ${editsBody}
    </section>
    <details class="kerf-f34-original">
      <summary>transcript_original (immutable source artifact)</summary>
      <pre class="kerf-f34-original__pre" role="document">${originalPreContent(r)}</pre>
      <p class="kerf-f34-muted">This artifact is never overwritten in the UI — only copied from capture. Working text and highlights come from transcript_current.</p>
    </details>
  </section>

  <section class="kerf-f34-panel" aria-labelledby="kerf-f34-scope-h">
    <h2 id="kerf-f34-scope-h" class="kerf-f34-h2">Extracted scope items</h2>
    <div class="kerf-f34-tablewrap">
      <table class="kerf-f34-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Category</th>
            <th scope="col">Confidence</th>
            <th scope="col">Source quote</th>
            <th scope="col">Source time</th>
            <th scope="col">Tag</th>
          </tr>
        </thead>
        <tbody>${scopeRows}</tbody>
      </table>
    </div>
  </section>
</div>`;
}

export function buildTranscriptReviewRailHtml(): string {
  const r = resolveF34TranscriptReviewCopy();
  const missingCards = clarificationCardsForResolvedCopy(r);
  const resolved = getF34ResolvedMissingIds();
  const answers = getF34ClarificationAnswers();
  const answeredCount = missingCards.filter((card) => resolved.has(card.id)).length;
  const unresolvedCount = missingCards.length - answeredCount;

  const continueHint = missingCards.length === 0
    ? 'No clarification questions surfaced from this capture.'
    : unresolvedCount === 0
      ? 'All clarification prompts have answers in this browser session.'
      : `${unresolvedCount} clarification prompt${unresolvedCount === 1 ? '' : 's'} still open. Kerf proceeds with flagged assumptions where needed.`;
  const continueBlock = `<div class="kerf-f34-continue" role="group" aria-label="Continue gate">
  <a class="kerf-v15-btn kerf-v15-btn--primary kerf-f34-continue" href="/draft-review" data-kerf-v15-nav="true">Continue to Draft</a>
  <p class="kerf-f34-hint">${esc(continueHint)}</p>
</div>`;

  const cards = missingCards.map((card) => {
    const isResolved = resolved.has(card.id);
    const statusLabel = isResolved ? 'Answered' : 'Open';
    const statusClass = isResolved ? 'kerf-f34-mi__status kerf-f34-mi__status--ok' : 'kerf-f34-mi__status kerf-f34-mi__status--open';
    const answer = answers[card.id] ?? '';
    const answerBlock = isResolved
      ? `<p class="kerf-f34-mi__answer"><strong>Recorded for this dry run:</strong> ${esc(answer)}</p>`
      : `<p class="kerf-f34-mi__answer kerf-f34-mi__answer--pending"><strong>Source context:</strong> ${esc(card.sourceQuote)}</p>`;
    return `<article class="kerf-f34-mi" data-kerf-f34-card="${esc(card.id)}">
  <header class="kerf-f34-mi__head">
    <h3 class="kerf-f34-mi__title">${esc(card.title)}</h3>
    <span class="${statusClass}">${statusLabel}</span>
  </header>
  ${answerBlock}
  <label class="kerf-f34-mi__label" for="${esc(card.id)}-answer">Clarification answer</label>
  <textarea id="${esc(card.id)}-answer" class="kerf-f34-mi__input" rows="3" data-kerf-f34-answer="${esc(card.id)}" placeholder="${esc(card.placeholder)}">${esc(answer)}</textarea>
</article>`;
  }).join('');
  const resetHtml = resolved.size > 0
    ? '<p class="kerf-f34-muted"><button type="button" class="kerf-f34-linkbtn" data-kerf-f34-reset="true">Clear answered clarifications</button></p>'
    : '';
  const applyHtml = missingCards.length > 0
    ? `<div class="kerf-f34-continue" role="group" aria-label="Clarification apply">
  <button type="button" class="kerf-v15-btn kerf-v15-btn--primary kerf-f34-mi__btn" data-kerf-f34-apply="true">Apply answers to dry run</button>
  <p class="kerf-f34-hint">Answers stay local to this browser session and update Draft Review, Decision, and Blackboard preview.</p>
</div>`
    : '';

  return `<div class="kerf-f34-rail">
  <h2 class="kerf-f34-h2">Missing information</h2>
  <p class="kerf-f34-prose">Each prompt tracks a gap Kerf could not safely infer from the current capture. You can answer what you know now, then proceed with open gaps still flagged downstream.</p>
  <div class="kerf-f34-mi-stack">${cards}</div>
  ${applyHtml}
  ${continueBlock}
  ${resetHtml}
</div>`;
}
