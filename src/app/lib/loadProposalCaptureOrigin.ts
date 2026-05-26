import { getApiDeps } from '../../api/lib/deps.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import {
  resolveProposalCaptureOrigin,
  type ProposalCaptureOrigin,
} from '../../proposal/captureOrigin.js';
import { getSeededCaptureEventsForProject } from './lane6CaptureFixtures.js';

export async function loadProposalCaptureOrigin(
  tenantId: PersistenceTenantId,
  correlationId: string,
): Promise<ProposalCaptureOrigin> {
  const { tenantReader } = getApiDeps();
  const persisted = await tenantReader.readEventsForProject(tenantId, correlationId);
  const seeded = getSeededCaptureEventsForProject(correlationId);
  const events = persisted.length > 0 ? persisted : seeded;
  return resolveProposalCaptureOrigin(events, correlationId);
}
