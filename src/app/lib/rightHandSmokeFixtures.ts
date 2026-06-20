/**
 * Smoke-only seed for the per-job Money / Invoice surfaces (#404 follow-up).
 *
 * The RH estimate store is Postgres-backed and carries no estimate after a fresh
 * deploy, so the deposit/progress/final money face cannot be phone-verified
 * post-deploy. This is a DEMAND-DRIVEN, TENANT-SCOPED fixture — mirroring the
 * proposal-fixture precedent (lane6Fixtures) — that the money + invoice pages
 * fall back to ONLY for one stable smoke estimate id. It writes NOTHING: no
 * store row, no ledger row, no issue/send/money-write. It is a graduated,
 * read-only estimate basis the projection renders client-authoritative.
 *
 * Stable URLs (graduated estimate, gate.allowed — deposit + final bill):
 *   /estimate/proj_wegrzyn_kitchen/money?estimate_id=rhe_smoke_wegrzyn
 *   /estimate/proj_wegrzyn_kitchen/invoice?estimate_id=rhe_smoke_wegrzyn
 */
import type { PersistenceTenantId } from '../../persistence/events.js';
import type {
  RightHandEstimateDraft,
  RightHandEstimateLine,
} from '../../api/lib/rightHandAssemblyStore.js';

export const SMOKE_ESTIMATE_ID = 'rhe_smoke_wegrzyn';
export const SMOKE_PROJECT_ID = 'proj_wegrzyn_kitchen';
const SMOKE_TENANT: PersistenceTenantId = 'tenant_ggr';
// Static stamp — fixtures stay deterministic (no Date.now()).
const STAMP = '2026-06-18T00:00:00.000Z';

// Each line is operator-graduated company data (tier 'company', source_type
// 'company_data', flag 'operator_graduated') so the proposal/invoice render
// fence treats it as client-authoritative and the gate is allowed. Labels carry
// no internal vocabulary (the projection's render fence rejects it).
function smokeLine(
  id: string,
  label: string,
  description: string,
  division: { readonly code: string; readonly label: string },
  cents: number,
): RightHandEstimateLine {
  return {
    id,
    label,
    description,
    source_type: 'company_data',
    source_label: 'Company data',
    source_ref: `operator-approval:smoke-seed:${id}`,
    open_item: false,
    flags: ['operator_graduated', 'approved_for_this_estimate'],
    tier: 'company',
    division: { code: division.code, label: division.label, subtotal_cents: cents },
    quantity: 1,
    uom: 'LS',
    unit_cents: cents,
    extended_cents: cents,
  };
}

function buildSmokeDraft(): RightHandEstimateDraft {
  const lines: readonly RightHandEstimateLine[] = [
    smokeLine(
      'rhl_smoke_cabinets',
      'Kitchen base + wall cabinets — furnish and install',
      'Semi-custom cabinetry per plan, delivered and installed.',
      { code: 'KD-04', label: 'Cabinetry + millwork' },
      3_200_000,
    ),
    smokeLine(
      'rhl_smoke_counters',
      'Quartz countertops — fabricate and install',
      'Quartz countertops templated, fabricated, and set.',
      { code: 'KD-06', label: 'Countertops' },
      1_800_000,
    ),
  ];
  // total = $50,000 → §7159 down payment = min($1,000, 10%) = $1,000; final = $49,000.
  return {
    version: 2,
    tenant_id: SMOKE_TENANT,
    anchor_type: 'project',
    project_id: SMOKE_PROJECT_ID,
    estimate_id: SMOKE_ESTIMATE_ID,
    conversation_id: 'rhconv_smoke_wegrzyn',
    title: 'Wegrzyn kitchen remodel',
    status: 'draft_for_review',
    updated_at: STAMP,
    route: `/estimate/${SMOKE_PROJECT_ID}?estimate_id=${SMOKE_ESTIMATE_ID}`,
    lines,
    open_items: [],
    open_questions: [],
    source_refs: ['operator-approval:smoke-seed'],
    estimator_response: {
      line_items: [],
      itemized_lines: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Smoke-demo estimate for verifying the per-job Money / Invoice surface after deploy.',
    },
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    pricing_data_label: 'Operator-approved estimate pricing — review before file/send',
    artifact_state: { durable_record: true, filed: false, sent: false },
  };
}

const SMOKE_DRAFT = buildSmokeDraft();

/**
 * Returns the graduated smoke draft ONLY for the stable smoke estimate id under
 * its own tenant; null for any other id or tenant (so real estimates and other
 * tenants fall through to the real store untouched). Tenant-scoped by
 * construction — a different tenant hitting the smoke id gets null.
 */
export function getRightHandSmokeDraft(
  estimateId: string,
  tenant: PersistenceTenantId,
): RightHandEstimateDraft | null {
  if (estimateId !== SMOKE_ESTIMATE_ID) return null;
  if (tenant !== SMOKE_TENANT) return null;
  return SMOKE_DRAFT;
}
