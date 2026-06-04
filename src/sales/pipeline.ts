/**
 * Lane 2 · Sales pipeline (F-SL*) — leads/deals and the stage ladder.
 * The whole point: move a lead toward a priced, proposable job.
 */
import type { Deal, DealStage } from './types.js';

const STAGE_LABELS: Record<DealStage, string> = {
  new: 'New lead',
  qualifying: 'Qualifying',
  design: 'Design',
  estimating: 'Estimating',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

export function dealStageLabel(stage: DealStage): string {
  return STAGE_LABELS[stage];
}

/** Enter Design: stamps the working project id and moves the deal to `design`. */
export function enterDesign(deal: Deal, projectId: string): Deal {
  return { ...deal, stage: 'design', project_id: projectId };
}

/** Move a deal to a later stage (no skipping backwards into terminal states). */
export function setDealStage(deal: Deal, stage: DealStage): Deal {
  return { ...deal, stage };
}

/** Group deals into pipeline columns for the board view. */
export function pipelineColumns(
  deals: readonly Deal[],
): ReadonlyArray<{ readonly stage: DealStage; readonly label: string; readonly deals: readonly Deal[] }> {
  const order: readonly DealStage[] = ['new', 'qualifying', 'design', 'estimating', 'proposal', 'won'];
  return order.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    deals: deals.filter((d) => d.stage === stage),
  }));
}
