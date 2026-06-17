/**
 * Lane C · Builder prefill fixtures.
 *  - Change Order (F-CHG1) is project-known: Customer + Project # prefill.
 *  - Estimate (F-EST1) is lead-capture: no project yet (assigned on save).
 * Display substrate only; no money write.
 */
import type { BuilderSettings } from './builderEngine.js';

export interface BuilderProjectPrefill {
  readonly project_id: string;
  readonly project_number: string;
  readonly project_name: string;
  readonly customer_name: string;
  readonly customer_client_id: string;
}

export const BUILDER_PROJECTS: readonly BuilderProjectPrefill[] = [
  {
    project_id: 'prj_014',
    project_number: 'PRJ-014',
    project_name: 'Pantry conversion',
    customer_name: 'Hernández, María',
    customer_client_id: 'client_hernandez',
  },
  {
    project_id: 'proj_wegrzyn_kitchen',
    project_number: 'PRJ-018',
    project_name: 'Kitchen + Primary bath',
    customer_name: 'Wegrzyn, Mark & Grace',
    customer_client_id: 'client_wegrzyn',
  },
];

export function getBuilderProject(projectId: string | null | undefined): BuilderProjectPrefill | null {
  if (!projectId) return null;
  return BUILDER_PROJECTS.find((p) => p.project_id === projectId) ?? null;
}

/** Default project-known door target (the founder's path-truth demo). */
export const DEFAULT_CHANGE_ORDER_PROJECT_ID = 'prj_014';

/**
 * GGR operating defaults — embedded 35% GM, CA tax on taxable base.
 * `can_view_markup` is operator-true; the client document forces it false.
 */
export const GGR_BUILDER_SETTINGS: Partial<BuilderSettings> = {
  markup_pct: 35,
  tax_pct: 7.75,
  discount_cents: 0,
  can_view_markup: true,
};
