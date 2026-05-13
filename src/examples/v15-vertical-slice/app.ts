/// <reference lib="DOM" />
import {
  FIELD_CAPTURE_HANDOFF_STORAGE_KEY,
  type CaptureModeId,
  type PhotoTag,
} from '../field-capture-mock.js';
import { f34ResetDemoState, f34ToggleMissingResolved } from './f34-transcript-review-state.js';
import { matchRoute } from './router.js';
import { renderShell } from './shell.js';
import { buildV15FieldCaptureHandoff } from './v15-field-capture-html.js';
import {
  v15FieldCaptureGetState,
  v15FieldCaptureReplaceState,
  type V15FieldCaptureState,
} from './v15-field-capture-state.js';
import { v15PersistContextDryRunFromHandoff } from './v15-context-dry-run-session.js';
import { v15F37SetSelectedEventId } from './v15-f37-selection.js';

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
    render();
    return;
  }
  const resolveBtn = t.closest('[data-kerf-f34-resolve]');
  if (resolveBtn instanceof HTMLButtonElement) {
    ev.preventDefault();
    const id = resolveBtn.getAttribute('data-kerf-f34-resolve');
    if (id !== null && id.length > 0) {
      f34ToggleMissingResolved(id);
      render();
    }
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

function boot(): void {
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('popstate', onPopState);
  normalizeBootUrl();
  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
