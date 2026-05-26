import type { PersistenceEvent } from '../../persistence/events.js';

const BASE_HEADER = {
  tenant_id: 'tenant_ggr' as const,
  correlation_id: 'proj_wegrzyn_kitchen',
  actor: { id: 'browser_operator', role: 'owner' as const },
  source_refs: [{ kind: 'voice' as const, uri: 'kerf://capture/demo', excerpt: 'demo' }],
};

export function getSeededCaptureEventsForProject(projectId: string): readonly PersistenceEvent[] {
  if (projectId === 'proj_wegrzyn_kitchen') {
    return [
      {
        ...BASE_HEADER,
        event_id: 'evt_cap_demo_001',
        type: 'capture.recorded',
        at: '2026-05-18T14:22:00.000Z',
        capture_id: 'cap_wegrzyn_001',
        transcript_text: 'Kitchen scope walkthrough with client.',
        audio_uri: 'kerf://audio/cap_wegrzyn_001',
        duration_ms: 124_000,
        language: 'en',
      },
      {
        ...BASE_HEADER,
        event_id: 'evt_dl_demo_001',
        type: 'daily_log.entry_captured',
        at: '2026-05-19T09:05:00.000Z',
        entry_id: 'dl_wegrzyn_001',
        entry_kind: 'progress_update',
        transcript_text: 'Cabinet layout confirmed on site.',
        audio_uri: null,
        photo_uris: ['kerf://photo/dl_wegrzyn_001_a', 'kerf://photo/dl_wegrzyn_001_b'],
        clock_sub_kind: null,
      },
    ] as PersistenceEvent[];
  }
  if (projectId === 'proj_multi_capture') {
    return [
      {
        ...BASE_HEADER,
        correlation_id: 'proj_multi_capture',
        event_id: 'evt_cap_multi_001',
        type: 'capture.recorded',
        at: '2026-05-10T10:00:00.000Z',
        capture_id: 'cap_multi_001',
        transcript_text: 'Initial walkthrough.',
        audio_uri: 'kerf://audio/cap_multi_001',
        duration_ms: 90_000,
        language: 'en',
      },
      {
        ...BASE_HEADER,
        correlation_id: 'proj_multi_capture',
        event_id: 'evt_cap_multi_002',
        type: 'capture.recorded',
        at: '2026-05-12T11:30:00.000Z',
        capture_id: 'cap_multi_002',
        transcript_text: 'Follow-up measurements.',
        audio_uri: 'kerf://audio/cap_multi_002',
        duration_ms: 60_000,
        language: 'en',
      },
      {
        ...BASE_HEADER,
        correlation_id: 'proj_multi_capture',
        event_id: 'evt_dl_multi_001',
        type: 'daily_log.entry_captured',
        at: '2026-05-13T08:00:00.000Z',
        entry_id: 'dl_multi_001',
        entry_kind: 'progress_update',
        transcript_text: null,
        audio_uri: null,
        photo_uris: ['kerf://photo/dl_multi_001'],
        clock_sub_kind: null,
      },
    ] as PersistenceEvent[];
  }
  return [];
}
