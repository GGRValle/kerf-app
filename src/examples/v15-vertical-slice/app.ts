/// <reference lib="DOM" />
import {
  FIELD_CAPTURE_HANDOFF_STORAGE_KEY,
  type CaptureModeId,
  type PhotoTag,
} from '../field-capture-mock.js';
import {
  f34ResetDemoState,
  getF34ClarificationAnswers,
  setF34ClarificationAnswer,
} from './f34-transcript-review-state.js';
import { matchRoute } from './router.js';
import { renderShell } from './shell.js';
import { buildV15FieldCaptureHandoff } from './v15-field-capture-html.js';
import { initV15RecordButton, type V15TranscribeMeta } from './v15-record-button.js';
import { loadV15CostKbSeed, invalidateV15CostKbSeedCache } from './v15-cost-kb-seed.js';
import {
  v15FieldCaptureGetState,
  v15FieldCaptureReplaceState,
  type V15FieldCaptureState,
} from './v15-field-capture-state.js';
import {
  v15PersistContextDryRunFromHandoff,
  v15RefreshContextDryRunFromSession,
} from './v15-context-dry-run-session.js';
import { v15F37SetSelectedEventId } from './v15-f37-selection.js';
import {
  cancelScaffoldEditInput,
  commitScaffoldEditInput,
  mountScaffoldEditInput,
} from './v15-scaffold-edit-interaction.js';
import { scheduleMobileDomProbeReport } from './m-dom-probe.js';
import { initKbIngestionDetailPage, initKbIngestionListPage } from './v15-kb-ingestion-client.js';
import { initRelayDetailPage, initRelayListPage } from './v15-relay-client.js';
import { initFieldDailyCapturePage } from './v15-field-daily-client.js';

const ROOT_ID = 'kerf-v15-root';

function getRoot(): HTMLElement {
  const el = document.getElementById(ROOT_ID);
  if (el === null) {
    throw new Error(`#${ROOT_ID} missing`);
  }
  return el;
}

function readPath(): string {
  const raw = window.location.pathname.replace(/\/+$/, '') || '/';
  if (raw === '/' || raw === '') {
    return '/dashboard';
  }
  return raw;
}

function normalizeBootUrl(): void {
  const raw = window.location.pathname.replace(/\/+$/, '') || '/';
  if (raw === '/' || raw === '') {
    history.replaceState({}, '', '/dashboard');
  }
}

function render(): void {
  const path = readPath();
  const root = getRoot();
  root.innerHTML = renderShell(path);
  syncNavToggle(false);
  wireFieldCaptureAfterRender(path);
  scheduleMobileDomProbeReport(window, path);
  const route = matchRoute(path);
  if (route.name === 'kb-ingestion') {
    initKbIngestionListPage();
  } else if (route.name === 'kb-ingestion-detail') {
    initKbIngestionDetailPage(route.ingestionId);
  } else if (route.name === 'relay-list') {
    initRelayListPage();
  } else if (route.name === 'relay-detail') {
    initRelayDetailPage(route.entryId);
  } else if (route.name === 'field-daily') {
    initFieldDailyCapturePage();
  }
}

function syncNavToggle(open: boolean): void {
  const shell = document.querySelector('.kerf-v15-shell');
  const toggle = document.querySelector('[data-kerf-v15-nav-toggle]');
  const nav = document.getElementById('kerf-v15-nav');
  if (!(shell instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) || nav === null) {
    return;
  }
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  shell.classList.toggle('kerf-v15-shell--nav-open', open);
}

function navigateTo(url: string): void {
  if (!url.startsWith('/')) {
    return;
  }
  if (url === readPath()) {
    return;
  }
  history.pushState({}, '', url);
  render();
}

function persistFieldCaptureHandoff(state: V15FieldCaptureState): void {
  const handoff = buildV15FieldCaptureHandoff(state);
  try {
    sessionStorage.setItem(FIELD_CAPTURE_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    /* ignore */
  }
  f34ResetDemoState();
  v15PersistContextDryRunFromHandoff(handoff);
}

function toggleFcMode(id: CaptureModeId): void {
  const s = v15FieldCaptureGetState();
  const modes = new Set(s.modes);
  if (modes.has(id)) {
    modes.delete(id);
  } else {
    modes.add(id);
  }
  if (modes.size === 0) {
    modes.add('text_note');
  }
  const next = { ...s, modes };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  render();
}

function togglePhotoTag(photoId: string, tag: PhotoTag): void {
  const s = v15FieldCaptureGetState();
  const photos = s.photos.map((p) => {
    if (p.id !== photoId) {
      return p;
    }
    const tags = [...p.tags];
    const i = tags.indexOf(tag);
    if (i >= 0) {
      tags.splice(i, 1);
    } else {
      tags.push(tag);
    }
    return { ...p, tags };
  });
  const next = { ...s, photos };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  render();
}

function addMockPhoto(): void {
  const s = v15FieldCaptureGetState();
  const next = {
    ...s,
    photos: [...s.photos, { id: `ph_new_${Date.now()}`, label: 'New photo (mock)', tags: ['room' as PhotoTag] }],
  };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  render();
}

function patchFcTextNote(text: string): void {
  const s = v15FieldCaptureGetState();
  const next: V15FieldCaptureState = { ...s, textNote: text };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  const dd = document.querySelector('.kerf-fc-preview-note');
  if (dd !== null) {
    dd.textContent = previewRawNote(next);
  }
}

function patchFcManualTranscript(text: string): void {
  const s = v15FieldCaptureGetState();
  const next: V15FieldCaptureState = { ...s, manualTranscript: text };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  const dd = document.querySelector('.kerf-fc-preview-note');
  if (dd !== null) {
    dd.textContent = previewRawNote(next);
  }
}

function previewRawNote(state: V15FieldCaptureState): string {
  const parts: string[] = [];
  if (state.textNote.trim()) {
    parts.push(state.textNote.trim());
  }
  if (state.manualTranscript.trim()) {
    parts.push(`[Pasted transcript]\n${state.manualTranscript.trim()}`);
  }
  if (parts.length === 0) {
    return '— (no text yet — add a note or paste a transcript)';
  }
  return parts.join('\n\n');
}

function wireFieldCaptureAfterRender(path: string): void {
  const route = matchRoute(path);
  if (route.name !== 'field-capture') {
    return;
  }

  const sel = document.getElementById('kerf-v15-fc-project-select');
  if (sel instanceof HTMLSelectElement) {
    sel.addEventListener('change', () => {
      const s = v15FieldCaptureGetState();
      const next = { ...s, projectId: sel.value };
      v15FieldCaptureReplaceState(next);
      persistFieldCaptureHandoff(next);
      render();
    });
  }

  const ta = document.getElementById('kerf-v15-fc-text-note');
  if (ta instanceof HTMLTextAreaElement) {
    ta.addEventListener('input', () => {
      patchFcTextNote(ta.value);
    });
  }

  const mt = document.getElementById('kerf-v15-fc-manual-transcript');
  if (mt instanceof HTMLTextAreaElement) {
    mt.addEventListener('input', () => {
      patchFcManualTranscript(mt.value);
    });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-kerf-v15-fc-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-kerf-v15-fc-mode') as CaptureModeId | null;
      if (id) {
        toggleFcMode(id);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-kerf-v15-fc-photo][data-kerf-v15-fc-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-kerf-v15-fc-photo');
      const tag = btn.getAttribute('data-kerf-v15-fc-tag') as PhotoTag | null;
      if (pid && tag) {
        togglePhotoTag(pid, tag);
      }
    });
  });

  document.getElementById('kerf-v15-fc-add-photo')?.addEventListener('click', addMockPhoto);

  // Voice Record button — appends Whisper transcript to the text-note field so
  // the existing F-33 → F-34 handoff path picks it up (carve-out: kill-switch
  // voice-in dogfood, 2026-05-13).
  initV15RecordButton({
    onTranscript: (transcript: string, _meta: V15TranscribeMeta): void => {
      appendVoiceTranscriptToTextNote(transcript);
    },
  });
}

function appendVoiceTranscriptToTextNote(transcript: string): void {
  const text = transcript.trim();
  if (text.length === 0) {
    return;
  }
  const s = v15FieldCaptureGetState();
  // If text-note mode is off, turn it on so the operator sees the transcript
  // landing somewhere visible. We don't re-render the whole page (that would
  // wipe the voice card's "done" state with the transcript still visible);
  // instead we patch the textarea value in place.
  const modes = new Set(s.modes);
  modes.add('text_note');
  const existing = s.textNote.trim();
  const joined = existing.length === 0 ? text : `${existing}\n\n${text}`;
  const next: V15FieldCaptureState = { ...s, modes, textNote: joined };
  v15FieldCaptureReplaceState(next);
  persistFieldCaptureHandoff(next);
  // Targeted DOM updates (mirrors patchFcTextNote's no-render pattern):
  //   - textarea value gets the new text (operator can still edit afterward)
  //   - the preview-note DD refreshes to show what F-34 will receive
  // If the textarea isn't present (text_note mode was off), a full render
  // is needed to materialize it. In that case render() also re-inits the
  // record button as idle — the operator's transcript is preserved in the
  // textarea so the data isn't lost.
  const ta = document.getElementById('kerf-v15-fc-text-note');
  if (ta instanceof HTMLTextAreaElement) {
    ta.value = joined;
    const dd = document.querySelector('.kerf-fc-preview-note');
    if (dd !== null) {
      dd.textContent = previewRawNote(next);
    }
  } else {
    render();
  }
}

function onDocumentClick(ev: MouseEvent): void {
  const t = ev.target;
  if (!(t instanceof Element)) {
    return;
  }
  const navToggle = t.closest('[data-kerf-v15-nav-toggle]');
  if (navToggle instanceof HTMLButtonElement) {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    syncNavToggle(open);
    return;
  }
  const resetBtn = t.closest('[data-kerf-f34-reset="true"]');
  if (resetBtn instanceof HTMLButtonElement) {
    ev.preventDefault();
    f34ResetDemoState();
    v15RefreshContextDryRunFromSession({});
    render();
    return;
  }
  const applyBtn = t.closest('[data-kerf-f34-apply="true"]');
  if (applyBtn instanceof HTMLButtonElement) {
    ev.preventDefault();
    v15RefreshContextDryRunFromSession(getF34ClarificationAnswers());
    render();
    return;
  }
  const f37Btn = t.closest('[data-f37-event]');
  if (f37Btn instanceof HTMLButtonElement) {
    ev.preventDefault();
    const id = f37Btn.getAttribute('data-f37-event');
    if (id !== null && id.length > 0) {
      v15F37SetSelectedEventId(id);
      render();
    }
    return;
  }
  const fcSubmit = t.closest('#kerf-v15-fc-submit');
  if (fcSubmit instanceof HTMLButtonElement) {
    ev.preventDefault();
    persistFieldCaptureHandoff(v15FieldCaptureGetState());
    navigateTo('/transcript-review');
    return;
  }
  const editBtn = t.closest('[data-kerf-v15-edit]');
  if (editBtn instanceof HTMLButtonElement) {
    ev.preventDefault();
    mountScaffoldEditInput(editBtn);
    return;
  }
  const link = t.closest('a[data-kerf-v15-nav="true"]');
  if (!(link instanceof HTMLAnchorElement)) {
    return;
  }
  const href = link.getAttribute('href');
  if (href === null || href.startsWith('http') || href.startsWith('mailto:')) {
    return;
  }
  ev.preventDefault();
  if (href.startsWith('#/')) {
    navigateTo(href.slice(1));
    return;
  }
  if (!href.startsWith('/')) {
    return;
  }
  navigateTo(href);
}

function onPopState(): void {
  render();
}

function onDocumentInput(ev: Event): void {
  const t = ev.target;
  if (t instanceof HTMLInputElement && t.hasAttribute('data-kerf-v15-editing')) {
    return;
  }
  if (!(t instanceof HTMLTextAreaElement)) {
    return;
  }
  const clarificationId = t.getAttribute('data-kerf-f34-answer');
  if (clarificationId !== null && clarificationId.length > 0) {
    setF34ClarificationAnswer(clarificationId, t.value);
  }
}

function finishScaffoldEdit(input: HTMLInputElement): void {
  if (input.dataset.kerfV15CommitDone === 'true') {
    return;
  }
  input.dataset.kerfV15CommitDone = 'true';
  if (commitScaffoldEditInput(input)) {
    render();
  } else {
    cancelScaffoldEditInput(input);
    render();
  }
}

function onDocumentKeydown(ev: KeyboardEvent): void {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-kerf-v15-editing')) {
    return;
  }
  if (ev.key === 'Escape') {
    ev.preventDefault();
    t.dataset.kerfV15CommitDone = 'true';
    cancelScaffoldEditInput(t);
    render();
    return;
  }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    finishScaffoldEdit(t);
  }
}

function onScaffoldEditBlur(ev: FocusEvent): void {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-kerf-v15-editing')) {
    return;
  }
  finishScaffoldEdit(t);
}

function boot(): void {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('input', onDocumentInput);
  document.addEventListener('keydown', onDocumentKeydown);
  document.addEventListener('focusout', onScaffoldEditBlur);
  window.addEventListener('popstate', onPopState);
  normalizeBootUrl();
  if (typeof window !== 'undefined') {
    (window as unknown as { kerfReloadCostKbSeed?: () => Promise<void> }).kerfReloadCostKbSeed =
      async (): Promise<void> => {
        invalidateV15CostKbSeedCache();
        await loadV15CostKbSeed(globalThis.fetch, { mergeTier2TenantId: 'tenant_ggr' });
        render();
      };
  }
  // Render immediately so the shell paints, then load the cost-KB seed
  // and re-render so any open F-34 clarifications can consult tier 1
  // (operator-facing prompt augmented with range, debug overlay shown).
  // Seed load is best-effort — render() works fine even if the seed never
  // arrives; F-34 just falls back to ungrounded voice in that case.
  render();
  void loadV15CostKbSeed(globalThis.fetch, { mergeTier2TenantId: 'tenant_ggr' }).then((manifest) => {
    if (manifest !== null) {
      render();
    }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
