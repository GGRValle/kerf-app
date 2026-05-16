/**
 * Field Daily Step B.4 — minimal `/field` capture surface (not `/field-capture`).
 *
 * Single-purpose daily log entry UI. Posts to `POST /api/projects/<id>/daily-log/entries`.
 * Reuses `v15-record-button.ts` element ids for Whisper voice path.
 */
import { createTranslator, type Translator } from '../../../i18n/index.js';
import type { V15TranscribeMeta } from '../v15-record-button.js';

export const FIELD_DAILY_TENANT_ID = 'tenant_ggr' as const;
export const FIELD_DAILY_ENTRY_KIND = 'progress_update' as const;

export const FIELD_DAILY_DOM = {
  projectSelect: 'kerf-field-daily-project',
  transcript: 'kerf-field-daily-transcript',
  submit: 'kerf-field-daily-submit',
  confirm: 'kerf-field-daily-confirm',
  error: 'kerf-field-daily-error',
  /** Shared with v15-record-button.ts */
  voiceRecord: 'kerf-v15-voice-record',
  voiceStatus: 'kerf-v15-voice-status',
  voiceTranscript: 'kerf-v15-voice-transcript',
} as const;

export interface DailyLogSubmitInput {
  readonly projectId: string;
  readonly transcriptText: string;
  readonly audioUri: string | null;
  readonly sourceRefs?: readonly { readonly kind: 'voice' | 'transcript'; readonly uri?: string; readonly excerpt?: string }[];
}

/** Build POST body for daily-log/entries (testable). */
export function buildDailyLogSubmitBody(input: DailyLogSubmitInput): Record<string, unknown> {
  const transcript = input.transcriptText.trim();
  const body: Record<string, unknown> = {
    tenant_id: FIELD_DAILY_TENANT_ID,
    entry_kind: FIELD_DAILY_ENTRY_KIND,
    actor: { id: 'browser_operator', role: 'field_super' },
    transcript_text: transcript.length > 0 ? transcript : null,
  };
  if (input.audioUri !== null && input.audioUri.length > 0) {
    body['audio_uri'] = input.audioUri;
  }
  if (input.sourceRefs !== undefined && input.sourceRefs.length > 0) {
    body['source_refs'] = input.sourceRefs;
  } else if (input.audioUri !== null && input.audioUri.length > 0) {
    body['source_refs'] = [{ kind: 'voice', uri: input.audioUri }];
  }
  return body;
}

export function dailyLogEntriesUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/daily-log/entries`;
}

export function buildSourceRefsFromTranscribeMeta(
  meta: V15TranscribeMeta,
  transcript: string,
): readonly { readonly kind: 'voice'; readonly uri: string }[] {
  return [{ kind: 'voice', uri: meta.sourceRefUri }];
}

export function formatTranscriptPreview(transcript: string, maxLen = 200): string {
  const t = transcript.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

export function buildConfirmationHtml(
  t: Translator,
  eventId: string,
  transcript: string,
): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<section class="kerf-v15-card kerf-field-daily__confirm" id="${FIELD_DAILY_DOM.confirm}" aria-live="polite">
  <h2 class="kerf-v15-card__title">${esc(t.t('field.confirm.title'))}</h2>
  <dl class="kerf-fc-preview-dl">
    <div><dt>${esc(t.t('field.confirm.event_id'))}</dt><dd><code>${esc(eventId)}</code></dd></div>
    <div><dt>${esc(t.t('field.confirm.transcript_preview'))}</dt><dd>${esc(formatTranscriptPreview(transcript))}</dd></div>
  </dl>
</section>`;
}

export function buildErrorHtml(t: Translator, error: string, reason: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const detail = reason.length > 0 ? `${error}: ${reason}` : error;
  return `<section class="kerf-v15-card kerf-field-daily__error" id="${FIELD_DAILY_DOM.error}" role="alert">
  <h2 class="kerf-v15-card__title">${esc(t.t('field.error.title'))}</h2>
  <p class="kerf-v15-prose kerf-v15-prose--error">${esc(detail)}</p>
</section>`;
}

export function buildFieldDailyCaptureHtml(locale: 'en' | 'es' = 'en'): string {
  const t = createTranslator(locale);
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<section class="kerf-field-daily" aria-labelledby="kerf-field-daily-h">
  <header class="kerf-field-daily__brand">
    <h1 id="kerf-field-daily-h" class="kerf-field-daily__brand-title">${esc(t.t('field.brand.title'))}</h1>
    <p class="kerf-v15-card__meta">${esc(t.t('field.notice.entry_kind'))}</p>
  </header>

  <label class="kerf-field-daily__label" for="${FIELD_DAILY_DOM.projectSelect}">
    ${esc(t.t('field.project.label'))}
    <select id="${FIELD_DAILY_DOM.projectSelect}" class="kerf-field-daily__select" data-kerf-field-daily-project-select>
      <option value="">${esc(t.t('field.project.loading'))}</option>
    </select>
  </label>

  <section class="kerf-v15-card" aria-labelledby="kerf-field-daily-voice-h">
    <h2 id="kerf-field-daily-voice-h" class="kerf-v15-card__title">${esc(t.t('field.voice.section_label'))}</h2>
    <button type="button" class="kerf-v15-btn kerf-v15-btn--primary kerf-field-daily__record" id="${FIELD_DAILY_DOM.voiceRecord}">
      ${esc(t.t('field.voice.record_button'))}
    </button>
    <p class="kerf-v15-card__meta" id="${FIELD_DAILY_DOM.voiceStatus}" aria-live="polite"></p>
    <p class="kerf-v15-prose" id="${FIELD_DAILY_DOM.voiceTranscript}" hidden></p>
  </section>

  <label class="kerf-field-daily__label" for="${FIELD_DAILY_DOM.transcript}">
    ${esc(t.t('field.transcript.test_label'))}
    <textarea id="${FIELD_DAILY_DOM.transcript}" class="kerf-field-daily__textarea" rows="5" spellcheck="false" placeholder="${esc(t.t('field.transcript.placeholder'))}"></textarea>
  </label>

  <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" id="${FIELD_DAILY_DOM.submit}">${esc(t.t('field.submit.label'))}</button>

  <div id="kerf-field-daily-feedback" class="kerf-field-daily__feedback"></div>
</section>`;
}
