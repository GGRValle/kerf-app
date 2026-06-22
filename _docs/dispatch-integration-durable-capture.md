# Dispatch → Codex / Integration Lane: Durable Capture Store + Sync Binding

**Sprint:** Mobile Field Truth.
**Depends on:** PR #414 — `src/app/lib/captureSyncState.ts` + `src/app/components/CaptureSyncBadge.astro` (the sync-state grammar this lane makes *true*).

## Why
Right Hand mobile is **field truth capture + safe next action**. Today captures live in `sessionStorage`/memory only (`camera.astro` `kerf.cameraCapture`; `field-capture.astro` in-memory blobs) — they vanish on tab close, app backgrounding, weak signal, or route change. Until a durable store backs it, "field truth" is a demo and **"Saved on phone" is a durability lie**. This lane builds the trust layer.

## Goal
Capture sessions survive reloads, app backgrounding, weak signal, and route changes. Bind real state to the #414 grammar:

`Captured → Saved on phone → Syncing → Synced / Needs attention / Failed · Retry`

## ⚠️ Tightening notes (founder — non-negotiable)
1. **Server principal is the authority.** `tenant_id`/`user_id` come from the authenticated server principal, never client-asserted. The IndexedDB queue is a cache/handoff, **not** tenant authority. The server **re-resolves tenant from the principal on every upload** and rejects mismatches.
2. **`saved_on_phone` requires an IndexedDB read-back.** A successful `put` is not enough — the state flips to `Saved on phone` only after a **read-after-write** confirms the record *and its blob* are actually retrievable. No optimistic "saved."
3. **BackgroundSync is optional.** Do **not** depend on the Background Sync API (absent on iOS Safari). Baseline triggers are the `online` event + app-foreground (visibilitychange); BackgroundSync is a progressive enhancement only.
4. **Session-first is mandatory.** Capture is session-scoped: one session holds many photos/videos/scans/notes; the camera captures repeatedly **without routing each item**; `Done` opens routing for the whole session. There is no per-item routing path.
5. **Recent Proof must show locally-saved unsynced sessions.** Recent Proof is not "synced only" — it must surface locally-durable-but-unsynced sessions so the operator always sees pending work. Nothing pending is ever invisible.

## 1 · Durable store (IndexedDB `kerf-capture`, v1)
```ts
interface CaptureSession {
  id: string;
  tenant_id: string;                         // stamped from server principal (note 1)
  user_id: string;
  created_at: number;
  route_intent: 'estimate_walk' | 'daily_log' | 'lead' | 'review' | null;
  destination: { kind: string; id: string } | null;   // null until Done routes it
  status: CaptureSyncState;                  // session rollup of its items
  item_ids: string[];
}

interface CaptureItem {
  id: string;
  session_id: string;
  kind: 'photo' | 'video' | 'scan' | 'note';
  blob: Blob;                                // stored IN IndexedDB, not a kerf:// URI
  name: string;
  created_at: number;
  status: CaptureSyncState;
  error_reason?: string;
  server_ref?: string;                       // set on synced
}
```
**Store API:** `createSession(routeIntent)` · `addItem(sessionId, {kind, blob, name})` · `getSession(id)` · `listSessions(filter)` · `listPending()` · `setDestination(sessionId, dest)` · `markSyncing(itemId)` · `markSynced(itemId, serverRef)` · `markFailed(itemId, reason)` · `deleteSession(id)`.

An item is `saved_on_phone` **only after `put` + read-back** (note 2).

## 2 · Bind to #414 — the state machine IS the contract
Flip each `liveToday` in `captureSyncState.ts` to `true` **only** as its event is genuinely backed. The #414 truth-table is the go-live checklist.

| event | #414 state |
|---|---|
| item created (memory) | `captured` |
| **IndexedDB `put` + read-back ok** (note 2) | `saved_on_phone` |
| upload in-flight (online) | `syncing` |
| server **2xx** confirm | `synced` |
| non-2xx / offline-timeout | `failed` → Retry re-enqueues |
| `Done` with no destination | `needs_attention` |

Surfaces render `<CaptureSyncBadge state={item.status} retryHref={…} />`. **No surface may show `saved_on_phone`/`syncing`/`synced` until its event above fires.**

## 3 · Session model (note 4)
Many items per session; the camera adds items with **no per-item routing**; `Done` opens routing for the whole session. This durable session API is exactly what Cursor A's camera-session-first UI consumes — it must not invent its own store.

## 4 · Sync queue (note 3)
`listPending()` reads from IndexedDB. Triggers: the `online` event + app-foreground (`visibilitychange`). For each pending item: online → attempt upload; 2xx → `markSynced`; non-2xx/timeout → `markFailed`. BackgroundSync may be layered on where available, never required.

## 5 · Recovery (note 5)
On `/camera` load and app reopen, hydrate pending sessions from IndexedDB and show them. Recent Proof lists **locally-saved unsynced** sessions alongside synced ones. No capture vanishes silently.

## 6 · Security fence (note 1)
`tenant_id`/`user_id` stamped from the **server principal** at session create. The IDB queue is a cache/handoff, never tenant authority. On upload the **server re-resolves tenant from the authenticated principal** and rejects any mismatch. The client never asserts tenant authority.

## Acceptance (founder) → traces to
| acceptance | backed by |
|---|---|
| Capture 3 photos → reload before routing → still present | recovery #5 + durable store #1 |
| Capture → close/reopen → session in Recent Proof / pending | recovery #5 |
| Offline/failed upload shows `Failed · Retry`, not silent loss | queue #4 + state machine #2 |
| Successful upload flips to `Synced` | state machine #2 |
| No false `Saved on phone` before IndexedDB success | put + read-back gate (note 2) |
| Full suite green | Codex gate below |

## Touch points
- `src/app/pages/camera.astro` — replace the `kerf.cameraCapture` sessionStorage single-capture with the durable session store.
- `src/app/pages/field-capture.astro` — in-memory blobs → durable items.
- Upload endpoint(s) — server re-resolves tenant (note 1).
- Recent Proof surface (Cursor B) — list local unsynced (note 5).
- `src/app/lib/captureSyncState.ts` — flip `liveToday` per state as it is genuinely backed.

## Cursor lanes after this
- **Cursor A:** camera session-first UI, using ONLY the durable session API.
- **Cursor B:** Capture Review / Recent Proof.
- **Cursor C:** Active Job proof timeline + Daily Log media intake.

## Gate (Codex)
typecheck + build:astro + full suite green; phone-gate the acceptance against the research note (capture → reload → present; offline → `Failed · Retry`; success → `Synced`; never a false `Saved on phone`).
