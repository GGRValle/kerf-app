import crypto from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistenceTenantId } from '../../persistence/events.js';

export type CaptureUploadDestinationKind = 'job' | 'lead' | 'review' | 'daily_log';

export interface PersistCaptureUploadParams {
  readonly persistenceDir: string;
  readonly tenantId: PersistenceTenantId;
  readonly principalRole: string;
  readonly sessionId: string;
  readonly itemId: string;
  readonly captureKind: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly destination: {
    readonly kind: CaptureUploadDestinationKind;
    readonly id: string;
  };
  readonly bytes: Uint8Array;
  readonly now?: () => Date;
}

export interface CaptureUploadReceipt {
  readonly server_ref: string;
  readonly tenant_id: PersistenceTenantId;
  readonly session_id: string;
  readonly item_id: string;
  readonly destination_kind: CaptureUploadDestinationKind;
  readonly destination_id: string;
  readonly content_type: string;
  readonly file_name: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly stored_at: string;
  readonly relative_path: string;
}

function safeSegment(raw: string, fallback: string): string {
  const clean = raw.trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/_+/g, '_').slice(0, 160);
  return clean.length > 0 ? clean : fallback;
}

function safeFileName(raw: string): string {
  const clean = safeSegment(raw, 'capture.bin');
  return clean.includes('.') ? clean : `${clean}.bin`;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function writeAtomic(filepath: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(filepath), { recursive: true });
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filepath);
}

/**
 * Server-side capture receipt store.
 *
 * This is deliberately boring filesystem persistence under PERSISTENCE_DIR:
 * the browser may only say "Synced" after the server writes the blob, reads it
 * back, and returns this receipt. The tenant path is derived from the server
 * principal, never from client-supplied IndexedDB metadata.
 */
export async function persistCaptureUpload(
  params: PersistCaptureUploadParams,
): Promise<CaptureUploadReceipt> {
  if (params.bytes.byteLength <= 0) throw new Error('capture_upload_empty');
  const storedAt = (params.now?.() ?? new Date()).toISOString();
  const sessionId = safeSegment(params.sessionId, 'session');
  const itemId = safeSegment(params.itemId, 'item');
  const destinationKind = params.destination.kind;
  const destinationId = safeSegment(params.destination.id, 'destination');
  const fileName = safeFileName(params.fileName);
  const digest = sha256(params.bytes);
  const dir = path.join(
    params.persistenceDir,
    'capture-uploads',
    safeSegment(params.tenantId, 'tenant'),
    sessionId,
    itemId,
  );
  const blobPath = path.join(dir, fileName);
  const manifestPath = path.join(dir, 'receipt.json');

  await writeAtomic(blobPath, params.bytes);

  const written = await stat(blobPath);
  if (written.size !== params.bytes.byteLength) {
    throw new Error('capture_upload_size_mismatch');
  }
  const readBack = await readFile(blobPath);
  const readBackDigest = sha256(readBack);
  if (readBackDigest !== digest) {
    throw new Error('capture_upload_readback_mismatch');
  }

  const relativePath = path.relative(params.persistenceDir, blobPath);
  const receipt: CaptureUploadReceipt = {
    server_ref: `kerf://capture-upload/${safeSegment(params.tenantId, 'tenant')}/${sessionId}/${itemId}`,
    tenant_id: params.tenantId,
    session_id: params.sessionId,
    item_id: params.itemId,
    destination_kind: destinationKind,
    destination_id: params.destination.id,
    content_type: params.contentType || 'application/octet-stream',
    file_name: fileName,
    bytes: readBack.byteLength,
    sha256: digest,
    stored_at: storedAt,
    relative_path: relativePath,
  };

  await writeAtomic(manifestPath, `${JSON.stringify({
    ...receipt,
    capture_kind: params.captureKind,
    principal_role: params.principalRole,
  }, null, 2)}\n`);

  return receipt;
}
