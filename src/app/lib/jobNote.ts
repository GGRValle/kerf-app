/**
 * Lane B · Shared Job-Note artifact — types + capture→job-note pipeline.
 *
 * Canon: the model-led / job-note packet
 * (RightHand_ModelLed_Persistent_Response_and_JobNote_Artifacts),
 * `feedback_business_brain_not_file_cabinet`,
 * `feedback_avoid_overbuilding_review_surfaces`,
 * `feedback_red_is_chip_tier_not_row_tier`,
 * `kerf_ai_disclosure_pattern`, D-053 two-artifact.
 *
 * A captured voice note, photo, scan, or text update should render the same
 * way everywhere: a friendly **job note**, not a capture card. This module is
 * the PRODUCER half — the typed contract + the pure mapper. The `JobNote` /
 * `JobNoteList` components render from `JobNoteView`; Camera, Daily Log, the
 * Pulse, and Field Updates are CONSUMERS that build the input and mount the
 * component. No UI lives here.
 *
 * Honesty invariants (Floor / Bar 2):
 *   - No false persistence. `filing.state` is derived ONLY from the presence of
 *     a durable-write signal — never assumed. A capture that has not been
 *     committed reads `ready_to_save`; only a returned durable write flips it to
 *     `filed`.
 *   - Tenant-scoped. The mapper only ever sees one tenant's data; a cross-tenant
 *     payload/job mismatch is refused, not silently rendered.
 *   - Summaries are model-written prose (no money rendered as a written field).
 *   - `expandHref` carries an opaque id only — never transcript/summary/PII in a
 *     query string.
 */

import type {
  DailyLogEntryCapturedEvent,
  PersistenceTenantId,
} from '../../persistence/events.js';

/** How the capture arrived → rendered as a quiet "via voice" chip. */
export type JobNoteSource = 'voice' | 'photo' | 'scan' | 'note' | 'text_in';

export interface JobNoteMedia {
  readonly kind: 'photo' | 'video' | 'doc';
  readonly thumbUri: string;
  readonly fullUri: string;
}

/**
 * Filing is a discriminated union on purpose: the `at` timestamp ONLY exists in
 * the `filed` variant, so the type system makes "Filed" impossible to render
 * from a not-yet-written note. The component enforces the same at runtime.
 */
export type JobNoteFiling =
  | { readonly state: 'ready_to_save' }
  | { readonly state: 'filed'; readonly at: string };

export interface JobNoteView {
  readonly id: string;
  /** Where it filed / will file. */
  readonly job: { readonly id: string; readonly name: string };
  /** Model-written, plain English, ~≤140 chars. */
  readonly summary: string;
  readonly source: JobNoteSource;
  readonly media?: ReadonlyArray<JobNoteMedia>;
  readonly filing: JobNoteFiling;
  /** Optional → small "Needs review" CHIP only. Never a row treatment. */
  readonly needsReview?: { readonly reason: string };
  /** Tap → full capture/detail (depth lives underneath; never inline). */
  readonly expandHref: string;
}

/** ≤140-char target for the model-written summary line. */
export const JOB_NOTE_SUMMARY_MAX = 140;

/**
 * Normalized capture payload feeding the mapper. Represents the union of the
 * upstream shapes the pipeline maps from — a `draft.synthesized` payload
 * (Phase 1H), a persisted `daily_log.entry_captured`, or an SMS
 * `daily_log_ingest` — reduced to just the fields the renderer needs.
 *
 * `durable_write` is the ONLY signal that means "filed". It is present when a
 * durable write has returned (e.g. the persisted event's emission time); it is
 * absent/null for a synthesized-but-unwritten draft.
 */
export interface JobNoteCapturePayload {
  readonly id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly channel: JobNoteSource;
  /** Model's `daily_log_summary`. May be null/empty before synthesis runs. */
  readonly summary: string | null;
  /** Raw transcript fallback used only when no model summary exists. */
  readonly transcript_text?: string | null;
  readonly media?: ReadonlyArray<JobNoteMedia>;
  readonly needs_review_reason?: string | null;
  /**
   * Durable-write proof. Presence ⇒ `filed` at this time. Absence/null ⇒
   * `ready_to_save`. Never assume filed without this.
   */
  readonly durable_write?: { readonly at: string } | null;
}

export interface JobNoteJobContext {
  readonly id: string;
  readonly name: string;
  readonly tenant_id: PersistenceTenantId;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Truncate to the line budget, adding a single ellipsis when cut. */
export function truncateSummary(value: string, max = JOB_NOTE_SUMMARY_MAX): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function channelFallbackSummary(channel: JobNoteSource): string {
  switch (channel) {
    case 'photo':
      return 'Photo update';
    case 'voice':
      return 'Voice note';
    case 'scan':
      return 'Scan capture';
    case 'text_in':
      return 'Text update';
    case 'note':
    default:
      return 'Field note';
  }
}

/**
 * Summary precedence: model summary → cleaned transcript → channel fallback.
 * Always whitespace-cleaned and truncated to the line budget.
 */
export function deriveJobNoteSummary(payload: JobNoteCapturePayload): string {
  const model = payload.summary ? cleanLine(payload.summary) : '';
  if (model.length > 0) return truncateSummary(model);
  const transcript = payload.transcript_text ? cleanLine(payload.transcript_text) : '';
  if (transcript.length > 0) return truncateSummary(transcript);
  return channelFallbackSummary(payload.channel);
}

/**
 * Map a normalized capture payload into a `JobNoteView`. Pure, tenant-scoped.
 *
 * @throws if the payload tenant does not match the job-context tenant. The
 *   mapper must only ever see one tenant's data; a mismatch is a programming
 *   error (or a leak attempt), never something to render.
 */
export function toJobNoteView(
  payload: JobNoteCapturePayload,
  job: JobNoteJobContext,
): JobNoteView {
  if (payload.tenant_id !== job.tenant_id) {
    throw new Error(
      'toJobNoteView: cross-tenant mapping refused — payload and job context must share a tenant',
    );
  }

  // Honest filing: filed ONLY when a durable write returned. Never assumed.
  const filing: JobNoteFiling =
    payload.durable_write && typeof payload.durable_write.at === 'string'
      ? { state: 'filed', at: payload.durable_write.at }
      : { state: 'ready_to_save' };

  const reason = payload.needs_review_reason?.trim() ?? '';

  return {
    id: payload.id,
    job: { id: job.id, name: job.name },
    summary: deriveJobNoteSummary(payload),
    source: payload.channel,
    filing,
    // Opaque id only — no transcript/summary/PII in the query string.
    expandHref: `/field-detail?entry_id=${encodeURIComponent(payload.id)}`,
    ...(payload.media && payload.media.length > 0 ? { media: payload.media } : {}),
    ...(reason.length > 0 ? { needsReview: { reason } } : {}),
  };
}

function deriveChannelFromEvent(event: DailyLogEntryCapturedEvent): JobNoteSource {
  if (event.audio_uri !== null) return 'voice';
  if (event.photo_uris.length > 0) return 'photo';
  return 'note';
}

/**
 * Adapt a persisted `daily_log.entry_captured` event into a capture payload.
 *
 * A persisted event IS the durable write — its emission time (`at`) is the
 * proof. This is the canonical demonstration of the no-false-persistence rule:
 * `filing.state` flips to `filed` because the write event EXISTS, not because
 * anyone assumed it. A pre-write synthesized draft (no event) stays
 * `ready_to_save`.
 */
export function capturedEventToPayload(
  event: DailyLogEntryCapturedEvent,
  extras?: {
    readonly summary?: string | null;
    readonly media?: ReadonlyArray<JobNoteMedia>;
    readonly needs_review_reason?: string | null;
    readonly channel?: JobNoteSource;
  },
): JobNoteCapturePayload {
  return {
    id: event.entry_id,
    tenant_id: event.tenant_id,
    channel: extras?.channel ?? deriveChannelFromEvent(event),
    summary: extras?.summary ?? null,
    transcript_text: event.transcript_text,
    durable_write: { at: event.at },
    ...(extras?.media ? { media: extras.media } : {}),
    ...(extras?.needs_review_reason ? { needs_review_reason: extras.needs_review_reason } : {}),
  };
}

export interface JobNoteLabels {
  readonly readyToFile: string;
  readonly filedPrefix: string;
  readonly needsReview: string;
  readonly via: (source: JobNoteSource) => string;
}

const DEFAULT_SOURCE_WORD: Record<JobNoteSource, string> = {
  voice: 'voice',
  photo: 'photo',
  scan: 'scan',
  note: 'note',
  text_in: 'text',
};

export const DEFAULT_JOB_NOTE_LABELS: JobNoteLabels = {
  readyToFile: 'Ready to file',
  filedPrefix: 'Filed',
  needsReview: 'Needs review',
  via: (source) => `via ${DEFAULT_SOURCE_WORD[source] ?? 'capture'}`,
};

/** Default section-level AI disclosure copy (kerf_ai_disclosure_pattern). */
export const JOB_NOTE_DISCLOSURE = 'AI-assisted by Right Hand · review before approval';

/**
 * Format a filed timestamp as a compact wall-clock label, e.g. `9:24a` / `2:05p`.
 * Reads the time-of-day directly from the ISO string so the rendered label is
 * the capture's own clock (deterministic, no host-timezone drift).
 */
export function formatFiledTime(iso: string): string {
  let hours: number;
  let minutes: number;
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match) {
    hours = Number(match[1]);
    minutes = Number(match[2]);
  } else {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    hours = date.getHours();
    minutes = date.getMinutes();
  }
  const meridiem = hours < 12 ? 'a' : 'p';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')}${meridiem}`;
}

/**
 * Component-enforced honest filing label. Switches on the discriminator ONLY —
 * a malformed object that claims `ready_to_save` can never yield "Filed", even
 * if it smuggles an `at`. This is the runtime half of the no-false-persistence
 * guarantee (the type system is the compile-time half).
 */
export function jobNoteFilingLabel(
  filing: JobNoteFiling,
  labels: JobNoteLabels = DEFAULT_JOB_NOTE_LABELS,
): string {
  if (filing.state === 'filed' && typeof filing.at === 'string' && filing.at.length > 0) {
    return `${labels.filedPrefix} · ${formatFiledTime(filing.at)}`;
  }
  return labels.readyToFile;
}

/** Quiet source chip label, e.g. "via voice". */
export function jobNoteSourceLabel(
  source: JobNoteSource,
  labels: JobNoteLabels = DEFAULT_JOB_NOTE_LABELS,
): string {
  return labels.via(source);
}
