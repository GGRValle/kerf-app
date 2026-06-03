/**
 * Capture → work-artifact → draft chain helpers (Lane 8 seam · Lane 1 platform).
 * Permissive front (intake) · parse middle (validator wall) · strict exit.
 */
import type { SourceRef } from '../blackboard/types.js';
import type { CaptureRecordedEvent } from '../persistence/events.js';

export interface PermissiveCaptureInput {
  readonly tenant_id: string;
  readonly transcript_text: string;
  readonly capture_id?: string;
  readonly audio_uri?: string | null;
  readonly duration_ms?: number;
  readonly language?: string | null;
  readonly source_refs?: readonly SourceRef[];
}

export function parsePermissiveCaptureInput(
  body: Record<string, unknown>,
): { ok: true; value: PermissiveCaptureInput } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  const tenant = body['tenant_id'];
  if (typeof tenant !== 'string' || tenant.length === 0) {
    errors.push('tenant_id required');
  }
  const transcript = body['transcript_text'];
  if (typeof transcript !== 'string') {
    errors.push('transcript_text must be a string');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      tenant_id: tenant as string,
      transcript_text: transcript as string,
      capture_id: typeof body['capture_id'] === 'string' ? body['capture_id'] : undefined,
      audio_uri:
        typeof body['audio_uri'] === 'string'
          ? body['audio_uri']
          : body['audio_uri'] === null
            ? null
            : undefined,
      duration_ms: typeof body['duration_ms'] === 'number' ? body['duration_ms'] : undefined,
      language: typeof body['language'] === 'string' ? body['language'] : undefined,
      source_refs: Array.isArray(body['source_refs'])
        ? (body['source_refs'] as SourceRef[])
        : undefined,
    },
  };
}

export interface ParsedClaim {
  readonly text: string;
  readonly source_ref: SourceRef;
  readonly gap_flag?: boolean;
}

export function strictExitValidateClaims(
  claims: readonly ParsedClaim[],
): { ok: true } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i]!;
    if (!c.source_ref || typeof c.source_ref.kind !== 'string') {
      errors.push(`claim[${i}]: source_ref required`);
    }
    if (c.gap_flag === true && c.text.trim().length > 0 && !c.text.includes('[gap]')) {
      errors.push(`claim[${i}]: gap_flag set but claim reads as asserted fact`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function defaultSourceRefForCapture(event: CaptureRecordedEvent): SourceRef {
  if (event.source_refs.length > 0) {
    return event.source_refs[0]!;
  }
  return {
    kind: event.audio_uri ? 'voice' : 'transcript',
    uri: event.audio_uri ?? `kerf://capture/${event.capture_id}`,
    excerpt: event.transcript_text.slice(0, 240),
  };
}

export function sourceRefUri(ref: SourceRef): string {
  return ref.uri?.trim() || ref.kind;
}
