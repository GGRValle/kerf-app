import type { PersistenceEvent } from '../persistence/events.js';

export interface CaptureOriginSession {
  readonly session_id: string;
  readonly captured_at: string;
  readonly detail_href: string;
  readonly voice_clips: number;
  readonly photos: number;
  readonly transcripts: number;
}

export interface ProposalCaptureOrigin {
  readonly sessions: readonly CaptureOriginSession[];
  readonly earliest_at: string | null;
  readonly voice_clip_count: number;
  readonly photo_count: number;
  readonly transcript_count: number;
}

export const EMPTY_CAPTURE_ORIGIN: ProposalCaptureOrigin = {
  sessions: [],
  earliest_at: null,
  voice_clip_count: 0,
  photo_count: 0,
  transcript_count: 0,
};

function sessionFromCapture(event: Extract<PersistenceEvent, { type: 'capture.recorded' }>): CaptureOriginSession {
  const voice = event.audio_uri !== null ? 1 : 0;
  const transcripts = event.transcript_text.trim().length > 0 ? 1 : 0;
  return {
    session_id: event.capture_id,
    captured_at: event.at,
    detail_href: `/field-capture?capture_id=${encodeURIComponent(event.capture_id)}`,
    voice_clips: voice,
    photos: 0,
    transcripts,
  };
}

function sessionFromDailyLog(
  event: Extract<PersistenceEvent, { type: 'daily_log.entry_captured' }>,
): CaptureOriginSession {
  const voice = event.audio_uri !== null ? 1 : 0;
  const transcripts = (event.transcript_text?.trim().length ?? 0) > 0 ? 1 : 0;
  return {
    session_id: event.entry_id,
    captured_at: event.at,
    detail_href: `/field-detail?entry_id=${encodeURIComponent(event.entry_id)}`,
    voice_clips: voice,
    photos: event.photo_uris.length,
    transcripts,
  };
}

export function resolveProposalCaptureOrigin(
  events: readonly PersistenceEvent[],
  correlationId: string,
): ProposalCaptureOrigin {
  const relevant = events.filter(
    (e) =>
      e.correlation_id === correlationId &&
      (e.type === 'capture.recorded' || e.type === 'daily_log.entry_captured'),
  );
  if (relevant.length === 0) {
    return EMPTY_CAPTURE_ORIGIN;
  }
  const sessions: CaptureOriginSession[] = [];
  for (const event of relevant) {
    if (event.type === 'capture.recorded') {
      sessions.push(sessionFromCapture(event));
    } else if (event.type === 'daily_log.entry_captured') {
      sessions.push(sessionFromDailyLog(event));
    }
  }
  sessions.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const earliest_at = sessions[0]?.captured_at ?? null;
  let voice_clip_count = 0;
  let photo_count = 0;
  let transcript_count = 0;
  for (const s of sessions) {
    voice_clip_count += s.voice_clips;
    photo_count += s.photos;
    transcript_count += s.transcripts;
  }
  return {
    sessions,
    earliest_at,
    voice_clip_count,
    photo_count,
    transcript_count,
  };
}
