/// <reference lib="DOM" />
/**
 * Client wiring for `/field` — project list, voice record, daily-log POST.
 */
import { createTranslator } from '../../i18n/index.js';
import { initV15RecordButton, type V15TranscribeMeta } from './v15-record-button.js';
import {
  buildConfirmationHtml,
  buildDailyLogSubmitBody,
  buildErrorHtml,
  buildRightHandResponseHtml,
  buildSourceRefsFromTranscribeMeta,
  dailyLogEntriesUrl,
  FIELD_DAILY_DOM,
  FIELD_DAILY_TENANT_ID,
  type RightHandResponseUI,
} from './pages/field-daily-capture.js';

let lastAudioUri: string | null = null;
let lastSourceRefs: ReturnType<typeof buildSourceRefsFromTranscribeMeta> | undefined;

export function resetFieldDailyClientStateForTests(): void {
  lastAudioUri = null;
  lastSourceRefs = undefined;
}

export async function loadFieldDailyProjects(select: HTMLSelectElement): Promise<void> {
  const t = createTranslator('en');
  select.innerHTML = `<option value="">${t.t('field.project.loading')}</option>`;
  const r = await fetch(`/api/projects?tenant=${encodeURIComponent(FIELD_DAILY_TENANT_ID)}`);
  const j = (await r.json()) as { projects?: Array<{ project_id: string; project_name: string }> };
  const projects = Array.isArray(j.projects) ? j.projects : [];
  if (projects.length === 0) {
    select.innerHTML = `<option value="">${t.t('field.project.empty')}</option>`;
    return;
  }
  select.innerHTML = projects
    .map(
      (p) =>
        `<option value="${escapeAttr(p.project_id)}">${escapeHtml(p.project_name)} (${escapeHtml(p.project_id)})</option>`,
    )
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function getTranscriptText(): string {
  const ta = document.getElementById(FIELD_DAILY_DOM.transcript);
  if (ta instanceof HTMLTextAreaElement) {
    return ta.value;
  }
  const voice = document.getElementById(FIELD_DAILY_DOM.voiceTranscript);
  if (voice instanceof HTMLElement && voice.textContent) {
    return voice.textContent;
  }
  return '';
}

function showFeedback(html: string): void {
  const box = document.getElementById('kerf-field-daily-feedback');
  if (box instanceof HTMLElement) {
    box.innerHTML = html;
  }
}

export async function submitFieldDailyEntry(projectId: string): Promise<void> {
  const t = createTranslator('en');
  const transcript = getTranscriptText();
  const body = buildDailyLogSubmitBody({
    projectId,
    transcriptText: transcript,
    audioUri: lastAudioUri,
    sourceRefs: lastSourceRefs,
  });
  const r = await fetch(dailyLogEntriesUrl(projectId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as {
    event?: { event_id?: string };
    right_hand_response?: RightHandResponseUI | null;
    error?: string;
    reason?: string;
    errors?: string[];
  };
  if (!r.ok) {
    const reason =
      typeof j.reason === 'string'
        ? j.reason
        : Array.isArray(j.errors)
          ? j.errors.join('; ')
          : '';
    showFeedback(buildErrorHtml(t, String(j.error ?? 'request_failed'), reason));
    return;
  }
  const eventId = j.event?.event_id ?? 'unknown';
  // Sprint E.2 — prefer Right Hand response rendering when present.
  // Falls back to the bare confirmation if `right_hand_response` is null/absent
  // (e.g., orchestrator-disabled path or back-compat clients).
  if (j.right_hand_response !== undefined && j.right_hand_response !== null) {
    showFeedback(buildRightHandResponseHtml(t, j.right_hand_response, eventId, transcript));
  } else {
    showFeedback(buildConfirmationHtml(t, eventId, transcript));
  }
}

export function initFieldDailyCapturePage(): void {
  const select = document.getElementById(FIELD_DAILY_DOM.projectSelect);
  if (select instanceof HTMLSelectElement) {
    void loadFieldDailyProjects(select);
  }

  initV15RecordButton({
    onTranscript: (transcript: string, meta: V15TranscribeMeta): void => {
      lastAudioUri = meta.sourceRefUri;
      lastSourceRefs = buildSourceRefsFromTranscribeMeta(meta, transcript);
      const ta = document.getElementById(FIELD_DAILY_DOM.transcript);
      if (ta instanceof HTMLTextAreaElement) {
        const existing = ta.value.trim();
        ta.value = existing.length === 0 ? transcript : `${existing}\n\n${transcript}`;
      }
    },
  });

  const submit = document.getElementById(FIELD_DAILY_DOM.submit);
  if (submit instanceof HTMLButtonElement) {
    submit.addEventListener('click', () => {
      void (async () => {
        const sel = document.getElementById(FIELD_DAILY_DOM.projectSelect);
        if (!(sel instanceof HTMLSelectElement) || sel.value.length === 0) {
          const t = createTranslator('en');
          showFeedback(buildErrorHtml(t, 'invalid_project', 'Select a project first'));
          return;
        }
        const t = createTranslator('en');
        submit.disabled = true;
        submit.textContent = t.t('field.submit.working');
        try {
          await submitFieldDailyEntry(sel.value);
        } finally {
          submit.disabled = false;
          submit.textContent = t.t('field.submit.label');
        }
      })();
    });
  }
}
