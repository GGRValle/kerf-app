import type { CaptureSyncState } from './captureSyncState.js';

export const CAPTURE_DB_NAME = 'kerf-capture';
export const CAPTURE_DB_VERSION = 1;
export const CAPTURE_SESSION_STORE = 'sessions';
export const CAPTURE_ITEM_STORE = 'items';

export type CaptureRouteIntent = 'estimate_walk' | 'daily_log' | 'lead' | 'review' | null;
export type CaptureItemKind = 'photo' | 'video' | 'scan' | 'note';

export interface CaptureDestination {
  readonly kind: string;
  readonly id: string;
}

export interface CapturePrincipalSnapshot {
  readonly tenant_id: string;
  readonly user_id: string;
  /** Client-side cache only. The server principal remains authoritative. */
  readonly source: 'server_principal_snapshot';
}

export interface CaptureSession {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly route_intent: CaptureRouteIntent;
  readonly destination: CaptureDestination | null;
  readonly status: CaptureSyncState;
  readonly item_ids: readonly string[];
}

export interface CaptureItem {
  readonly id: string;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly kind: CaptureItemKind;
  readonly blob: Blob;
  readonly name: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly status: CaptureSyncState;
  readonly error_reason?: string;
  readonly server_ref?: string;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export interface AddCaptureItemInput {
  readonly kind: CaptureItemKind;
  readonly blob: Blob;
  readonly name: string;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export interface ListSessionFilter {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly status?: CaptureSyncState;
  readonly route_intent?: CaptureRouteIntent;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('indexeddb_request_failed')));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('indexeddb_transaction_aborted')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('indexeddb_transaction_failed')));
  });
}

function requireIndexedDB(): IDBFactory {
  const factory = globalThis.indexedDB;
  if (!factory) throw new Error('indexeddb_unavailable');
  return factory;
}

export function openCaptureDb(): Promise<IDBDatabase> {
  const request = requireIndexedDB().open(CAPTURE_DB_NAME, CAPTURE_DB_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(CAPTURE_SESSION_STORE)) {
      const sessions = db.createObjectStore(CAPTURE_SESSION_STORE, { keyPath: 'id' });
      sessions.createIndex('status', 'status', { unique: false });
      sessions.createIndex('route_intent', 'route_intent', { unique: false });
      sessions.createIndex('updated_at', 'updated_at', { unique: false });
    }
    if (!db.objectStoreNames.contains(CAPTURE_ITEM_STORE)) {
      const items = db.createObjectStore(CAPTURE_ITEM_STORE, { keyPath: 'id' });
      items.createIndex('session_id', 'session_id', { unique: false });
      items.createIndex('status', 'status', { unique: false });
      items.createIndex('updated_at', 'updated_at', { unique: false });
    }
  });
  return requestToPromise(request);
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export function rollupCaptureSessionStatus(items: readonly CaptureItem[]): CaptureSyncState {
  if (items.some((item) => item.status === 'failed')) return 'failed';
  if (items.some((item) => item.status === 'needs_attention')) return 'needs_attention';
  if (items.some((item) => item.status === 'syncing')) return 'syncing';
  if (items.length === 0 || items.some((item) => item.status === 'captured')) return 'captured';
  if (items.every((item) => item.status === 'synced')) return 'synced';
  return 'saved_on_phone';
}

export function principalSnapshotFromSurfaceContext(fallback?: {
  tenant_id?: string | null;
  user_id?: string | null;
}): CapturePrincipalSnapshot {
  const ctx = (globalThis as typeof globalThis & {
    window?: { __KERF_SURFACE_CONTEXT__?: unknown };
  }).window?.__KERF_SURFACE_CONTEXT__;
  const record = typeof ctx === 'object' && ctx !== null ? ctx as Record<string, unknown> : {};
  const tenant = typeof record.tenant === 'string' && record.tenant.length > 0
    ? record.tenant
    : fallback?.tenant_id ?? '';
  const user = typeof record.role === 'string' && record.role.length > 0
    ? record.role
    : fallback?.user_id ?? '';
  if (!tenant || !user) throw new Error('capture_principal_snapshot_missing');
  return { tenant_id: tenant, user_id: user, source: 'server_principal_snapshot' };
}

export function captureSessionBelongsToPrincipal(
  session: Pick<CaptureSession, 'tenant_id' | 'user_id'>,
  principal: Pick<CapturePrincipalSnapshot, 'tenant_id' | 'user_id'>,
): boolean {
  return session.tenant_id === principal.tenant_id && session.user_id === principal.user_id;
}

export async function createSession(
  routeIntent: CaptureRouteIntent,
  principal: CapturePrincipalSnapshot,
): Promise<CaptureSession> {
  const now = Date.now();
  const session: CaptureSession = {
    id: newId('cap_session'),
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    created_at: now,
    updated_at: now,
    route_intent: routeIntent,
    destination: null,
    status: 'captured',
    item_ids: [],
  };
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_SESSION_STORE, 'readwrite');
    tx.objectStore(CAPTURE_SESSION_STORE).put(session);
    await transactionDone(tx);
    return session;
  } finally {
    db.close();
  }
}

export async function getSession(id: string): Promise<CaptureSession | null> {
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_SESSION_STORE, 'readonly');
    const result = await requestToPromise<CaptureSession | undefined>(
      tx.objectStore(CAPTURE_SESSION_STORE).get(id),
    );
    await transactionDone(tx);
    return result ?? null;
  } finally {
    db.close();
  }
}

export async function getItem(id: string): Promise<CaptureItem | null> {
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_ITEM_STORE, 'readonly');
    const result = await requestToPromise<CaptureItem | undefined>(
      tx.objectStore(CAPTURE_ITEM_STORE).get(id),
    );
    await transactionDone(tx);
    return result ?? null;
  } finally {
    db.close();
  }
}

export async function listItems(sessionId: string): Promise<CaptureItem[]> {
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_ITEM_STORE, 'readonly');
    const index = tx.objectStore(CAPTURE_ITEM_STORE).index('session_id');
    const result = await requestToPromise<CaptureItem[]>(index.getAll(sessionId));
    await transactionDone(tx);
    return result.sort((a, b) => a.created_at - b.created_at);
  } finally {
    db.close();
  }
}

async function updateSessionRollup(db: IDBDatabase, sessionId: string, now: number): Promise<CaptureSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const sessionItems = await listItems(sessionId);
  const nextSession: CaptureSession = {
    ...session,
    updated_at: now,
    status: rollupCaptureSessionStatus(sessionItems),
    item_ids: sessionItems.map((item) => item.id),
  };
  const tx = db.transaction(CAPTURE_SESSION_STORE, 'readwrite');
  const sessions = tx.objectStore(CAPTURE_SESSION_STORE);
  sessions.put(nextSession);
  await transactionDone(tx);
  return nextSession;
}

export async function addItem(sessionId: string, input: AddCaptureItemInput): Promise<CaptureItem> {
  const db = await openCaptureDb();
  try {
    const session = await getSession(sessionId);
    if (!session) throw new Error('capture_session_not_found');
    const now = Date.now();
    const capturedItem: CaptureItem = {
      id: newId('cap_item'),
      session_id: session.id,
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      kind: input.kind,
      blob: input.blob,
      name: input.name,
      created_at: now,
      updated_at: now,
      status: 'captured',
      metadata: input.metadata,
    };

    const putTx = db.transaction([CAPTURE_SESSION_STORE, CAPTURE_ITEM_STORE], 'readwrite');
    putTx.objectStore(CAPTURE_ITEM_STORE).put(capturedItem);
    putTx.objectStore(CAPTURE_SESSION_STORE).put({
      ...session,
      updated_at: now,
      status: 'captured',
      item_ids: [...session.item_ids, capturedItem.id],
    } satisfies CaptureSession);
    await transactionDone(putTx);

    // Founder tightening note: "Saved on phone" requires read-after-write proof.
    const confirmed = await getItem(capturedItem.id);
    if (!confirmed || !(confirmed.blob instanceof Blob) || confirmed.blob.size !== input.blob.size) {
      throw new Error('capture_readback_failed');
    }

    const savedItem: CaptureItem = {
      ...confirmed,
      updated_at: Date.now(),
      status: 'saved_on_phone',
    };
    const saveTx = db.transaction(CAPTURE_ITEM_STORE, 'readwrite');
    saveTx.objectStore(CAPTURE_ITEM_STORE).put(savedItem);
    await transactionDone(saveTx);
    await updateSessionRollup(db, sessionId, Date.now());
    return savedItem;
  } finally {
    db.close();
  }
}

export async function listSessions(filter: ListSessionFilter): Promise<CaptureSession[]> {
  if (!filter.tenant_id || !filter.user_id) throw new Error('capture_principal_filter_missing');
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_SESSION_STORE, 'readonly');
    const sessions = await requestToPromise<CaptureSession[]>(
      tx.objectStore(CAPTURE_SESSION_STORE).getAll(),
    );
    await transactionDone(tx);
    return sessions
      .filter((session) => captureSessionBelongsToPrincipal(session, filter))
      .filter((session) => filter.status === undefined || session.status === filter.status)
      .filter((session) => filter.route_intent === undefined || session.route_intent === filter.route_intent)
      .sort((a, b) => b.updated_at - a.updated_at);
  } finally {
    db.close();
  }
}

export async function listPending(principal: CapturePrincipalSnapshot): Promise<CaptureSession[]> {
  const sessions = await listSessions({ tenant_id: principal.tenant_id, user_id: principal.user_id });
  return sessions.filter((session) => session.status !== 'synced');
}

export async function setDestination(sessionId: string, destination: CaptureDestination | null): Promise<CaptureSession | null> {
  const db = await openCaptureDb();
  try {
    const session = await getSession(sessionId);
    if (!session) return null;
    const now = Date.now();
    const next: CaptureSession = {
      ...session,
      updated_at: now,
      destination,
    };
    const tx = db.transaction(CAPTURE_SESSION_STORE, 'readwrite');
    tx.objectStore(CAPTURE_SESSION_STORE).put(next);
    await transactionDone(tx);
    return next;
  } finally {
    db.close();
  }
}

async function markItemStatus(
  itemId: string,
  status: CaptureSyncState,
  extras: Pick<CaptureItem, 'error_reason' | 'server_ref'> = {},
): Promise<CaptureItem | null> {
  const db = await openCaptureDb();
  try {
    const item = await getItem(itemId);
    if (!item) return null;
    const next: CaptureItem = {
      ...item,
      ...extras,
      status,
      updated_at: Date.now(),
    };
    const tx = db.transaction(CAPTURE_ITEM_STORE, 'readwrite');
    tx.objectStore(CAPTURE_ITEM_STORE).put(next);
    await transactionDone(tx);
    await updateSessionRollup(db, item.session_id, Date.now());
    return next;
  } finally {
    db.close();
  }
}

export function markSyncing(itemId: string): Promise<CaptureItem | null> {
  return markItemStatus(itemId, 'syncing');
}

export function markSynced(itemId: string, serverRef: string): Promise<CaptureItem | null> {
  return markItemStatus(itemId, 'synced', { server_ref: serverRef, error_reason: undefined });
}

export function markNeedsAttention(itemId: string, reason: string): Promise<CaptureItem | null> {
  return markItemStatus(itemId, 'needs_attention', { error_reason: reason });
}

export function markFailed(itemId: string, reason: string): Promise<CaptureItem | null> {
  return markItemStatus(itemId, 'failed', { error_reason: reason });
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openCaptureDb();
  try {
    const sessionItems = await listItems(id);
    const tx = db.transaction([CAPTURE_SESSION_STORE, CAPTURE_ITEM_STORE], 'readwrite');
    const sessions = tx.objectStore(CAPTURE_SESSION_STORE);
    const items = tx.objectStore(CAPTURE_ITEM_STORE);
    for (const item of sessionItems) items.delete(item.id);
    sessions.delete(id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}
