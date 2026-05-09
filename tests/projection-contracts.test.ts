import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_PDF_FORBIDDEN_FIELDS,
  ESTIMATE_PROJECTION_KINDS,
  PROJECTION_CONTRACTS,
  PROJECTION_CONTRACT_CANON,
  WORK_ORDER_ALLOWED_COMPONENT_FIELDS,
  WORK_ORDER_ALLOWED_LINE_FIELDS,
  WORK_ORDER_ALLOWLIST_CANON,
  buildClientPdfProjection,
  buildEstimateBuildProjection,
  buildProposalReviewProjection,
  buildWorkOrderProjection,
  projectEstimate,
  type CanonicalEstimateRecord,
  type WorkOrderComponentView,
  type WorkOrderLineView,
} from '../src/projections/index.js';

const FORBIDDEN_CLIENT_OR_FIELD_SURFACE_TOKENS = [
  'raw_cost',
  'sell_total',
  'markup',
  'gm_pct',
  'margin_cents',
  'performer_profitability',
  'variance_band',
  'validator_metadata',
  'internal_notes',
  'cohort',
  'pricing_intelligence',
] as const;

function canonicalEstimate(): CanonicalEstimateRecord {
  return {
    estimate_id: 'estimate_1',
    project_id: 'project_1',
    version: 7,
    project_understanding: {
      summary: 'Kitchen remodel with cabinet refacing and stone counters.',
      client_opening_text: 'We will remodel the kitchen in two phases.',
      field_shortened_text: 'Kitchen remodel: protect floors, verify cabinet run before release.',
      internal_notes: 'Owner-only internal note with raw_cost and margin detail.',
    },
    assumptions: ['Existing plumbing remains in place.'],
    internal_notes: 'Estimator margin strategy stays internal.',
    validator_metadata: { v7: 'source basis', v8: 'confidence band' },
    lines: [
      {
        line_id: 'line_cabinets',
        sort_order: 1,
        description: 'Cabinetry package',
        scope_tag: 'cabinetry',
        location_refs: ['kitchen_north_wall'],
        allowance_status: 'selection_pending',
        raw_cost_cents: 800_000,
        markup_cents: 240_000,
        margin_cents: 240_000,
        gm_pct: 0.23,
        sell_total_cents: 1_040_000,
        sub_bid_total_cents: 780_000,
        variance_band: 'LOW',
        cohort: 'valle_cabinetry_only',
        source_kind: 'lidar_takeoff',
        source_refs: [{ kind: 'external', uri: 'kerf://source/cabinet-run' }],
        performer_id: 'sub_secret_cabinet_shop',
        performer_kind: 'subcontractor',
        performer_profitability_cents: 120_000,
        pricing_intelligence: { comparable_count: 5 },
        validator_metadata: { validator: 'V8', note: 'confidence metadata' },
        internal_notes: 'Do not expose raw_cost, markup, or performer profitability.',
        operator_notes: 'PM can discuss selection timing.',
        client_notes: 'Final cabinet finish to be selected.',
        field_notes: 'Protect appliance openings; verify face-frame dimensions.',
        allowances: [
          {
            allowance_id: 'allowance_finish',
            label: 'Cabinet finish selection',
            amount_cents: 50_000,
            status: 'selection_pending',
            internal_notes: 'Allowance buyout strategy stays internal.',
          },
        ],
        exclusions: [
          {
            exclusion_id: 'exclusion_appliances',
            label: 'Appliances supplied by owner',
            internal_notes: 'Do not show exclusion negotiation notes.',
          },
        ],
        components: [
          {
            component_id: 'component_base_run',
            description: 'Base cabinet run',
            scope_tag: 'cabinetry',
            quantity: 14,
            unit: 'linear_ft',
            location_refs: ['kitchen_north_wall'],
            release_category: 'cabinetry',
            quantity_source: 'scan_derived',
            quantity_use_label: 'verify_before_release',
            release_requirement: 'laser_verify',
            verification_status: 'pending',
            source_metric_id: 'metric_cabinet_base_run',
            raw_cost_cents: 400_000,
            sell_total_cents: 520_000,
            performer_id: 'sub_secret_cabinet_shop',
            performer_kind: 'subcontractor',
            performer_profitability_cents: 75_000,
            internal_notes: 'Component raw cost must not enter WorkOrder.',
            source_refs: [{ kind: 'external', uri: 'kerf://source/component' }],
          },
        ],
      },
    ],
  };
}

test('projection contracts expose the four V1.5 read-view surfaces and canon lines', () => {
  assert.deepEqual([...ESTIMATE_PROJECTION_KINDS], [
    'estimate_build',
    'proposal_review',
    'client_pdf',
    'work_order',
  ]);
  assert.equal(
    PROJECTION_CONTRACT_CANON,
    'Projections are generated read views over canonical estimate/scope records, not copied records with fields stripped after the fact.',
  );
  assert.equal(
    WORK_ORDER_ALLOWLIST_CANON,
    'WorkOrder is allowlist-first. If a field is not explicitly allowed, it does not render.',
  );
  assert.deepEqual(
    PROJECTION_CONTRACTS.map((contract) => contract.kind),
    ['estimate_build', 'proposal_review', 'client_pdf', 'work_order'],
  );
});

test('Internal Build projection can show full financial and operator detail', () => {
  const projection = buildEstimateBuildProjection(canonicalEstimate());
  const line = projection.estimate.lines[0];

  assert.equal(projection.projection_kind, 'estimate_build');
  assert.equal(line?.raw_cost_cents, 800_000);
  assert.equal(line?.markup_cents, 240_000);
  assert.equal(line?.gm_pct, 0.23);
  assert.equal(line?.performer_id, 'sub_secret_cabinet_shop');
  assert.equal(line?.performer_profitability_cents, 120_000);
  assert.equal(line?.variance_band, 'LOW');
  assert.deepEqual(line?.validator_metadata, { validator: 'V8', note: 'confidence metadata' });
  assert.equal(line?.internal_notes, 'Do not expose raw_cost, markup, or performer profitability.');
});

test('Proposal Review projection shows operator detail by role', () => {
  const estimate = canonicalEstimate();
  const ownerLine = buildProposalReviewProjection(estimate, 'owner').lines[0];
  const pmLine = buildProposalReviewProjection(estimate, 'pm').lines[0];
  const salesLine = buildProposalReviewProjection(estimate, 'sales').lines[0];

  assert.equal(ownerLine?.raw_cost_cents, 800_000);
  assert.equal(ownerLine?.gm_pct, 0.23);
  assert.equal(ownerLine?.performer_id, 'sub_secret_cabinet_shop');

  assert.equal(pmLine?.raw_cost_cents, undefined);
  assert.equal(pmLine?.gm_pct, undefined);
  assert.equal(pmLine?.margin_status, 'watch');
  assert.equal(pmLine?.performer_id, 'sub_secret_cabinet_shop');

  assert.equal(salesLine?.raw_cost_cents, undefined);
  assert.equal(salesLine?.gm_pct, undefined);
  assert.equal(salesLine?.margin_status, 'watch');
  assert.equal(salesLine?.performer_id, undefined);
});

test('Client PDF projection strips raw cost, margin, markup, validator metadata, variance, and internal notes', () => {
  const projection = buildClientPdfProjection(canonicalEstimate());
  const payload = JSON.stringify(projection);

  assert.equal(projection.projection_kind, 'client_pdf');
  assert.equal(projection.lines[0]?.amount_cents, 1_040_000);
  assert.deepEqual(projection.lines[0]?.selections, ['Cabinet finish selection']);
  assert.deepEqual(projection.lines[0]?.not_included, ['Appliances supplied by owner']);
  for (const forbidden of CLIENT_PDF_FORBIDDEN_FIELDS) {
    assert.equal(payload.includes(forbidden), false, `${forbidden} should be stripped`);
  }
  for (const forbidden of FORBIDDEN_CLIENT_OR_FIELD_SURFACE_TOKENS) {
    assert.equal(payload.includes(forbidden), false, `${forbidden} text should not leak`);
  }
});

test('WorkOrder projection is built from a positive allowlist of field-safe scope data', () => {
  const estimate = canonicalEstimate() as CanonicalEstimateRecord & {
    lines: Array<CanonicalEstimateRecord['lines'][number] & { dangerous_future_field?: string }>;
  };
  estimate.lines[0] = {
    ...estimate.lines[0],
    dangerous_future_field: 'future internal margin field',
  };

  const projection = buildWorkOrderProjection(estimate);
  const line = projection.lines[0] as WorkOrderLineView | undefined;
  const component = line?.components[0] as WorkOrderComponentView | undefined;
  const payload = JSON.stringify(projection);

  assert.ok(line);
  assert.ok(component);
  assert.deepEqual(Object.keys(line).sort(), [...WORK_ORDER_ALLOWED_LINE_FIELDS].sort());
  assert.deepEqual(Object.keys(component).sort(), [...WORK_ORDER_ALLOWED_COMPONENT_FIELDS].sort());
  assert.equal(line.performer_kind, 'subcontractor');
  assert.equal(component.quantity_use_label, 'verify_before_release');
  assert.equal(component.release_requirement, 'laser_verify');
  assert.equal(component.source_metric_id, 'metric_cabinet_base_run');
  assert.equal(payload.includes('sub_secret_cabinet_shop'), false);
  assert.equal(payload.includes('future internal margin field'), false);
  for (const forbidden of FORBIDDEN_CLIENT_OR_FIELD_SURFACE_TOKENS) {
    assert.equal(payload.includes(forbidden), false, `${forbidden} should not appear in WorkOrder`);
  }
});

test('projection read views reflect canonical estimate edits on the next render', () => {
  const estimate = canonicalEstimate();
  const first = buildWorkOrderProjection(estimate);
  const edited: CanonicalEstimateRecord = {
    ...estimate,
    lines: [
      {
        ...estimate.lines[0]!,
        description: 'Updated approved cabinetry scope',
      },
    ],
  };
  const second = buildWorkOrderProjection(edited);

  assert.equal(first.lines[0]?.description, 'Cabinetry package');
  assert.equal(second.lines[0]?.description, 'Updated approved cabinetry scope');
});

test('projectEstimate dispatches each projection without UI or persistence coupling', () => {
  const estimate = canonicalEstimate();

  assert.equal(projectEstimate(estimate, { kind: 'estimate_build' }).projection_kind, 'estimate_build');
  assert.equal(
    projectEstimate(estimate, { kind: 'proposal_review', audience_role: 'pm' }).projection_kind,
    'proposal_review',
  );
  assert.equal(projectEstimate(estimate, { kind: 'client_pdf' }).projection_kind, 'client_pdf');
  assert.equal(projectEstimate(estimate, { kind: 'work_order' }).projection_kind, 'work_order');
});
