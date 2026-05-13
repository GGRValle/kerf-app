/// <reference lib="DOM" />
/**
 * V1.5 voice Record button — F-33 field capture surface.
 *
 * Wires the in-page button (data-kerf-v15-voice-record) to MediaRecorder
 * and the server-side POST /transcribe endpoint added in
 * `scripts/serve-v15-vertical-slice.mjs`. Carve-out work for the
 * "voice in → usable estimate by Jul 13" kill-switch criterion
 * (Architecture v3.5 §28.3); slice-window discipline allows this because
 * the dogfood evidence the slice is supposed to produce was gated on a
 * real capture path. See PR body for the carve-out rationale.
 *
 * Scope:
 *   - Browser-only module (uses `MediaRecorder`, `navigator.mediaDevices.getUserMedia`)
 *   - No new product dependencies (browser built-ins only)
 *   - Idle → Requesting → Recording → Stopping → Uploading → Done | Error
 *   - On Done: invokes the caller's `onTranscript` callback with the
 *     transcribed text; the app boot writes that text into the field-capture
 *     state's `textNote` so F-34 picks it up through the existing handoff.
 *   - Surfaces upstream Groq error bodies so the operator can diagnose
 *     stale keys, wrong base URL, mic permission denials.
 *
 * What this DOESN'T do (deliberate, post-slice follow-ups):
 *   - No transcript_original / transcript_edits / transcript_current
 *     three-part schema yet on the live capture path (F-33 today routes
 *     voice into the existing text_note channel). Per-canon trail will
 *     come with the §11.3 schema work.
 *   - No waveform / level meter / countdown timer
 *   - No iOS-Safari-specific permission flow tweaks (works on macOS
 *     Safari + Chrome + Firefox today)
 *   - No re-record-and-append flow; each Record press creates a new clip
 *     and the latest transcript replaces the in-card preview (text-note
 *     append happens on Done so prior text isn't clobbered)
 */

export interface V15RecordButtonOptions {
  readonly onTranscript: (transcript: string, meta: V15TranscribeMeta) => void;
}

export interface V15TranscribeMeta {
  readonly invocationId: string;
  readonly sourceRefUri: string;
  readonly durationMs: number;
  readonly latencyMs: number;
  readonly language: string | null;
  readonly costNanoUsd: number;
}

type RecordState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  | { kind: 'recording'; recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number }
  | { kind: 'stopping' }
  | { kind: 'uploading'; uploadedBytes: number }
  | { kind: 'done'; transcript: string; meta: V15TranscribeMeta }
  | { kind: 'error'; message: string };

const BUTTON_ID = 'kerf-v15-voice-record';
const STATUS_ID = 'kerf-v15-voice-status';
const TRANSCRIPT_ID = 'kerf-v15-voice-transcript';
const ERROR_ID = 'kerf-v15-voice-error';

interface ElementBundle {
  readonly button: HTMLButtonElement;
  readonly status: HTMLElement | null;
  readonly transcript: HTMLElement | null;
  readonly error: HTMLElement | null;
}

function findElements(): ElementBundle | null {
  const button = document.getElementById(BUTTON_ID);
  if (!(button instanceof HTMLButtonElement)) {
    return null;
  }
  return {
    button,
    status: document.getElementById(STATUS_ID),
    transcript: document.getElementById(TRANSCRIPT_ID),
    error: document.getElementById(ERROR_ID),
  };
}

function renderState(els: ElementBundle, state: RecordState): void {
  // Default: reset error display unless we're in error state.
  if (els.error !== null) {
    els.error.textContent = state.kind === 'error' ? state.message : '';
    els.error.style.display = state.kind === 'error' ? 'block' : 'none';
  }

  // Default: transcript visible only after done; otherwise clear.
  if (els.transcript !== null) {
    if (state.kind === 'done') {
      els.transcript.textContent = state.transcript || '(empty transcript)';
      els.transcript.style.display = 'block';
    } else if (state.kind === 'recording' || state.kind === 'uploading' || state.kind === 'stopping') {
      // Keep previous transcript visible while a new recording is in flight
      // — don't clear until the new one lands.
    } else {
      els.transcript.textContent = '';
      els.transcript.style.display = 'none';
    }
  }

  const btn = els.button;
  btn.disabled = false;
  // Use data-state to drive CSS pulse for the recording dot.
  btn.dataset['state'] = state.kind;

  switch (state.kind) {
    case 'idle':
      btn.textContent = 'Record voice note';
      btn.setAttribute('aria-pressed', 'false');
      setStatus(els, '');
      break;
    case 'requesting_permission':
      btn.textContent = 'Allow microphone…';
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'false');
      setStatus(els, 'Waiting on microphone permission.');
      break;
    case 'recording': {
      btn.textContent = 'Stop & transcribe';
      btn.setAttribute('aria-pressed', 'true');
      setStatus(els, 'Recording. Speak now.');
      break;
    }
    case 'stopping':
      btn.textContent = 'Stopping…';
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'false');
      setStatus(els, 'Finalising recording.');
      break;
    case 'uploading':
      btn.textContent = 'Transcribing…';
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'false');
      setStatus(els, `Sending audio to Whisper (${state.uploadedBytes.toLocaleString()} bytes).`);
      break;
    case 'done':
      btn.textContent = 'Record again';
      btn.setAttribute('aria-pressed', 'false');
      setStatus(
        els,
        `Transcribed · ${state.meta.durationMs} ms audio · ${state.meta.latencyMs} ms round-trip${
          state.meta.language ? ` · lang: ${state.meta.language}` : ''
        }`,
      );
      break;
    case 'error':
      btn.textContent = 'Record voice note';
      btn.setAttribute('aria-pressed', 'false');
      setStatus(els, 'Recording failed — see error below.');
      break;
  }
}

function setStatus(els: ElementBundle, text: string): void {
  if (els.status !== null) {
    els.status.textContent = text;
  }
}

function pickMimeType(): string | undefined {
  // Prefer formats Whisper handles cleanly. MediaRecorder.isTypeSupported
  // varies across browsers; fall through and let MediaRecorder pick a default
  // if none of these match.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return undefined;
}

async function startRecording(setState: (s: RecordState) => void): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setState({
      kind: 'error',
      message:
        'This browser does not expose navigator.mediaDevices.getUserMedia. Use a recent Chrome, Safari, or Firefox on https or localhost.',
    });
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    setState({ kind: 'error', message: 'MediaRecorder is not available in this browser.' });
    return;
  }

  setState({ kind: 'requesting_permission' });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setState({
      kind: 'error',
      message: `Microphone permission denied or unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType !== undefined ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    setState({
      kind: 'error',
      message: `Could not start MediaRecorder: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  });
  recorder.start();

  setState({ kind: 'recording', recorder, stream, chunks, startedAt: Date.now() });
}

async function stopAndTranscribe(
  state: RecordState,
  setState: (s: RecordState) => void,
  onTranscript: V15RecordButtonOptions['onTranscript'],
): Promise<void> {
  if (state.kind !== 'recording') {
    return;
  }
  const { recorder, stream, chunks } = state;
  setState({ kind: 'stopping' });

  // Wait for the final `stop` event so all chunks are flushed.
  await new Promise<void>((resolve) => {
    const onStop = (): void => {
      recorder.removeEventListener('stop', onStop);
      resolve();
    };
    recorder.addEventListener('stop', onStop);
    recorder.stop();
  });
  // Release the mic track immediately so the OS indicator turns off.
  stream.getTracks().forEach((t) => t.stop());

  if (chunks.length === 0) {
    setState({ kind: 'error', message: 'No audio captured. Try again and speak after the button shows "Recording."' });
    return;
  }
  const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
  const blob = new Blob(chunks, { type: mimeType });

  setState({ kind: 'uploading', uploadedBytes: blob.size });

  let resp: Response;
  try {
    resp = await fetch('/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
  } catch (err) {
    setState({
      kind: 'error',
      message: `Upload failed (network error): ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    setState({
      kind: 'error',
      message: `Server returned non-JSON (status ${resp.status}): ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (!resp.ok) {
    const reason = typeof parsed['reason'] === 'string' ? parsed['reason'] : JSON.stringify(parsed);
    const errCode = typeof parsed['error'] === 'string' ? parsed['error'] : `status_${resp.status}`;
    setState({ kind: 'error', message: `${errCode}: ${reason}` });
    return;
  }

  const transcript = typeof parsed['transcript'] === 'string' ? parsed['transcript'] : '';
  const meta: V15TranscribeMeta = {
    invocationId: stringOr(parsed['invocationId'], ''),
    sourceRefUri: stringOr(parsed['sourceRefUri'], ''),
    durationMs: numberOr(parsed['durationMs'], 0),
    latencyMs: numberOr(parsed['latencyMs'], 0),
    language: parsed['language'] === null || typeof parsed['language'] === 'string' ? (parsed['language'] as string | null) : null,
    costNanoUsd: numberOr(parsed['costNanoUsd'], 0),
  };
  setState({ kind: 'done', transcript, meta });
  onTranscript(transcript, meta);
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Wire up the V1.5 voice Record button. Idempotent — safe to call after
 * every re-render. If the DOM doesn't currently expose the button (e.g.
 * the voice mode is off), this is a no-op.
 */
export function initV15RecordButton(opts: V15RecordButtonOptions): void {
  const els = findElements();
  if (els === null) {
    return;
  }
  // Guard against double-wiring across re-renders. innerHTML re-render
  // replaces the button element so old listeners are dropped, but we mark
  // anyway in case some future caller calls init() twice on the same node.
  if (els.button.dataset['kerfV15VoiceWired'] === 'true') {
    return;
  }
  els.button.dataset['kerfV15VoiceWired'] = 'true';

  let state: RecordState = { kind: 'idle' };
  const setState = (next: RecordState): void => {
    state = next;
    const fresh = findElements();
    if (fresh !== null) {
      renderState(fresh, next);
    }
  };
  renderState(els, state);

  els.button.addEventListener('click', () => {
    if (state.kind === 'idle' || state.kind === 'done' || state.kind === 'error') {
      void startRecording(setState);
      return;
    }
    if (state.kind === 'recording') {
      void stopAndTranscribe(state, setState, opts.onTranscript);
      return;
    }
    // requesting_permission / stopping / uploading — ignore extra clicks.
  });
}
