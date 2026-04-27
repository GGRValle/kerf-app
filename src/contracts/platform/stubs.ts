import type {
  AttestCreateReq,
  AttestCreateRes,
  AuditEventReq,
  AuditEventRes,
  MoneyApproveReq,
  MoneyApproveRes,
  MoneyProposeReq,
  MoneyProposeRes,
  PlatformClient,
} from './types.js';

// Stub Platform client. Accepts every call, mints synthetic IDs.
// Used by Kerf dev + tests until the Platform HTTP client lands (W3).
// Every stub call is silent; wire console.log here only for local debugging.

export interface StubPlatformClientOpts {
  idPrefix?: string;
  clock?: () => Date;
}

export function createStubPlatformClient(opts: StubPlatformClientOpts = {}): PlatformClient {
  const clock = opts.clock ?? (() => new Date());
  const prefix = opts.idPrefix ?? 'stub';
  let counter = 0;
  const mint = (kind: string) => `${prefix}_${kind}_${++counter}`;
  const now = () => clock().toISOString();

  return {
    async attestCreate(_req: AttestCreateReq): Promise<AttestCreateRes> {
      return { platformEntityId: mint('pe'), acceptedAt: now() };
    },
    async moneyPropose(_req: MoneyProposeReq): Promise<MoneyProposeRes> {
      return { proposalId: mint('mp'), acceptedAt: now() };
    },
    async moneyApprove(_req: MoneyApproveReq): Promise<MoneyApproveRes> {
      return { approvalId: mint('ma'), lockedAt: now() };
    },
    async auditEvent(_req: AuditEventReq): Promise<AuditEventRes> {
      return { auditId: mint('au'), acceptedAt: now() };
    },
  };
}
