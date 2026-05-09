import {
  F34_AUDIT_HINT,
  F34_CAPTURE_META,
  F34_MISSING_INFO_CARDS,
  F34_REQUIRED_NOTICE,
  F34_SCOPE_ROWS,
  F34_TRANSCRIPT_EDITS,
  F34_TRANSCRIPT_ORIGINAL,
  F34_TRANSCRIPT_SEGMENTS,
  type ScopeTagType,
} from './f34-transcript-review-mock.js';
import { f34AllMissingResolved, getF34ResolvedMissingIds } from './f34-transcript-review-state.js';

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

export function buildTranscriptReviewMainHtml(): string {
  const editsList = F34_TRANSCRIPT_EDITS.map(
    (e) =>
      `<li><span class="kerf-f34-edits__ts">${esc(e.atLabel)}</span> · <strong>${esc(e.originalToken)}</strong> → <strong>${esc(e.currentToken)}</strong> · ${esc(e.source)}</li>`,
  ).join('');

  const segmentsHtml = F34_TRANSCRIPT_SEGMENTS.map(
    (seg) => `<article class="kerf-f34-segment" aria-labelledby="${esc(seg.id)}-h">
  <header class="kerf-f34-segment__head">
    <h3 id="${esc(seg.id)}-h" class="kerf-f34-segment__title">${esc(seg.timeLabel)}</h3>
    <p class="kerf-f34-segment__src">${esc(seg.sourceRef)}</p>
  </header>
  <p class="kerf-f34-segment__body">${seg.htmlBody}</p>
</article>`,
  ).join('');

  const scopeRows = F34_SCOPE_ROWS.map(
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
        <p class="kerf-f34-strong">${esc(F34_CAPTURE_META.projectLabel)}</p>
        <p class="kerf-f34-muted">${esc(F34_CAPTURE_META.clientLabel)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Capture source</p>
        <p class="kerf-f34-strong">${esc(F34_CAPTURE_META.captureSource)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Capture time</p>
        <p class="kerf-f34-strong">${esc(F34_CAPTURE_META.captureTimeDisplay)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Status</p>
        <p class="kerf-f34-status">${esc(F34_CAPTURE_META.statusLine)}</p>
      </div>
      <div>
        <p class="kerf-f34-kicker">Spine packet (demo)</p>
        <p class="kerf-f34-muted"><code>${esc(F34_CAPTURE_META.decision_packet_id)}</code></p>
      </div>
    </div>
  </header>

  <div class="kerf-f34-callout kerf-f34-callout--notice" role="note">
    <p>${esc(F34_REQUIRED_NOTICE)}</p>
  </div>
  <p class="kerf-f34-audit-hint">${esc(F34_AUDIT_HINT)}</p>

  <section class="kerf-f34-panel" aria-labelledby="kerf-f34-transcript-h">
    <h2 id="kerf-f34-transcript-h" class="kerf-f34-h2">Transcript panel · transcript_current</h2>
    <p class="kerf-f34-prose">Kerf wraps confidence, edits, and scope extraction. <strong>transcript_original</strong> stays immutable below; what you read here is <strong>transcript_current</strong> (working text with overlays applied).</p>
    <div class="kerf-f34-legend" aria-label="Highlight legend">
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--corrected"></span> Corrected low-confidence</span>
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--lowconf"></span> Low confidence</span>
      <span class="kerf-f34-legend__item"><span class="kerf-f34-sample kerf-f34-sample--gap"></span> Missing detail</span>
    </div>
    <div class="kerf-f34-transcript-wrap">
      ${segmentsHtml}
    </div>
    <section class="kerf-f34-edits" aria-label="transcript_edits · operator overlay events">
      <h3 class="kerf-f34-h3">transcript_edits (audit overlay)</h3>
      <ol class="kerf-f34-edits__list">${editsList}</ol>
    </section>
    <details class="kerf-f34-original">
      <summary>transcript_original (immutable source artifact)</summary>
      <pre class="kerf-f34-original__pre" role="document">${esc(F34_TRANSCRIPT_ORIGINAL)}</pre>
      <p class="kerf-f34-muted">This text is never overwritten in the UI — only copied from capture. Corrections live as events and in transcript_current.</p>
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
  const resolved = getF34ResolvedMissingIds();
  const allResolved = f34AllMissingResolved(F34_MISSING_INFO_CARDS.map((c) => c.id));

  const continueBlock = allResolved
    ? `<div class="kerf-f34-continue" role="group" aria-label="Continue gate">
  <a class="kerf-v15-btn kerf-v15-btn--primary kerf-f34-continue" href="/draft-review" data-kerf-v15-nav="true">Continue to Draft</a>
  <p class="kerf-f34-hint">All missing-information cards are resolved for this mock session.</p>
</div>`
    : `<div class="kerf-f34-continue" role="group" aria-label="Continue gate">
  <button type="button" class="kerf-v15-btn kerf-v15-btn--primary kerf-f34-continue" disabled aria-describedby="kerf-f34-continue-hint">Continue to Draft</button>
  <p id="kerf-f34-continue-hint" class="kerf-f34-hint">Resolve every missing-information card below to enable draft.</p>
</div>`;

  const cards = F34_MISSING_INFO_CARDS.map((card) => {
    const isResolved = resolved.has(card.id);
    const statusLabel = isResolved ? 'Resolved' : 'Unresolved';
    const statusClass = isResolved ? 'kerf-f34-mi__status kerf-f34-mi__status--ok' : 'kerf-f34-mi__status kerf-f34-mi__status--open';
    const answerBlock = isResolved
      ? `<p class="kerf-f34-mi__answer"><strong>Selected (mock):</strong> ${esc(card.mockAnswer)}</p>`
      : `<p class="kerf-f34-mi__answer kerf-f34-mi__answer--pending">No answer recorded yet.</p>`;
    return `<article class="kerf-f34-mi" data-kerf-f34-card="${esc(card.id)}">
  <header class="kerf-f34-mi__head">
    <h3 class="kerf-f34-mi__title">${esc(card.title)}</h3>
    <span class="${statusClass}">${statusLabel}</span>
  </header>
  ${answerBlock}
  <button type="button" class="kerf-v15-btn kerf-f34-mi__btn" data-kerf-f34-resolve="${esc(card.id)}">${isResolved ? 'Mark unresolved (demo)' : 'Mark resolved (mock)'}</button>
</article>`;
  }).join('');

  return `<div class="kerf-f34-rail">
  <h2 class="kerf-f34-h2">Missing information</h2>
  <p class="kerf-f34-prose">Each card tracks a gap Right Hand could not infer from audio alone.</p>
  <div class="kerf-f34-mi-stack">${cards}</div>
  ${continueBlock}
  <p class="kerf-f34-muted"><button type="button" class="kerf-f34-linkbtn" data-kerf-f34-reset="true">Reset demo resolution state</button></p>
</div>`;
}
