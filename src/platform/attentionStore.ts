/**
 * In-memory ranked attention feed for GET /api/attention (tenant-scoped · Wall 1).
 */
import type { AttentionArtifact, ShellRoleRoot } from '../contracts/lane1/index.js';
import type { CaptureRecordedEvent, PersistenceTenantId } from '../persistence/events.js';
import { attentionFromCaptureEvents, rankAttention } from './attentionEmit.js';

const capturesByTenant = new Map<PersistenceTenantId, CaptureRecordedEvent[]>();

const GGR_DEMO_CAPTURES: readonly CaptureRecordedEvent[] = [
  {
    event_id: 'evt_demo_cap_ggr_1',
    type: 'capture.recorded',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_wegrzyn_kitchen',
    actor: { id: 'demo', role: 'field_super' },
    at: '2026-06-02T12:00:00.000Z',
    source_refs: [{ kind: 'transcript', uri: 'kerf://capture/cap_ggr_1', excerpt: 'Outdoor kitchen — verify gas line routing.' }],
    capture_id: 'cap_ggr_1',
    transcript_text: 'Outdoor kitchen scope — verify gas line routing before cabinet order.',
    audio_uri: null,
    duration_ms: 0,
    language: 'en',
  },
  {
    event_id: 'evt_demo_cap_ggr_2',
    type: 'capture.recorded',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'demo', role: 'field_super' },
    at: '2026-06-02T12:05:00.000Z',
    source_refs: [{ kind: 'transcript', uri: 'kerf://capture/cap_ggr_2', excerpt: 'Tile layout drift on north wall.' }],
    capture_id: 'cap_ggr_2',
    transcript_text: 'Tile layout drift on north wall — PM review before install continues.',
    audio_uri: null,
    duration_ms: 0,
    language: 'en',
  },
];

const VALLE_DEMO_CAPTURES: readonly CaptureRecordedEvent[] = [
  {
    event_id: 'evt_demo_cap_valle_1',
    type: 'capture.recorded',
    tenant_id: 'tenant_valle',
    correlation_id: 'proj_valle_eagle_showroom',
    actor: { id: 'demo', role: 'field_super' },
    at: '2026-06-02T16:00:00.000Z',
    source_refs: [{ kind: 'transcript', uri: 'kerf://capture/cap_valle_1', excerpt: 'Showroom veneer sample wall — confirm grain match.' }],
    capture_id: 'cap_valle_1',
    transcript_text: 'Eagle showroom install — confirm veneer grain match before field cut.',
    audio_uri: null,
    duration_ms: 0,
    language: 'en',
  },
  {
    event_id: 'evt_demo_cap_valle_2',
    type: 'capture.recorded',
    tenant_id: 'tenant_valle',
    correlation_id: 'proj_valle_meridian_reface',
    actor: { id: 'demo', role: 'field_super' },
    at: '2026-06-02T16:10:00.000Z',
    source_refs: [{ kind: 'transcript', uri: 'kerf://capture/cap_valle_2', excerpt: 'Meridian reface — soft-close hinge count.' }],
    capture_id: 'cap_valle_2',
    transcript_text: 'Meridian kitchen reface — verify soft-close hinge count with shop ticket.',
    audio_uri: null,
    duration_ms: 0,
    language: 'en',
  },
];

export function seedCaptureAttention(
  tenantId: PersistenceTenantId,
  events: readonly CaptureRecordedEvent[],
): void {
  capturesByTenant.set(tenantId, [...events]);
}

export function appendCaptureAttention(event: CaptureRecordedEvent): void {
  const list = capturesByTenant.get(event.tenant_id) ?? [];
  capturesByTenant.set(event.tenant_id, [...list, event]);
}

export function listRankedAttention(opts: {
  readonly tenantId: PersistenceTenantId;
  readonly role: ShellRoleRoot;
  readonly limit?: number;
}): readonly AttentionArtifact[] {
  const events = capturesByTenant.get(opts.tenantId) ?? [];
  const artifacts = attentionFromCaptureEvents(events);
  return rankAttention(artifacts, { role: opts.role, limit: opts.limit ?? 24 });
}

/** Tenant-true demo fixtures — never copy GGR captures into other tenants. */
export function ensureDemoAttentionSeed(tenantId: PersistenceTenantId): void {
  if (capturesByTenant.has(tenantId)) return;
  if (tenantId === 'tenant_ggr') {
    seedCaptureAttention(tenantId, GGR_DEMO_CAPTURES);
    return;
  }
  if (tenantId === 'tenant_valle') {
    seedCaptureAttention(tenantId, VALLE_DEMO_CAPTURES);
    return;
  }
  seedCaptureAttention(tenantId, []);
}

/** Test-only reset — isolation tests need a clean store. */
export function resetAttentionStoreForTests(): void {
  capturesByTenant.clear();
}
