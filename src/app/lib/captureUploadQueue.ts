import {
  getSession,
  listItems,
  listPending,
  markFailed,
  markSyncing,
  markSynced,
  type CaptureItem,
  type CapturePrincipalSnapshot,
  type CaptureSession,
} from './captureStore.js';

type QueueFetch = typeof fetch;

export interface CaptureUploadQueueOptions {
  readonly fetchFn?: QueueFetch;
  readonly onItemStatus?: (item: CaptureItem) => void;
}

export interface CaptureUploadQueueResult {
  readonly attempted: number;
  readonly synced: number;
  readonly failed: number;
  readonly skipped: number;
}

interface CaptureUploadReceiptResponse {
  readonly ok?: boolean;
  readonly receipt?: {
    readonly server_ref?: string;
  };
}

const RETRYABLE_STATUSES = new Set<CaptureItem['status']>(['saved_on_phone', 'failed', 'syncing']);

function safeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 220);
}

function uploadKindForItem(item: CaptureItem): string {
  return item.kind;
}

async function uploadItem(
  session: CaptureSession,
  item: CaptureItem,
  fetchFn: QueueFetch,
  onItemStatus?: (item: CaptureItem) => void,
): Promise<'synced' | 'failed' | 'skipped'> {
  if (!session.destination) return 'skipped';
  if (!RETRYABLE_STATUSES.has(item.status)) return 'skipped';
  if (!(item.blob instanceof Blob) || item.blob.size <= 0) {
    const failed = await markFailed(item.id, 'blob_missing');
    if (failed) onItemStatus?.(failed);
    return 'failed';
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const failed = await markFailed(item.id, 'offline');
    if (failed) onItemStatus?.(failed);
    return 'failed';
  }

  const syncing = await markSyncing(item.id);
  if (syncing) onItemStatus?.(syncing);

  let response: Response;
  try {
    response = await fetchFn('/api/v1/capture-sync/items', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': item.blob.type || 'application/octet-stream',
        'X-Capture-Session-Id': safeHeader(session.id),
        'X-Capture-Item-Id': safeHeader(item.id),
        'X-Capture-Kind': safeHeader(uploadKindForItem(item)),
        'X-Capture-File-Name': safeHeader(item.name || `${item.kind}-capture`),
        'X-Capture-Destination-Kind': safeHeader(session.destination.kind),
        'X-Capture-Destination-Id': safeHeader(session.destination.id),
      },
      body: item.blob,
    });
  } catch (err) {
    const failed = await markFailed(item.id, err instanceof Error ? err.message : 'network_failed');
    if (failed) onItemStatus?.(failed);
    return 'failed';
  }

  if (!response.ok) {
    const failed = await markFailed(item.id, `upload_failed_${response.status}`);
    if (failed) onItemStatus?.(failed);
    return 'failed';
  }

  let body: CaptureUploadReceiptResponse;
  try {
    body = await response.json() as CaptureUploadReceiptResponse;
  } catch {
    body = {};
  }
  const serverRef = body.receipt?.server_ref;
  if (!serverRef) {
    const failed = await markFailed(item.id, 'missing_server_receipt');
    if (failed) onItemStatus?.(failed);
    return 'failed';
  }

  const synced = await markSynced(item.id, serverRef);
  if (synced) onItemStatus?.(synced);
  return 'synced';
}

export async function processCaptureUploadQueue(
  principal: CapturePrincipalSnapshot,
  options: CaptureUploadQueueOptions = {},
): Promise<CaptureUploadQueueResult> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('capture_upload_fetch_unavailable');

  const sessions = await listPending(principal);
  let attempted = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const pendingSession of sessions) {
    const session = await getSession(pendingSession.id);
    if (!session) {
      skipped += 1;
      continue;
    }
    if (!session.destination) {
      skipped += 1;
      continue;
    }
    const items = await listItems(session.id);
    for (const item of items) {
      if (!RETRYABLE_STATUSES.has(item.status)) {
        skipped += 1;
        continue;
      }
      attempted += 1;
      const result = await uploadItem(session, item, fetchFn, options.onItemStatus);
      if (result === 'synced') synced += 1;
      else if (result === 'failed') failed += 1;
      else skipped += 1;
    }
  }

  return { attempted, synced, failed, skipped };
}

export function installCaptureUploadQueue(
  principal: CapturePrincipalSnapshot,
  options: CaptureUploadQueueOptions = {},
): () => void {
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    void processCaptureUploadQueue(principal, options).finally(() => {
      running = false;
    });
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', run);
  window.addEventListener('pageshow', run);
  document.addEventListener('visibilitychange', onVisibility);
  run();
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('pageshow', run);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
