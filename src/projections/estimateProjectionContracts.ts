import type {
  CanonicalEstimateRecord,
  ClientPdfLineView,
  ClientPdfProjection,
  EstimateBuildProjection,
  EstimateLineComponentRecord,
  EstimateLineRecord,
  EstimateProjection,
  EstimateProjectionRequest,
  MarginStatus,
  ProjectionContract,
  ProposalReviewAudienceRole,
  ProposalReviewLineView,
  ProposalReviewProjection,
  WorkOrderComponentView,
  WorkOrderLineView,
  WorkOrderProjection,
} from './estimateProjectionTypes.js';

export const PROJECTION_CONTRACT_CANON =
  'Projections are generated read views over canonical estimate/scope records, not copied records with fields stripped after the fact.';

export const WORK_ORDER_ALLOWLIST_CANON =
  'WorkOrder is allowlist-first. If a field is not explicitly allowed, it does not render.';

export const CLIENT_PDF_FORBIDDEN_FIELDS = [
  'raw_cost_cents',
  'margin_cents',
  'gm_pct',
  'markup_cents',
  'performer_id',
  'performer_profitability_cents',
  'variance_band',
  'validator_metadata',
  'internal_notes',
  'cohort',
  'source_kind',
  'pricing_intelligence',
] as const;

export const WORK_ORDER_ALLOWED_LINE_FIELDS = [
  'line_id',
  'sort_order',
  'description',
  'scope_tag',
  'location_refs',
  'performer_kind',
  'allowance_status',
  'field_notes',
  'components',
] as const;

export const WORK_ORDER_ALLOWED_COMPONENT_FIELDS = [
  'component_id',
  'description',
  'scope_tag',
  'quantity',
  'unit',
  'location_refs',
  'release_category',
  'quantity_source',
  'quantity_use_label',
  'release_requirement',
  'verification_status',
  'source_metric_id',
] as const;

export const PROJECTION_CONTRACTS: readonly ProjectionContract[] = [
  {
    kind: 'estimate_build',
    reads: ['estimate', 'line', 'line_component', 'allowance', 'exclusion', 'assumption', 'project_understanding'],
    transforms: [],
    strips: [],
  },
  {
    kind: 'proposal_review',
    reads: ['estimate', 'line', 'line_component', 'allowance', 'exclusion', 'assumption', 'project_understanding'],
    transforms: ['gm_pct -> margin_status for non-owner operator roles'],
    strips: ['role-dependent raw cost, gm pct, and performer identity fields'],
  },
  {
    kind: 'client_pdf',
    reads: ['sell_total_cents', 'line.description', 'allowance', 'exclusion', 'project_understanding'],
    transforms: ['allowance -> selections', 'exclusion -> not_included'],
    strips: CLIENT_PDF_FORBIDDEN_FIELDS,
  },
  {
    kind: 'work_order',
    reads: ['line.description', 'line.location_refs', 'line_component', 'allowance_status', 'project_understanding.field_shortened_text'],
    transforms: ['allowance_status -> field-safe status', 'performer_id -> performer_kind only'],
    allowlist: WORK_ORDER_ALLOWED_LINE_FIELDS,
  },
];

export function projectEstimate(
  estimate: CanonicalEstimateRecord,
  request: EstimateProjectionRequest,
): EstimateProjection {
  switch (request.kind) {
    case 'estimate_build':
      return buildEstimateBuildProjection(estimate);
    case 'proposal_review':
      return buildProposalReviewProjection(estimate, request.audience_role ?? 'owner');
    case 'client_pdf':
      return buildClientPdfProjection(estimate);
    case 'work_order':
      return buildWorkOrderProjection(estimate);
  }
}

export function buildEstimateBuildProjection(
  estimate: CanonicalEstimateRecord,
): EstimateBuildProjection {
  return {
    projection_kind: 'estimate_build',
    estimate: structuredClone(estimate),
  };
}

export function buildProposalReviewProjection(
  estimate: CanonicalEstimateRecord,
  audienceRole: ProposalReviewAudienceRole,
): ProposalReviewProjection {
  return {
    projection_kind: 'proposal_review',
    audience_role: audienceRole,
    estimate_id: estimate.estimate_id,
    project_id: estimate.project_id,
    version: estimate.version,
    project_understanding: structuredClone(estimate.project_understanding),
    lines: estimate.lines.map((line) => proposalReviewLine(line, audienceRole)),
  };
}

export function buildClientPdfProjection(
  estimate: CanonicalEstimateRecord,
): ClientPdfProjection {
  return {
    projection_kind: 'client_pdf',
    estimate_id: estimate.estimate_id,
    project_id: estimate.project_id,
    version: estimate.version,
    opening_text:
      estimate.project_understanding?.client_opening_text ??
      estimate.project_understanding?.summary,
    assumptions: [...(estimate.assumptions ?? [])],
    lines: estimate.lines.map(clientPdfLine),
  };
}

export function buildWorkOrderProjection(
  estimate: CanonicalEstimateRecord,
): WorkOrderProjection {
  return {
    projection_kind: 'work_order',
    estimate_id: estimate.estimate_id,
    project_id: estimate.project_id,
    version: estimate.version,
    project_understanding_field_text:
      estimate.project_understanding?.field_shortened_text ??
      estimate.project_understanding?.summary,
    lines: estimate.lines.map(workOrderLine),
  };
}

export function marginStatusFromGmPct(gmPct: number | undefined): MarginStatus | undefined {
  if (gmPct === undefined) return undefined;
  if (gmPct < 0.2) return 'needs_review';
  if (gmPct < 0.35) return 'watch';
  return 'healthy';
}

function proposalReviewLine(
  line: EstimateLineRecord,
  audienceRole: ProposalReviewAudienceRole,
): ProposalReviewLineView {
  const shared: ProposalReviewLineView = {
    line_id: line.line_id,
    sort_order: line.sort_order,
    description: line.description,
    scope_tag: line.scope_tag,
    location_refs: cloneArray(line.location_refs),
    allowance_status: line.allowance_status,
    allowances: cloneArray(line.allowances),
    exclusions: cloneArray(line.exclusions),
    components: cloneArray(line.components),
    sell_total_cents: line.sell_total_cents,
    markup_cents: line.markup_cents,
    margin_status: marginStatusFromGmPct(line.gm_pct),
    variance_band: line.variance_band,
    source_kind: line.source_kind,
    source_refs: cloneArray(line.source_refs),
    performer_kind: line.performer_kind,
    operator_notes: line.operator_notes,
  };

  if (audienceRole === 'owner') {
    return {
      ...shared,
      raw_cost_cents: line.raw_cost_cents,
      gm_pct: line.gm_pct,
      performer_id: line.performer_id,
      internal_notes: line.internal_notes,
      validator_metadata: structuredClone(line.validator_metadata),
    };
  }

  if (audienceRole === 'pm') {
    return {
      ...shared,
      performer_id: line.performer_id,
    };
  }

  return shared;
}

function clientPdfLine(line: EstimateLineRecord): ClientPdfLineView {
  return {
    line_id: line.line_id,
    sort_order: line.sort_order,
    description: line.description,
    amount_cents: line.sell_total_cents,
    selections: line.allowances?.map((allowance) => allowance.label),
    not_included: line.exclusions?.map((exclusion) => exclusion.label),
    client_notes: line.client_notes,
  };
}

function workOrderLine(line: EstimateLineRecord): WorkOrderLineView {
  return {
    line_id: line.line_id,
    sort_order: line.sort_order,
    description: line.description,
    scope_tag: line.scope_tag,
    location_refs: cloneArray(line.location_refs),
    performer_kind: line.performer_kind,
    allowance_status: line.allowance_status,
    field_notes: line.field_notes,
    components: (line.components ?? []).map(workOrderComponent),
  };
}

function workOrderComponent(
  component: EstimateLineComponentRecord,
): WorkOrderComponentView {
  return {
    component_id: component.component_id,
    description: component.description,
    scope_tag: component.scope_tag,
    quantity: component.quantity,
    unit: component.unit,
    location_refs: cloneArray(component.location_refs),
    release_category: component.release_category,
    quantity_source: component.quantity_source,
    quantity_use_label: component.quantity_use_label,
    release_requirement: component.release_requirement,
    verification_status: component.verification_status,
    source_metric_id: component.source_metric_id,
  };
}

function cloneArray<T>(items: readonly T[] | undefined): readonly T[] | undefined {
  return items === undefined ? undefined : structuredClone(items);
}
