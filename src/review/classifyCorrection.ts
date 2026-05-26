import type {
  CorrectionScope,
  EvidenceSourceClass,
  MemoryLocality,
  PersistenceTenantId,
} from '../persistence/events.js';

export type ReviewSurface = 'transcript.review' | 'draft.review';

export interface CorrectionClassifyInput {
  readonly surface: ReviewSurface;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly tenant_id: PersistenceTenantId;
  /** Operator answer to the one-question follow-up when inference is ambiguous. */
  readonly scope_answer?: CorrectionScope;
}

export interface ResolvedClassification {
  readonly correction_scope: CorrectionScope;
  readonly memory_locality: readonly MemoryLocality[];
  readonly evidence_source_class: EvidenceSourceClass;
  readonly classification_method: 'inferred' | 'operator_confirmed' | 'operator_overridden';
  readonly confidence: number;
}

export interface ClassificationNeedsFollowUp {
  readonly needs_follow_up: true;
  readonly follow_up_question_key: 'review.classify.scope_question';
  readonly candidate_scopes: readonly CorrectionScope[];
}

export interface ClassificationResolved {
  readonly needs_follow_up: false;
  readonly classification: ResolvedClassification;
}

export type ClassificationOutcome = ClassificationNeedsFollowUp | ClassificationResolved;

const METHODOLOGY_FIELDS = new Set([
  'scope_narrative',
  'line_description',
  'quantity_basis',
  'assumption',
  'transcript_segment',
]);

function tenantEvidenceClass(tenant_id: PersistenceTenantId): EvidenceSourceClass {
  switch (tenant_id) {
    case 'tenant_valle':
      return 'dogfood_valle';
    case 'tenant_hpg':
      return 'dogfood_hpg';
    default:
      return 'dogfood_ggr';
  }
}

function valuesDiffer(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function inferFromField(field: string, surface: ReviewSurface): ResolvedClassification | null {
  if (field === 'client_name' || field === 'project_address') {
    return {
      correction_scope: 'project_specific',
      memory_locality: ['tenant_private'],
      evidence_source_class: 'dogfood_ggr',
      classification_method: 'inferred',
      confidence: 0.92,
    };
  }
  if (surface === 'draft.review' && field.startsWith('line_amount_')) {
    return {
      correction_scope: 'one_off',
      memory_locality: ['tenant_private'],
      evidence_source_class: 'dogfood_ggr',
      classification_method: 'inferred',
      confidence: 0.88,
    };
  }
  return null;
}

function isAmbiguous(field: string, before: unknown, after: unknown): boolean {
  if (!METHODOLOGY_FIELDS.has(field)) {
    return false;
  }
  if (!valuesDiffer(before, after)) {
    return false;
  }
  const beforeText = typeof before === 'string' ? before.toLowerCase() : '';
  const afterText = typeof after === 'string' ? after.toLowerCase() : '';
  const methodologySignals = ['always', 'never', 'standard', 'typical', 'every job', 'all projects'];
  const jobSignals = ['this job', 'this kitchen', 'this bath', 'here', 'on site'];
  const hasMethodology = methodologySignals.some((s) => afterText.includes(s) || beforeText.includes(s));
  const hasJobSpecific = jobSignals.some((s) => afterText.includes(s) || beforeText.includes(s));
  return hasMethodology && hasJobSpecific;
}

function resolveFromScopeAnswer(
  scope_answer: CorrectionScope,
  tenant_id: PersistenceTenantId,
): ResolvedClassification {
  const memory_locality: MemoryLocality[] =
    scope_answer === 'universal' || scope_answer === 'tenant_wide'
      ? ['tenant_private', 'archetype_default_candidate']
      : ['tenant_private'];
  return {
    correction_scope: scope_answer,
    memory_locality,
    evidence_source_class: tenantEvidenceClass(tenant_id),
    classification_method: 'operator_confirmed',
    confidence: 1,
  };
}

/** Classify-before-harden: inferred path or one follow-up when ambiguous (D-048). */
export function classifyCorrection(input: CorrectionClassifyInput): ClassificationOutcome {
  if (input.scope_answer !== undefined) {
    return {
      needs_follow_up: false,
      classification: resolveFromScopeAnswer(input.scope_answer, input.tenant_id),
    };
  }

  if (isAmbiguous(input.field, input.before, input.after)) {
    return {
      needs_follow_up: true,
      follow_up_question_key: 'review.classify.scope_question',
      candidate_scopes: ['project_specific', 'universal', 'tenant_wide'],
    };
  }

  const inferred = inferFromField(input.field, input.surface);
  if (inferred !== null) {
    return {
      needs_follow_up: false,
      classification: {
        ...inferred,
        evidence_source_class: tenantEvidenceClass(input.tenant_id),
      },
    };
  }

  return {
    needs_follow_up: false,
    classification: {
      correction_scope: 'project_specific',
      memory_locality: ['tenant_private'],
      evidence_source_class: tenantEvidenceClass(input.tenant_id),
      classification_method: 'inferred',
      confidence: 0.78,
    },
  };
}

/** Guard confidence before persisting correction.classified. */
export function assertValidConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence must be a finite number in [0, 1]');
  }
}
