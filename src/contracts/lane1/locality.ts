import type { PersistenceTenantId } from '../../persistence/events.js';
import type { ConsequenceTier } from './consequenceGate.js';

/**
 * Contract 6 · Locality envelope (D-051).
 * Every record and event carries tenant-scoped context; tenant is Wall 1 (isolation).
 */
export interface LocalityEnvelope {
  readonly tenant: PersistenceTenantId;
  /** Business unit within the org (GGR / Valle / HPG dogfood BUs). */
  readonly bu?: string;
  readonly client?: string;
  readonly project?: string;
  readonly consequence_tier: ConsequenceTier;
}

export function localityKey(envelope: LocalityEnvelope): string {
  return [
    envelope.tenant,
    envelope.bu ?? '',
    envelope.client ?? '',
    envelope.project ?? '',
    envelope.consequence_tier,
  ].join(':');
}
