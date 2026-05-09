/// <reference lib="DOM" />
import { escapeHtml } from '../ui/components/DecisionCardView.js';
import {
  decodeHandoffFromHash,
  FIELD_CAPTURE_HANDOFF_STORAGE_KEY,
  FIELD_WORKFLOW_LABELS,
  type FieldCaptureHandoffV1,
} from './field-capture-mock.js';

function readHandoff(): FieldCaptureHandoffV1 | null {
  try {
    const raw = sessionStorage.getItem(FIELD_CAPTURE_HANDOFF_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && (parsed as FieldCaptureHandoffV1).v === 1) {
        return parsed as FieldCaptureHandoffV1;
      }
    }
  } catch {
    /* ignore */
  }
  return decodeHandoffFromHash(window.location.hash);
}

function boot(): void {
  const root = document.getElementById('kerf-tr-app-root');
  if (root === null) return;

  const h = readHandoff();
  if (h === null) {
    root.innerHTML = `
      <div class="kerf-tr-empty">
        <p>No capture handoff found. Start from <a href="../field-capture/index.html">Field capture</a>.</p>
      </div>`;
    return;
  }

  const wf = FIELD_WORKFLOW_LABELS[h.workflow];
  const modes = h.modes.join(', ');
  root.innerHTML = `
    <div class="kerf-tr-main">
      <p class="kerf-tr-lead">Transcript review (mock) — next step in the vertical slice after field capture.</p>
      <section class="kerf-tr-card">
        <h2 class="kerf-tr-h2">Handoff summary</h2>
        <dl class="kerf-tr-dl">
          <div><dt>Project</dt><dd>${escapeHtml(h.project_name)}</dd></div>
          <div><dt>Client</dt><dd>${escapeHtml(h.client_name)}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(h.location)}</dd></div>
          <div><dt>Workflow</dt><dd>${escapeHtml(wf)}</dd></div>
          <div><dt>Modes</dt><dd>${escapeHtml(modes)}</dd></div>
          <div><dt>Photos</dt><dd>${h.photos.length}</dd></div>
          <div><dt>Captured at</dt><dd>${escapeHtml(h.created_at_iso)}</dd></div>
        </dl>
      </section>
      <section class="kerf-tr-card">
        <h2 class="kerf-tr-h2">Raw note / transcript</h2>
        <pre class="kerf-tr-pre">${escapeHtml(
          [h.text_note.trim(), h.manual_transcript.trim()].filter(Boolean).join('\n\n---\n\n') || '—',
        )}</pre>
      </section>
      <p class="kerf-tr-foot"><a class="kerf-tr-back" href="../field-capture/index.html">← Back to field capture</a></p>
    </div>
  `;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
