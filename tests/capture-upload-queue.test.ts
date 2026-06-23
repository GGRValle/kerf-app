/**
 * Durable capture upload queue — server byte receipt + principal fence.
 * This is the upload half of the field-truth contract: "Synced" is legal only
 * after the server accepts the blob under the authenticated principal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { persistCaptureUpload } from '../src/api/lib/captureUploadReceiptStore.js';
import { PLATFORM_SESSION_GGR_OWNER, PLATFORM_SESSION_VALLE_PM } from './helpers/authenticatedApiRouter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queueSrc = readFileSync(path.join(ROOT, 'src/app/lib/captureUploadQueue.ts'), 'utf8');
const cameraSrc = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
const lane3Src = readFileSync(path.join(ROOT, 'src/api/routes/lane3Work.ts'), 'utf8');

async function withPersistenceDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  const prev = process.env['PERSISTENCE_DIR'];
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn(dir);
  } finally {
    resetApiDepsForTests();
    if (prev === undefined) delete process.env['PERSISTENCE_DIR'];
    else process.env['PERSISTENCE_DIR'] = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test('receipt store writes bytes, reads them back, and emits a manifest receipt', async () => {
  await withPersistenceDir('capture-receipt-store-', async (dir) => {
    const receipt = await persistCaptureUpload({
      persistenceDir: dir,
      tenantId: 'tenant_ggr',
      principalRole: 'owner',
      sessionId: 'cap_session_test',
      itemId: 'cap_item_test',
      captureKind: 'photo',
      fileName: 'wall.jpg',
      contentType: 'image/jpeg',
      destination: { kind: 'job', id: 'proj_wegrzyn_kitchen' },
      bytes: new Uint8Array([1, 2, 3, 4]),
      now: () => new Date('2026-06-22T12:00:00.000Z'),
    });
    assert.equal(receipt.tenant_id, 'tenant_ggr');
    assert.equal(receipt.bytes, 4);
    assert.equal(receipt.content_type, 'image/jpeg');
    assert.match(receipt.server_ref, /^kerf:\/\/capture-upload\/tenant_ggr\/cap_session_test\/cap_item_test$/);

    const blobPath = path.join(dir, receipt.relative_path);
    assert.equal((await stat(blobPath)).size, 4);
    const manifest = JSON.parse(
      await readFile(path.join(path.dirname(blobPath), 'receipt.json'), 'utf8'),
    ) as { tenant_id: string; sha256: string; principal_role: string };
    assert.equal(manifest.tenant_id, 'tenant_ggr');
    assert.equal(manifest.sha256, receipt.sha256);
    assert.equal(manifest.principal_role, 'owner');
  });
});

test('POST /capture-sync/items stores under the server tenant and ignores forged client tenant hints', async () => {
  await withPersistenceDir('capture-sync-route-', async (dir) => {
    const app = createApiRouter();
    const res = await app.request('/capture-sync/items', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'image/jpeg',
        'X-Capture-Session-Id': 'cap_session_phone',
        'X-Capture-Item-Id': 'cap_item_photo',
        'X-Capture-Kind': 'photo',
        'X-Capture-File-Name': 'kitchen.jpg',
        'X-Capture-Destination-Kind': 'job',
        'X-Capture-Destination-Id': 'proj_wegrzyn_kitchen',
        'X-Capture-Tenant-Id': 'tenant_valle',
      },
      body: new Uint8Array([9, 8, 7, 6]),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      client_tenant_ignored: boolean;
      receipt: { tenant_id: string; relative_path: string; server_ref: string; bytes: number };
    };
    assert.equal(body.client_tenant_ignored, true);
    assert.equal(body.receipt.tenant_id, 'tenant_ggr');
    assert.equal(body.receipt.bytes, 4);
    assert.match(body.receipt.server_ref, /tenant_ggr/);
    assert.equal(existsSync(path.join(dir, body.receipt.relative_path)), true);
    assert.equal(existsSync(path.join(dir, 'capture-uploads', 'tenant_valle')), false);
  });
});

test('POST /capture-sync/items re-resolves job destination under the authenticated tenant', async () => {
  await withPersistenceDir('capture-sync-xtenant-', async () => {
    const app = createApiRouter();
    const res = await app.request('/capture-sync/items', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_VALLE_PM,
        'Content-Type': 'image/jpeg',
        'X-Capture-Session-Id': 'cap_session_foreign',
        'X-Capture-Item-Id': 'cap_item_foreign',
        'X-Capture-Kind': 'photo',
        'X-Capture-File-Name': 'foreign.jpg',
        'X-Capture-Destination-Kind': 'job',
        'X-Capture-Destination-Id': 'proj_wegrzyn_kitchen',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'project_not_found');
  });
});

test('POST /capture-sync/items only accepts whitelisted lead and review destinations', async () => {
  await withPersistenceDir('capture-sync-whitelist-', async (dir) => {
    const app = createApiRouter();
    for (const destination of [
      { kind: 'lead', id: 'lead_valle_foreign' },
      { kind: 'review', id: 'review_valle_foreign' },
    ]) {
      const res = await app.request('/capture-sync/items', {
        method: 'POST',
        headers: {
          Authorization: PLATFORM_SESSION_GGR_OWNER,
          'Content-Type': 'image/jpeg',
          'X-Capture-Session-Id': `cap_session_${destination.kind}`,
          'X-Capture-Item-Id': `cap_item_${destination.kind}`,
          'X-Capture-Kind': 'photo',
          'X-Capture-File-Name': `${destination.kind}.jpg`,
          'X-Capture-Destination-Kind': destination.kind,
          'X-Capture-Destination-Id': destination.id,
        },
        body: new Uint8Array([1, 2, 3]),
      });
      assert.equal(res.status, 409);
      const body = await res.json() as { error: string };
      assert.equal(body.error, 'destination_invalid');
    }

    assert.equal(existsSync(path.join(dir, 'capture-uploads')), false);

    for (const destination of [
      { kind: 'lead', id: 'new' },
      { kind: 'review', id: 'office_queue' },
    ]) {
      const res = await app.request('/capture-sync/items', {
        method: 'POST',
        headers: {
          Authorization: PLATFORM_SESSION_GGR_OWNER,
          'Content-Type': 'image/jpeg',
          'X-Capture-Session-Id': `cap_session_${destination.kind}_ok`,
          'X-Capture-Item-Id': `cap_item_${destination.kind}_ok`,
          'X-Capture-Kind': 'photo',
          'X-Capture-File-Name': `${destination.kind}.jpg`,
          'X-Capture-Destination-Kind': destination.kind,
          'X-Capture-Destination-Id': destination.id,
        },
        body: new Uint8Array([4, 5, 6]),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as {
        receipt: { destination_kind: string; destination_id: string; tenant_id: string };
      };
      assert.equal(body.receipt.destination_kind, destination.kind);
      assert.equal(body.receipt.destination_id, destination.id);
      assert.equal(body.receipt.tenant_id, 'tenant_ggr');
    }
  });
});

test('POST /capture-sync/items re-resolves daily log destination under the authenticated tenant', async () => {
  await withPersistenceDir('capture-sync-daily-log-', async (dir) => {
    const app = createApiRouter();
    const rejected = await app.request('/capture-sync/items', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_VALLE_PM,
        'Content-Type': 'image/jpeg',
        'X-Capture-Session-Id': 'cap_session_daily_foreign',
        'X-Capture-Item-Id': 'cap_item_daily_foreign',
        'X-Capture-Kind': 'photo',
        'X-Capture-File-Name': 'daily.jpg',
        'X-Capture-Destination-Kind': 'daily_log',
        'X-Capture-Destination-Id': 'proj_wegrzyn_kitchen',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    assert.equal(rejected.status, 404);
    const rejectedBody = await rejected.json() as { error: string };
    assert.equal(rejectedBody.error, 'project_not_found');
    assert.equal(existsSync(path.join(dir, 'capture-uploads')), false);

    const accepted = await app.request('/capture-sync/items', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'image/jpeg',
        'X-Capture-Session-Id': 'cap_session_daily_ok',
        'X-Capture-Item-Id': 'cap_item_daily_ok',
        'X-Capture-Kind': 'photo',
        'X-Capture-File-Name': 'daily.jpg',
        'X-Capture-Destination-Kind': 'daily_log',
        'X-Capture-Destination-Id': 'proj_wegrzyn_kitchen',
      },
      body: new Uint8Array([4, 5, 6]),
    });
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json() as {
      receipt: { destination_kind: string; destination_id: string; tenant_id: string };
    };
    assert.equal(acceptedBody.receipt.destination_kind, 'daily_log');
    assert.equal(acceptedBody.receipt.destination_id, 'proj_wegrzyn_kitchen');
    assert.equal(acceptedBody.receipt.tenant_id, 'tenant_ggr');
  });
});

test('queue source only marks synced after a server receipt and never sends client tenant authority', () => {
  assert.match(queueSrc, /listPending\(principal\)/);
  assert.match(queueSrc, /markSyncing\(item\.id\)/);
  assert.match(queueSrc, /fetchFn\('\/api\/v1\/capture-sync\/items'/);
  assert.match(queueSrc, /body\.receipt\?\.server_ref/);
  assert.match(queueSrc, /markSynced\(item\.id, serverRef\)/);
  assert.match(queueSrc, /markFailed\(item\.id, `upload_failed_\$\{response\.status\}`\)/);
  assert.doesNotMatch(queueSrc, /X-Capture-Tenant-Id/);
  assert.doesNotMatch(queueSrc, /tenant_id/);
});

test('camera installs the upload queue, retries on lifecycle events, and marks unrouted Done as needs attention', () => {
  assert.match(cameraSrc, /installCaptureUploadQueue\(capturePrincipalSnapshot\(\)/);
  assert.match(cameraSrc, /processCaptureUploadQueue\(capturePrincipalSnapshot\(\)/);
  assert.match(cameraSrc, /markNeedsAttention\(activeCaptureItemId, reason\)/);
  assert.match(cameraSrc, /await markActiveCaptureNeedsAttention\('destination_required'\)/);
  assert.match(cameraSrc, /setCaptureSyncState\(item\.status\)/);
});

test('server route does not trust client tenant and validates destination before storing bytes', () => {
  assert.match(lane3Src, /const tenant = requireApiTenant\(c\)/);
  assert.match(lane3Src, /const session = requireApiSession\(c\)/);
  assert.match(lane3Src, /authorizeCaptureUploadDestination\(destinationKind, destinationId, tenant\)/);
  assert.match(lane3Src, /projectVisibleToTenant\(destinationId, tenant\)/);
  assert.match(lane3Src, /destinationKind === 'lead'[\s\S]*destinationId === 'new'/);
  assert.match(lane3Src, /destinationKind === 'review'[\s\S]*destinationId === 'office_queue'/);
  assert.match(lane3Src, /tenantId: tenant/);
  assert.match(lane3Src, /client_tenant_ignored/);
});
