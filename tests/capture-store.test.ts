/**
 * Durable capture store — Mobile Field Truth integration lane.
 * Locks the store contract that makes #414's "Saved on phone" state true:
 * IndexedDB-backed sessions, blob read-after-write, server-principal snapshot
 * as cache only, and camera binding/recovery. This test intentionally avoids a
 * fake IndexedDB package; source guards protect the browser contract while pure
 * rollup logic is exercised directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_DB_NAME,
  CAPTURE_DB_VERSION,
  captureSessionBelongsToPrincipal,
  rollupCaptureSessionStatus,
  type CaptureItem,
  type CapturePrincipalSnapshot,
  type CaptureSession,
} from '../src/app/lib/captureStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = readFileSync(path.join(ROOT, 'src/app/lib/captureStore.ts'), 'utf8');
const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');

function item(status: CaptureItem['status']): CaptureItem {
  return {
    id: `item_${status}`,
    session_id: 'session_1',
    tenant_id: 'tenant_ggr',
    user_id: 'owner',
    kind: 'photo',
    blob: new Blob(['x'], { type: 'text/plain' }),
    name: `${status}.txt`,
    created_at: 1,
    updated_at: 1,
    status,
  };
}

test('store contract names the canonical IndexedDB database and object stores', () => {
  assert.equal(CAPTURE_DB_NAME, 'kerf-capture');
  assert.equal(CAPTURE_DB_VERSION, 1);
  assert.match(store, /createObjectStore\(CAPTURE_SESSION_STORE, \{ keyPath: 'id' \}\)/);
  assert.match(store, /createObjectStore\(CAPTURE_ITEM_STORE, \{ keyPath: 'id' \}\)/);
  assert.match(store, /items\.createIndex\('session_id', 'session_id'/);
});

test('saved_on_phone is gated by put plus read-after-write blob proof', () => {
  const addItem = store.match(/export async function addItem[\s\S]*?export async function listSessions/);
  assert.ok(addItem, 'addItem implementation should be present');
  assert.match(addItem[0], /status: 'captured'/, 'item starts as captured, not optimistically saved');
  assert.match(addItem[0], /const confirmed = await getItem\(capturedItem\.id\)/);
  assert.match(addItem[0], /confirmed\.blob instanceof Blob/);
  assert.match(addItem[0], /confirmed\.blob\.size !== input\.blob\.size/);
  assert.match(addItem[0], /status: 'saved_on_phone'/);
});

test('server-principal snapshot is cache-only; upload authority is not client asserted', () => {
  assert.match(store, /Client-side cache only\. The server principal remains authoritative/);
  assert.match(store, /server_principal_snapshot/);
  assert.doesNotMatch(store, /tenant_id.*localStorage|localStorage.*tenant_id/);
});

test('pending recovery is principal-scoped: principal B cannot see principal A local sessions', () => {
  const principalA: CapturePrincipalSnapshot = {
    tenant_id: 'tenant_ggr',
    user_id: 'owner',
    source: 'server_principal_snapshot',
  };
  const principalB: CapturePrincipalSnapshot = {
    tenant_id: 'tenant_valle',
    user_id: 'owner',
    source: 'server_principal_snapshot',
  };
  const sessionA: CaptureSession = {
    id: 'cap_session_a',
    tenant_id: principalA.tenant_id,
    user_id: principalA.user_id,
    created_at: 1,
    updated_at: 1,
    route_intent: 'lead',
    destination: null,
    status: 'saved_on_phone',
    item_ids: ['cap_item_a'],
  };
  assert.equal(captureSessionBelongsToPrincipal(sessionA, principalA), true);
  assert.equal(captureSessionBelongsToPrincipal(sessionA, principalB), false);
  assert.match(store, /export async function listPending\(principal: CapturePrincipalSnapshot\)/);
  assert.match(store, /listSessions\(\{ tenant_id: principal\.tenant_id, user_id: principal\.user_id \}\)/);
  assert.match(camera, /listPending\(capturePrincipalSnapshot\(\)\)/);
  assert.doesNotMatch(camera, /listPending\(\)/);
});

test('session rollup is conservative: any unsaved item keeps the session captured', () => {
  assert.equal(rollupCaptureSessionStatus([]), 'captured');
  assert.equal(rollupCaptureSessionStatus([item('saved_on_phone')]), 'saved_on_phone');
  assert.equal(rollupCaptureSessionStatus([item('saved_on_phone'), item('captured')]), 'captured');
  assert.equal(rollupCaptureSessionStatus([item('syncing'), item('saved_on_phone')]), 'syncing');
  assert.equal(rollupCaptureSessionStatus([item('needs_attention'), item('saved_on_phone')]), 'needs_attention');
  assert.equal(rollupCaptureSessionStatus([item('failed'), item('saved_on_phone')]), 'failed');
  assert.equal(rollupCaptureSessionStatus([item('synced'), item('synced')]), 'synced');
});

test('camera binds to durable store, renders sync proof, and recovers pending sessions', () => {
  assert.match(camera, /import \{[\s\S]*addItem[\s\S]*createSession[\s\S]*listPending[\s\S]*setDestination[\s\S]*\} from '\.\.\/lib\/captureStore\.js'/);
  assert.match(camera, /import \{ installCaptureUploadQueue, processCaptureUploadQueue \} from '\.\.\/lib\/captureUploadQueue\.js'/);
  assert.match(camera, /<CaptureSyncBadge state="captured" \/>/);
  assert.match(camera, /data-tenant-id=\{context\.tenantId\}/);
  assert.match(camera, /data-principal-user-id=\{context\.roleRoot\}/);
  assert.match(camera, /principalSnapshotFromSurfaceContext/);
  assert.match(camera, /setCaptureSyncState\('saved_on_phone'\)/);
  assert.match(camera, /Saved on phone\. Choose where it goes before filing\./);
  assert.match(camera, /const hydratePendingCapture = async \(\) =>/);
  assert.match(camera, /listPending\(capturePrincipalSnapshot\(\)\)/);
  assert.match(camera, /indexeddb_recovery/);
  assert.match(camera, /installCaptureUploadQueue\(capturePrincipalSnapshot\(\)/);
  assert.match(camera, /processCaptureUploadQueue\(capturePrincipalSnapshot\(\)/);
});

test('camera lead placeholder keeps durable media safety without forcing intake', () => {
  assert.match(camera, /sessionStorage\.setItem\('kerf\.cameraCapture'/);
  assert.match(camera, /capture_store_session_id/);
  assert.match(camera, /capture_store_item_id/);
  assert.match(camera, /\/api\/v1\/sales\/deals/);
  assert.match(camera, /lead_placeholder_created/);
  assert.match(camera, /await persistSessionDestination\(\{ kind: 'lead', id: 'new' \}\)/);
  assert.doesNotMatch(camera, /\/clients\/new\?src=camera&capture_kind=/);
});
