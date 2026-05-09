import { escapeHtml } from '../../ui/components/DecisionCardView.js';
import {
  FIELD_CAPTURE_COPY,
  FIELD_WORKFLOW_LABELS,
  fieldCaptureProjectListFixture,
  PHOTO_TAG_LABELS,
  projectById,
  type AttachedPhotoMock,
  type CaptureModeId,
  type FieldCaptureHandoffV1,
  type PhotoTag,
} from '../field-capture-mock.js';
import type { V15FieldCaptureState } from './v15-field-capture-state.js';

const ALL_TAGS: PhotoTag[] = ['room', 'issue', 'material', 'measurement', 'before', 'after'];

function selectedProject(state: V15FieldCaptureState) {
  return projectById(state.projectId) ?? fieldCaptureProjectListFixture[0]!;
}

function photoThumbClass(tags: readonly PhotoTag[]): string {
  if (tags.includes('issue')) return 'kerf-fc-thumb kerf-fc-thumb--issue';
  if (tags.includes('material')) return 'kerf-fc-thumb kerf-fc-thumb--material';
  if (tags.includes('measurement')) return 'kerf-fc-thumb kerf-fc-thumb--measure';
  return 'kerf-fc-thumb kerf-fc-thumb--room';
}

function photoBlock(ph: AttachedPhotoMock): string {
  const tagRow = ALL_TAGS.map((tag) => {
    const active = ph.tags.includes(tag);
    return `<button type="button" class="kerf-fc-tag${active ? ' kerf-fc-tag--on' : ''}" data-kerf-v15-fc-photo="${escapeHtml(
      ph.id,
    )}" data-kerf-v15-fc-tag="${tag}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(PHOTO_TAG_LABELS[tag])}</button>`;
  }).join('');
  return `<div class="kerf-fc-photo-card" data-kerf-v15-fc-photo-card="${escapeHtml(ph.id)}">
    <div class="${photoThumbClass(ph.tags)}" aria-hidden="true"></div>
    <div class="kerf-fc-photo-body">
      <div class="kerf-fc-photo-label">${escapeHtml(ph.label)}</div>
      <div class="kerf-fc-tag-row" role="group" aria-label="Photo tags">${tagRow}</div>
    </div>
  </div>`;
}

function previewRawNote(state: V15FieldCaptureState): string {
  const parts: string[] = [];
  if (state.textNote.trim()) parts.push(state.textNote.trim());
  if (state.manualTranscript.trim()) parts.push(`[Pasted transcript]\n${state.manualTranscript.trim()}`);
  if (parts.length === 0) return '— (no text yet — add a note or paste a transcript)';
  return parts.join('\n\n');
}

function modeChip(id: CaptureModeId, label: string, state: V15FieldCaptureState): string {
  const on = state.modes.has(id);
  return `<button type="button" role="checkbox" aria-checked="${on ? 'true' : 'false'}" class="kerf-fc-mode-chip${
    on ? ' kerf-fc-mode-chip--on' : ''
  }" data-kerf-v15-fc-mode="${id}">${escapeHtml(label)}</button>`;
}

export function buildV15FieldCaptureHandoff(state: V15FieldCaptureState): FieldCaptureHandoffV1 {
  const p = selectedProject(state);
  return {
    v: 1,
    project_id: p.id,
    project_name: p.project_name,
    client_name: p.client_name,
    location: p.location,
    workflow: p.workflow,
    modes: [...state.modes],
    text_note: state.textNote,
    manual_transcript: state.manualTranscript,
    photos: state.photos.map((ph) => ({
      id: ph.id,
      label: ph.label,
      tags: [...ph.tags],
    })),
    created_at_iso: new Date().toISOString(),
  };
}

export function buildV15FieldCaptureHtml(state: V15FieldCaptureState): string {
  const p = selectedProject(state);
  const wfLabel = FIELD_WORKFLOW_LABELS[p.workflow];

  const projectOptions = fieldCaptureProjectListFixture
    .map(
      (proj) =>
        `<option value="${escapeHtml(proj.id)}"${proj.id === state.projectId ? ' selected' : ''}>${escapeHtml(
          proj.project_name,
        )}</option>`,
    )
    .join('');

  return `<div class="kerf-fc-page">
    <p class="kerf-v15-prose" style="margin:0 0 1rem;font-size:0.85rem;color:var(--kerf-fg-muted)">
      Route <code>/field-capture</code> · F·33 embedded in the V1.5 shell. Mock only — no writes, no upload.
    </p>
    <div class="kerf-fc-main">
      <section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-project-h">
        <h2 id="kerf-v15-fc-project-h" class="kerf-fc-h2">Project / client</h2>
        <label class="kerf-fc-label" for="kerf-v15-fc-project-select">Active job</label>
        <select id="kerf-v15-fc-project-select" class="kerf-fc-select">${projectOptions}</select>
        <dl class="kerf-fc-dl">
          <div><dt>Client</dt><dd>${escapeHtml(p.client_name)}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(p.location)}</dd></div>
          <div><dt>Workflow</dt><dd><span class="kerf-fc-pill">${escapeHtml(wfLabel)}</span></dd></div>
        </dl>
      </section>

      <section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-mode-h">
        <h2 id="kerf-v15-fc-mode-h" class="kerf-fc-h2">What are you capturing?</h2>
        <p class="kerf-fc-muted">Turn modes on or off. At least one stays on.</p>
        <div class="kerf-fc-mode-row" role="group" aria-label="Capture modes">
          ${modeChip('text_note', 'Text note', state)}
          ${modeChip('photo', 'Photos', state)}
          ${modeChip('voice', 'Voice note', state)}
          ${modeChip('manual_transcript', 'Manual transcript paste', state)}
        </div>
      </section>

      ${
        state.modes.has('text_note')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-text-h">
        <h2 id="kerf-v15-fc-text-h" class="kerf-fc-h2">Field note</h2>
        <label class="kerf-fc-label" for="kerf-v15-fc-text-note">What changed</label>
        <textarea id="kerf-v15-fc-text-note" class="kerf-fc-textarea" rows="6" placeholder="${escapeHtml(
          FIELD_CAPTURE_COPY.textPlaceholder,
        )}">${escapeHtml(state.textNote)}</textarea>
      </section>`
          : ''
      }

      ${
        state.modes.has('photo')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-photo-h">
        <h2 id="kerf-v15-fc-photo-h" class="kerf-fc-h2">Photos</h2>
        <p class="kerf-fc-muted">Mock attachments — tag each shot for downstream review.</p>
        <div class="kerf-fc-photo-grid">
          ${state.photos.map((ph) => photoBlock(ph)).join('')}
          <button type="button" class="kerf-fc-add-photo" id="kerf-v15-fc-add-photo" aria-label="Add photo placeholder">
            <span class="kerf-fc-add-plus" aria-hidden="true">+</span>
            <span>Add photo</span>
          </button>
        </div>
      </section>`
          : ''
      }

      ${
        state.modes.has('voice')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-voice-h">
        <h2 id="kerf-v15-fc-voice-h" class="kerf-fc-h2">Voice</h2>
        <div class="kerf-fc-voice-box">
          <div class="kerf-fc-voice-ico" aria-hidden="true">🎙</div>
          <div>
            <div class="kerf-fc-voice-title">${escapeHtml(FIELD_CAPTURE_COPY.voiceTitle)}</div>
            <p class="kerf-fc-voice-consent">${escapeHtml(FIELD_CAPTURE_COPY.voiceConsent)}</p>
          </div>
        </div>
      </section>`
          : ''
      }

      ${
        state.modes.has('manual_transcript')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-v15-fc-paste-h">
        <h2 id="kerf-v15-fc-paste-h" class="kerf-fc-h2">Manual transcript paste</h2>
        <p class="kerf-fc-muted">Optional — drop rough ASR or meeting notes here.</p>
        <label class="kerf-fc-label" for="kerf-v15-fc-manual-transcript">Transcript text</label>
        <textarea id="kerf-v15-fc-manual-transcript" class="kerf-fc-textarea" rows="4" placeholder="Paste transcript…">${escapeHtml(
          state.manualTranscript,
        )}</textarea>
      </section>`
          : ''
      }

      <section class="kerf-fc-card kerf-fc-card--preview" aria-labelledby="kerf-v15-fc-preview-h">
        <h2 id="kerf-v15-fc-preview-h" class="kerf-fc-h2">Capture packet preview</h2>
        <p class="kerf-fc-muted">What this becomes after you submit (mock — no server write).</p>
        <dl class="kerf-fc-preview-dl">
          <div><dt>Capture source</dt><dd>${escapeHtml(FIELD_CAPTURE_COPY.captureSource)}</dd></div>
          <div><dt>Project</dt><dd>${escapeHtml(p.project_name)}</dd></div>
          <div><dt>Client</dt><dd>${escapeHtml(p.client_name)}</dd></div>
          <div><dt>Attached photos</dt><dd>${state.modes.has('photo') ? `${state.photos.length} (mock)` : '— (photos off)'}</dd></div>
          <div><dt>Raw note / transcript</dt><dd class="kerf-fc-preview-note">${escapeHtml(previewRawNote(state))}</dd></div>
          <div><dt>Proposed next step</dt><dd><strong>${escapeHtml(FIELD_CAPTURE_COPY.previewNextStep)}</strong></dd></div>
          <div><dt>Approval status</dt><dd class="kerf-fc-gate">${escapeHtml(FIELD_CAPTURE_COPY.previewApproval)}</dd></div>
        </dl>
      </section>

      <section class="kerf-fc-notices" aria-label="Safety notices">
        <p class="kerf-fc-notice kerf-fc-notice--ai">${escapeHtml(FIELD_CAPTURE_COPY.aiNotice)}</p>
        <p class="kerf-fc-notice kerf-fc-notice--gate">${escapeHtml(FIELD_CAPTURE_COPY.gateNotice)}</p>
      </section>

      <div class="kerf-fc-cta-row">
        <button type="button" class="kerf-v15-btn kerf-v15-btn--primary kerf-fc-primary" id="kerf-v15-fc-submit">
          ${escapeHtml(FIELD_CAPTURE_COPY.primaryCta)}
        </button>
        <p class="kerf-fc-cta-hint">Mock only — continues to <code>/transcript-review</code> with handoff in sessionStorage when allowed.</p>
      </div>
    </div>
  </div>`;
}
