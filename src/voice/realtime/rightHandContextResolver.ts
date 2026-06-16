import type { SurfaceContext } from '../../app/lib/surfaceContext.js';

export type RightHandResolutionStatus = 'ready_with_gap' | 'needs_specific_context';

export interface RightHandProposalResolution {
  readonly status: RightHandResolutionStatus;
  readonly routed: string;
  readonly creating: string;
  readonly needs: string;
  readonly href: string | null;
  readonly carried_line_ids: readonly string[];
  readonly working_set: readonly string[];
  readonly searched_subfiles: readonly string[];
  readonly confidence_policy: 'go_deep_then_ask_specific_gap';
}

const DEEP_SUBFILES = [
  'pricing_library',
  'past_similar_jobs',
  'durable_project_graph',
  'source_artifacts',
] as const;

export function resolveProposalProjectionFromContext(
  context: SurfaceContext | null,
): RightHandProposalResolution {
  const lineIds = context?.line_ids ?? context?.previous?.ids.line_ids ?? [];
  const estimateId = context?.estimate_id ?? context?.previous?.ids.estimate_id;
  const proposalId = context?.proposal_id ?? estimateId;
  const hasEstimateContext =
    (context?.surface === 'estimate' || context?.previous?.surface === 'estimate') &&
    Boolean(estimateId) &&
    lineIds.length > 0;

  if (hasEstimateContext && proposalId) {
    return {
      status: 'ready_with_gap',
      routed: `Proposal preview from estimate ${estimateId}`,
      creating: `Proposal projection carrying ${lineIds.length} estimate line${lineIds.length === 1 ? '' : 's'}`,
      needs: 'One specific gap if still missing: appliance allowance price.',
      href: `/proposals/${encodeURIComponent(proposalId)}/preview?src=voice&from=estimate-context`,
      carried_line_ids: lineIds,
      working_set: ['current_surface_tag', 'active_line_ids', 'recent_operator_turns'],
      searched_subfiles: DEEP_SUBFILES,
      confidence_policy: 'go_deep_then_ask_specific_gap',
    };
  }

  return {
    status: 'needs_specific_context',
    routed: 'Proposal preview once an estimate tag is available',
    creating: 'No artifact yet — context is too thin to project safely',
    needs: 'Open the estimate or name the estimate id; I will not guess.',
    href: null,
    carried_line_ids: [],
    working_set: ['current_surface_tag', 'recent_operator_turns'],
    searched_subfiles: DEEP_SUBFILES,
    confidence_policy: 'go_deep_then_ask_specific_gap',
  };
}
