/// <reference lib="DOM" />
import { escapeHtml } from '../ui/components/DecisionCardView.js';
import {
  cloneSeedPhotos,
  defaultProjectId,
  encodeHandoffToHash,
  FIELD_CAPTURE_COPY,
  FIELD_CAPTURE_HANDOFF_STORAGE_KEY,
  fieldCaptureProjectListFixture,
  FIELD_WORKFLOW_LABELS,
  PHOTO_TAG_LABELS,
  projectById,
  type AttachedPhotoMock,
  type CaptureModeId,
  type FieldCaptureHandoffV1,
  type PhotoTag,
} from './field-capture-mock.js';

const ALL_TAGS: PhotoTag[] = ['room', 'issue', 'material', 'measurement', 'before', 'after'];

type AppState = {
  projectId: string;
  modes: Set<CaptureModeId>;
  textNote: string;
  manualTranscript: string;
  photos: AttachedPhotoMock[];
};

function initialState(): AppState {
  return {
    projectId: defaultProjectId(),
    modes: new Set<CaptureModeId>(['text_note', 'photo', 'voice']),
    textNote: '',
    manualTranscript: '',
    photos: cloneSeedPhotos(),
  };
}

let state = initialState();

function selectedProject() {
  return projectById(state.projectId) ?? fieldCaptureProjectListFixture[0]!;
}

function toggleMode(id: CaptureModeId): void {
  if (state.modes.has(id)) state.modes.delete(id);
  else state.modes.add(id);
  if (state.modes.size === 0) state.modes.add('text_note');
  render();
}

function togglePhotoTag(photoId: string, tag: PhotoTag): void {
  const ph = state.photos.find((p) => p.id === photoId);
  if (!ph) return;
  const i = ph.tags.indexOf(tag);
  if (i >= 0) ph.tags.splice(i, 1);
  else ph.tags.push(tag);
  render();
}

function addMockPhoto(): void {
  state.photos.push({
    id: `ph_new_${Date.now()}`,
    label: 'New photo (mock)',
    tags: ['room'],
  });
  render();
}

function buildHandoff(): FieldCaptureHandoffV1 {
  const p = selectedProject();
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

function navigateToTranscriptReview(handoff: FieldCaptureHandoffV1): void {
  try {
    sessionStorage.setItem(FIELD_CAPTURE_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    /* quota or file:// — hash still carries payload */
  }
  const url = new URL('../transcript-review/index.html', window.location.href);
  url.hash = encodeHandoffToHash(handoff);
  window.location.assign(url.href);
}

function modeChip(id: CaptureModeId, label: string): string {
  const on = state.modes.has(id);
  return `<button type="button" role="checkbox" aria-checked="${on ? 'true' : 'false'}" class="kerf-fc-mode-chip${
    on ? ' kerf-fc-mode-chip--on' : ''
  }" data-kerf-fc-mode="${id}">${escapeHtml(label)}</button>`;
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
    return `<button type="button" class="kerf-fc-tag${active ? ' kerf-fc-tag--on' : ''}" data-kerf-fc-photo="${escapeHtml(
      ph.id,
    )}" data-kerf-fc-tag="${tag}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(PHOTO_TAG_LABELS[tag])}</button>`;
  }).join('');
  return `<div class="kerf-fc-photo-card" data-kerf-fc-photo-card="${escapeHtml(ph.id)}">
    <div class="${photoThumbClass(ph.tags)}" aria-hidden="true"></div>
    <div class="kerf-fc-photo-body">
      <div class="kerf-fc-photo-label">${escapeHtml(ph.label)}</div>
      <div class="kerf-fc-tag-row" role="group" aria-label="Photo tags">${tagRow}</div>
    </div>
  </div>`;
}

function previewRawNote(): string {
  const parts: string[] = [];
  if (state.textNote.trim()) parts.push(state.textNote.trim());
  if (state.manualTranscript.trim()) parts.push(`[Pasted transcript]\n${state.manualTranscript.trim()}`);
  if (parts.length === 0) return '— (no text yet — add a note or paste a transcript)';
  return parts.join('\n\n');
}

function render(): void {
  const root = document.getElementById('kerf-fc-app-root');
  if (root === null) return;

  const p = selectedProject();
  const wfLabel = FIELD_WORKFLOW_LABELS[p.workflow];

  const projectOptions = fieldCaptureProjectListFixture
    .map(
      (proj) =>
        `<option value="${escapeHtml(proj.id)}"${proj.id === state.projectId ? ' selected' : ''}>${escapeHtml(
          proj.project_name,
        )}</option>`,
    )
    .join('');

  root.innerHTML = `
    <div class="kerf-fc-main">
      <section class="kerf-fc-card" aria-labelledby="kerf-fc-project-h">
        <h2 id="kerf-fc-project-h" class="kerf-fc-h2">Project / client</h2>
        <label class="kerf-fc-label" for="kerf-fc-project-select">Active job</label>
        <select id="kerf-fc-project-select" class="kerf-fc-select">${projectOptions}</select>
        <dl class="kerf-fc-dl">
          <div><dt>Client</dt><dd>${escapeHtml(p.client_name)}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(p.location)}</dd></div>
          <div><dt>Workflow</dt><dd><span class="kerf-fc-pill">${escapeHtml(wfLabel)}</span></dd></div>
        </dl>
      </section>

      <section class="kerf-fc-card" aria-labelledby="kerf-fc-mode-h">
        <h2 id="kerf-fc-mode-h" class="kerf-fc-h2">What are you capturing?</h2>
        <p class="kerf-fc-muted">Turn modes on or off. At least one stays on.</p>
        <div class="kerf-fc-mode-row" role="group" aria-label="Capture modes">
          ${modeChip('text_note', 'Text note')}
          ${modeChip('photo', 'Photos')}
          ${modeChip('voice', 'Voice note')}
          ${modeChip('manual_transcript', 'Manual transcript paste')}
        </div>
      </section>

      ${
        state.modes.has('text_note')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-fc-text-h">
        <h2 id="kerf-fc-text-h" class="kerf-fc-h2">Field note</h2>
        <label class="kerf-fc-label" for="kerf-fc-text-note">What changed</label>
        <textarea id="kerf-fc-text-note" class="kerf-fc-textarea" rows="6" placeholder="${escapeHtml(
          FIELD_CAPTURE_COPY.textPlaceholder,
        )}"></textarea>
      </section>`
          : ''
      }

      ${
        state.modes.has('photo')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-fc-photo-h">
        <h2 id="kerf-fc-photo-h" class="kerf-fc-h2">Photos</h2>
        <p class="kerf-fc-muted">Mock attachments — tag each shot for downstream review.</p>
        <div class="kerf-fc-photo-grid">
          ${state.photos.map((ph) => photoBlock(ph)).join('')}
          <button type="button" class="kerf-fc-add-photo" id="kerf-fc-add-photo" aria-label="Add photo placeholder">
            <span class="kerf-fc-add-plus" aria-hidden="true">+</span>
            <span>Add photo</span>
          </button>
        </div>
      </section>`
          : ''
      }

      ${
        state.modes.has('voice')
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-fc-voice-h">
        <h2 id="kerf-fc-voice-h" class="kerf-fc-h2">Voice</h2>
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
          ? `<section class="kerf-fc-card" aria-labelledby="kerf-fc-paste-h">
        <h2 id="kerf-fc-paste-h" class="kerf-fc-h2">Manual transcript paste</h2>
        <p class="kerf-fc-muted">Optional — drop rough ASR or meeting notes here.</p>
        <label class="kerf-fc-label" for="kerf-fc-manual-transcript">Transcript text</label>
        <textarea id="kerf-fc-manual-transcript" class="kerf-fc-textarea" rows="4" placeholder="Paste transcript…"></textarea>
      </section>`
          : ''
      }

      <section class="kerf-fc-card kerf-fc-card--preview" aria-labelledby="kerf-fc-preview-h">
        <h2 id="kerf-fc-preview-h" class="kerf-fc-h2">Capture packet preview</h2>
        <p class="kerf-fc-muted">What this becomes after you submit (mock — no server write).</p>
        <dl class="kerf-fc-preview-dl">
          <div><dt>Capture source</dt><dd>${escapeHtml(FIELD_CAPTURE_COPY.captureSource)}</dd></div>
          <div><dt>Project</dt><dd>${escapeHtml(p.project_name)}</dd></div>
          <div><dt>Client</dt><dd>${escapeHtml(p.client_name)}</dd></div>
          <div><dt>Attached photos</dt><dd>${state.modes.has('photo') ? `${state.photos.length} (mock)` : '— (photos off)'}</dd></div>
          <div><dt>Raw note / transcript</dt><dd class="kerf-fc-preview-note">${escapeHtml(previewRawNote())}</dd></div>
          <div><dt>Proposed next step</dt><dd><strong>${escapeHtml(FIELD_CAPTURE_COPY.previewNextStep)}</strong></dd></div>
          <div><dt>Approval status</dt><dd class="kerf-fc-gate">${escapeHtml(FIELD_CAPTURE_COPY.previewApproval)}</dd></div>
        </dl>
      </section>

      <section class="kerf-fc-notices" aria-label="Safety notices">
        <p class="kerf-fc-notice kerf-fc-notice--ai">${escapeHtml(FIELD_CAPTURE_COPY.aiNotice)}</p>
        <p class="kerf-fc-notice kerf-fc-notice--gate">${escapeHtml(FIELD_CAPTURE_COPY.gateNotice)}</p>
      </section>

      <div class="kerf-fc-cta-row">
        <button type="button" class="kerf-btn kerf-btn-primary kerf-fc-primary" id="kerf-fc-submit">
          ${escapeHtml(FIELD_CAPTURE_COPY.primaryCta)}
        </button>
        <p class="kerf-fc-cta-hint">Mock only — routes to <code>transcript-review</code> with handoff in the URL hash (and sessionStorage when allowed).</p>
      </div>
    </div>
  `;

  wireForm();
  const ta0 = document.getElementById('kerf-fc-text-note') as HTMLTextAreaElement | null;
  if (ta0) ta0.value = state.textNote;
  const mt0 = document.getElementById('kerf-fc-manual-transcript') as HTMLTextAreaElement | null;
  if (mt0) mt0.value = state.manualTranscript;
}

function wireForm(): void {
  const sel = document.getElementById('kerf-fc-project-select') as HTMLSelectElement | null;
  sel?.addEventListener('change', () => {
    state.projectId = sel.value;
    render();
  });

  const ta = document.getElementById('kerf-fc-text-note') as HTMLTextAreaElement | null;
  ta?.addEventListener('input', () => {
    state.textNote = ta.value;
    const noteDd = document.querySelector('.kerf-fc-preview-note');
    if (noteDd) noteDd.textContent = previewRawNote();
  });

  const mt = document.getElementById('kerf-fc-manual-transcript') as HTMLTextAreaElement | null;
  mt?.addEventListener('input', () => {
    state.manualTranscript = mt.value;
    const noteDd = document.querySelector('.kerf-fc-preview-note');
    if (noteDd) noteDd.textContent = previewRawNote();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-kerf-fc-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-kerf-fc-mode') as CaptureModeId | null;
      if (id) toggleMode(id);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-kerf-fc-photo][data-kerf-fc-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-kerf-fc-photo');
      const tag = btn.getAttribute('data-kerf-fc-tag') as PhotoTag | null;
      if (pid && tag) togglePhotoTag(pid, tag);
    });
  });

  document.getElementById('kerf-fc-add-photo')?.addEventListener('click', addMockPhoto);

  document.getElementById('kerf-fc-submit')?.addEventListener('click', () => {
    navigateToTranscriptReview(buildHandoff());
  });
}

function boot(): void {
  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
