/**
 * Capture sync-state grammar — Mobile Field Truth Sprint.
 * Locks the canonical states + field-plain labels + canon tones, and enforces
 * the TRUTH CONTRACT: every state carries a precondition, and only "captured"
 * is truthful today (no sync engine exists — sessionStorage only). This is the
 * shared foundation Cursors A/B/C and the integration lane converge on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_SYNC,
  CAPTURE_SYNC_ORDER,
  isLiveToday,
  captureSyncLabel,
  captureSyncTone,
  type CaptureSyncState,
} from '../src/app/lib/captureSyncState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const badge = readFileSync(path.join(ROOT, 'src/app/components/CaptureSyncBadge.astro'), 'utf8');
const grammar = readFileSync(path.join(ROOT, 'src/app/lib/captureSyncState.ts'), 'utf8');

test('grammar: six canonical states with field-plain labels (founder wording)', () => {
  assert.deepEqual(CAPTURE_SYNC_ORDER, [
    'captured', 'saved_on_phone', 'syncing', 'synced', 'needs_attention', 'failed',
  ]);
  assert.equal(captureSyncLabel('captured'), 'Captured');
  assert.equal(captureSyncLabel('saved_on_phone'), 'Saved on phone');
  assert.equal(captureSyncLabel('syncing'), 'Syncing…');
  assert.equal(captureSyncLabel('synced'), 'Synced');
  assert.equal(captureSyncLabel('needs_attention'), 'Needs attention');
  assert.equal(captureSyncLabel('failed'), 'Failed');
});

test('grammar: canon tone ladder — neutral baseline → blue in-flight → green done; amber/red branches', () => {
  assert.equal(captureSyncTone('captured'), 'neutral');
  assert.equal(captureSyncTone('saved_on_phone'), 'neutral');
  assert.equal(captureSyncTone('syncing'), 'blue');
  assert.equal(captureSyncTone('synced'), 'green');
  assert.equal(captureSyncTone('needs_attention'), 'amber');
  assert.equal(captureSyncTone('failed'), 'red');
});

test('TRUTH CONTRACT: every state documents a precondition; only "captured" is truthful today', () => {
  for (const s of CAPTURE_SYNC_ORDER) {
    assert.ok(CAPTURE_SYNC[s].truth.length > 20, `${s} must document its truth precondition`);
  }
  // No sync engine yet → only "captured" may be shown truthfully today.
  assert.equal(isLiveToday('captured'), true);
  for (const s of ['saved_on_phone', 'syncing', 'synced', 'failed'] satisfies CaptureSyncState[]) {
    assert.equal(isLiveToday(s), false, `${s} must NOT go live until the sync engine ships`);
  }
  // The module names the contract + the durability-lie risk it prevents.
  assert.match(grammar, /TRUTH CONTRACT/);
  assert.match(grammar, /durability lie/);
});

test('badge: canon kg-chip presentation, spinner on syncing, "· Retry" on failed only', () => {
  assert.match(badge, /class:list=\{\['kg-chip', 'cap-sync'/);
  assert.match(badge, /CAPTURE_SYNC\[state\]/);
  assert.match(badge, /state === 'syncing'/);
  assert.match(badge, /cap-sync__spin/);
  assert.match(badge, /state === 'failed' && retryHref/);
  assert.match(badge, /Retry<\/a>/);
  // presentation-only: it renders the given state; truth is the caller's job
  assert.match(badge, /[Pp]resentation ONLY/);
});
