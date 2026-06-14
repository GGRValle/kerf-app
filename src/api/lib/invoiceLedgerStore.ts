import pg from 'pg';

import type { PersistenceTenantId } from '../../persistence/events.js';

const { Pool } = pg;

export type InvoiceLedgerStatus = 'issued' | 'void';
export type InvoiceLedgerMilestoneKind = 'down_payment' | 'final' | string;

export interface InvoiceLedgerRow {
  readonly tenant_id: PersistenceTenantId;
  readonly ledger_id: string;
  readonly basis_id: string;
  readonly invoice_id: string;
  readonly estimate_id: string;
  readonly proposal_id: string;
  readonly milestone_id: string;
  readonly milestone_kind: InvoiceLedgerMilestoneKind;
  readonly amount_cents: number;
  readonly status: InvoiceLedgerStatus;
  readonly source_refs: readonly string[];
  readonly actor_id: string;
  readonly issued_at: string;
}

export interface InvoiceLedgerIssueInput {
  readonly tenant_id: PersistenceTenantId;
  readonly ledger_id: string;
  readonly basis_id: string;
  readonly invoice_id: string;
  readonly estimate_id: string;
  readonly proposal_id: string;
  readonly milestone_id: string;
  readonly milestone_kind: InvoiceLedgerMilestoneKind;
  readonly amount_cents: number;
  readonly source_refs: readonly string[];
  readonly actor_id: string;
  readonly issued_at: string;
}

export interface InvoiceLedgerStore {
  issue(input: InvoiceLedgerIssueInput): Promise<InvoiceLedgerRow>;
  void(tenant: PersistenceTenantId, ledgerId: string): Promise<InvoiceLedgerRow | null>;
  read(tenant: PersistenceTenantId, ledgerId: string): Promise<InvoiceLedgerRow | null>;
  listForBasis(tenant: PersistenceTenantId, basisId: string): Promise<readonly InvoiceLedgerRow[]>;
  listForMilestone(tenant: PersistenceTenantId, basisId: string, milestoneId: string): Promise<readonly InvoiceLedgerRow[]>;
  sumIssuedForBasis(tenant: PersistenceTenantId, basisId: string): Promise<number>;
  sumIssuedForMilestone(tenant: PersistenceTenantId, basisId: string, milestoneId: string): Promise<number>;
}

export class InvoiceLedgerConflictError extends Error {
  readonly code = 'milestone_already_issued';

  constructor(message = 'invoice milestone already issued') {
    super(message);
    this.name = 'InvoiceLedgerConflictError';
  }
}

export class InvoiceLedgerValidationError extends Error {
  readonly code = 'invalid_invoice_ledger_row';

  constructor(message: string) {
    super(message);
    this.name = 'InvoiceLedgerValidationError';
  }
}

function cleanSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'unknown';
}

export function invoiceLedgerIdFor(estimateId: string, milestoneKind: string): string {
  return `inv_${cleanSegment(estimateId)}_${cleanSegment(milestoneKind)}`;
}

function validateRow(input: InvoiceLedgerIssueInput): void {
  for (const [key, value] of Object.entries({
    tenant_id: input.tenant_id,
    ledger_id: input.ledger_id,
    basis_id: input.basis_id,
    invoice_id: input.invoice_id,
    estimate_id: input.estimate_id,
    proposal_id: input.proposal_id,
    milestone_id: input.milestone_id,
    milestone_kind: input.milestone_kind,
    actor_id: input.actor_id,
    issued_at: input.issued_at,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvoiceLedgerValidationError(`${key} must be a non-empty string`);
    }
  }
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new InvoiceLedgerValidationError('amount_cents must be a positive integer');
  }
  if (!Array.isArray(input.source_refs) || input.source_refs.some((ref) => typeof ref !== 'string' || ref.trim().length === 0)) {
    throw new InvoiceLedgerValidationError('source_refs must be non-empty strings');
  }
  const issuedAt = Date.parse(input.issued_at);
  if (!Number.isFinite(issuedAt)) {
    throw new InvoiceLedgerValidationError('issued_at must be an ISO timestamp');
  }
}

function toRow(input: InvoiceLedgerIssueInput, status: InvoiceLedgerStatus): InvoiceLedgerRow {
  validateRow(input);
  return {
    tenant_id: input.tenant_id,
    ledger_id: input.ledger_id,
    basis_id: input.basis_id,
    invoice_id: input.invoice_id,
    estimate_id: input.estimate_id,
    proposal_id: input.proposal_id,
    milestone_id: input.milestone_id,
    milestone_kind: input.milestone_kind,
    amount_cents: input.amount_cents,
    status,
    source_refs: [...input.source_refs],
    actor_id: input.actor_id,
    issued_at: input.issued_at,
  };
}

function active(row: InvoiceLedgerRow): boolean {
  return row.status === 'issued';
}

export function createMemoryInvoiceLedgerStore(): InvoiceLedgerStore {
  const byTenant = new Map<PersistenceTenantId, Map<string, InvoiceLedgerRow>>();
  const tenantMap = (tenant: PersistenceTenantId): Map<string, InvoiceLedgerRow> => {
    let map = byTenant.get(tenant);
    if (!map) {
      map = new Map();
      byTenant.set(tenant, map);
    }
    return map;
  };

  const rowsForBasis = (tenant: PersistenceTenantId, basisId: string): InvoiceLedgerRow[] =>
    [...(byTenant.get(tenant)?.values() ?? [])].filter((row) => row.tenant_id === tenant && row.basis_id === basisId);

  return {
    async issue(input) {
      const row = toRow(input, 'issued');
      const map = tenantMap(row.tenant_id);
      const existing = map.get(row.ledger_id);
      if (existing?.status === 'issued') {
        throw new InvoiceLedgerConflictError();
      }
      const liveSameMilestone = [...map.values()].find(
        (candidate) =>
          candidate.status === 'issued' &&
          candidate.basis_id === row.basis_id &&
          candidate.milestone_id === row.milestone_id &&
          candidate.ledger_id !== row.ledger_id,
      );
      if (liveSameMilestone) throw new InvoiceLedgerConflictError();
      map.set(row.ledger_id, row);
      return row;
    },
    async void(tenant, ledgerId) {
      const map = tenantMap(tenant);
      const row = map.get(ledgerId);
      if (!row || row.tenant_id !== tenant) return null;
      const next = { ...row, status: 'void' as const };
      map.set(ledgerId, next);
      return next;
    },
    async read(tenant, ledgerId) {
      const row = byTenant.get(tenant)?.get(ledgerId) ?? null;
      return row?.tenant_id === tenant ? row : null;
    },
    async listForBasis(tenant, basisId) {
      return rowsForBasis(tenant, basisId);
    },
    async listForMilestone(tenant, basisId, milestoneId) {
      return rowsForBasis(tenant, basisId).filter((row) => row.milestone_id === milestoneId);
    },
    async sumIssuedForBasis(tenant, basisId) {
      return rowsForBasis(tenant, basisId).filter(active).reduce((sum, row) => sum + row.amount_cents, 0);
    },
    async sumIssuedForMilestone(tenant, basisId, milestoneId) {
      return rowsForBasis(tenant, basisId)
        .filter((row) => active(row) && row.milestone_id === milestoneId)
        .reduce((sum, row) => sum + row.amount_cents, 0);
    },
  };
}

function parseRow(value: unknown): InvoiceLedgerRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as InvoiceLedgerRow;
  if (typeof row.tenant_id !== 'string' || typeof row.ledger_id !== 'string') return null;
  if (row.status !== 'issued' && row.status !== 'void') return null;
  return row;
}

export function createPgInvoiceLedgerStore(connectionString: string): InvoiceLedgerStore {
  const pool = new Pool({ connectionString });
  let ready: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    ready ??= (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS right_hand_invoice_ledger (
          tenant_id text NOT NULL,
          ledger_id text NOT NULL,
          basis_id text NOT NULL,
          invoice_id text NOT NULL,
          estimate_id text NOT NULL,
          proposal_id text NOT NULL,
          milestone_id text NOT NULL,
          milestone_kind text NOT NULL,
          amount_cents integer NOT NULL,
          status text NOT NULL,
          issued_at timestamptz NOT NULL,
          ledger_row jsonb NOT NULL,
          PRIMARY KEY (tenant_id, ledger_id)
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS right_hand_invoice_ledger_live_milestone_idx
        ON right_hand_invoice_ledger (tenant_id, basis_id, milestone_id)
        WHERE status <> 'void'
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS right_hand_invoice_ledger_basis_idx ON right_hand_invoice_ledger (tenant_id, basis_id, issued_at DESC)');
    })();
    return ready;
  };

  const writeSql = `
    INSERT INTO right_hand_invoice_ledger
      (tenant_id, ledger_id, basis_id, invoice_id, estimate_id, proposal_id, milestone_id, milestone_kind, amount_cents, status, issued_at, ledger_row)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT (tenant_id, ledger_id) DO NOTHING
    RETURNING ledger_row
  `;

  return {
    async issue(input) {
      await ensureReady();
      const row = toRow(input, 'issued');
      try {
        const inserted = await pool.query(writeSql, [
          row.tenant_id,
          row.ledger_id,
          row.basis_id,
          row.invoice_id,
          row.estimate_id,
          row.proposal_id,
          row.milestone_id,
          row.milestone_kind,
          row.amount_cents,
          row.status,
          row.issued_at,
          JSON.stringify(row),
        ]);
        const insertedRow = parseRow(inserted.rows[0]?.ledger_row);
        if (insertedRow) return insertedRow;
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
          throw new InvoiceLedgerConflictError();
        }
        throw err;
      }

      const existing = await this.read(row.tenant_id, row.ledger_id);
      if (existing?.status === 'issued') throw new InvoiceLedgerConflictError();
      if (!existing || existing.status !== 'void') throw new InvoiceLedgerConflictError();

      const updated = await pool.query(
        `UPDATE right_hand_invoice_ledger
         SET basis_id=$3, invoice_id=$4, estimate_id=$5, proposal_id=$6, milestone_id=$7, milestone_kind=$8,
             amount_cents=$9, status='issued', issued_at=$10, ledger_row=$11::jsonb
         WHERE tenant_id=$1 AND ledger_id=$2 AND status='void'
         RETURNING ledger_row`,
        [
          row.tenant_id,
          row.ledger_id,
          row.basis_id,
          row.invoice_id,
          row.estimate_id,
          row.proposal_id,
          row.milestone_id,
          row.milestone_kind,
          row.amount_cents,
          row.issued_at,
          JSON.stringify(row),
        ],
      );
      const updatedRow = parseRow(updated.rows[0]?.ledger_row);
      if (!updatedRow) throw new InvoiceLedgerConflictError();
      return updatedRow;
    },
    async void(tenant, ledgerId) {
      await ensureReady();
      const existing = await this.read(tenant, ledgerId);
      if (!existing) return null;
      const next = { ...existing, status: 'void' as const };
      const updated = await pool.query(
        `UPDATE right_hand_invoice_ledger
         SET status='void', ledger_row=$3::jsonb
         WHERE tenant_id=$1 AND ledger_id=$2
         RETURNING ledger_row`,
        [tenant, ledgerId, JSON.stringify(next)],
      );
      return parseRow(updated.rows[0]?.ledger_row);
    },
    async read(tenant, ledgerId) {
      await ensureReady();
      const res = await pool.query(
        'SELECT ledger_row FROM right_hand_invoice_ledger WHERE tenant_id = $1 AND ledger_id = $2',
        [tenant, ledgerId],
      );
      const row = parseRow(res.rows[0]?.ledger_row);
      return row?.tenant_id === tenant ? row : null;
    },
    async listForBasis(tenant, basisId) {
      await ensureReady();
      const res = await pool.query(
        'SELECT ledger_row FROM right_hand_invoice_ledger WHERE tenant_id = $1 AND basis_id = $2 ORDER BY issued_at ASC',
        [tenant, basisId],
      );
      return res.rows.map((row) => parseRow(row.ledger_row)).filter((row): row is InvoiceLedgerRow => row?.tenant_id === tenant);
    },
    async listForMilestone(tenant, basisId, milestoneId) {
      await ensureReady();
      const res = await pool.query(
        'SELECT ledger_row FROM right_hand_invoice_ledger WHERE tenant_id = $1 AND basis_id = $2 AND milestone_id = $3 ORDER BY issued_at ASC',
        [tenant, basisId, milestoneId],
      );
      return res.rows.map((row) => parseRow(row.ledger_row)).filter((row): row is InvoiceLedgerRow => row?.tenant_id === tenant);
    },
    async sumIssuedForBasis(tenant, basisId) {
      const rows = await this.listForBasis(tenant, basisId);
      return rows.filter(active).reduce((sum, row) => sum + row.amount_cents, 0);
    },
    async sumIssuedForMilestone(tenant, basisId, milestoneId) {
      const rows = await this.listForMilestone(tenant, basisId, milestoneId);
      return rows.filter(active).reduce((sum, row) => sum + row.amount_cents, 0);
    },
  };
}

let cachedInvoiceLedgerStore: InvoiceLedgerStore | null = null;

export function getInvoiceLedgerStore(): InvoiceLedgerStore {
  if (cachedInvoiceLedgerStore) return cachedInvoiceLedgerStore;
  const connectionString = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required for shared invoice ledger');
  cachedInvoiceLedgerStore = createPgInvoiceLedgerStore(connectionString);
  return cachedInvoiceLedgerStore;
}

export function resetInvoiceLedgerStoreForTests(): void {
  cachedInvoiceLedgerStore = null;
}
