import type { EntityId } from '../blackboard/types.js';
import type { Cents } from '../blackboard/types.js';
import type { Brand } from '../shared/money.js';
import type { ProjectTags } from '../projects/index.js';

export interface SeedProject {
  id: EntityId;
  label: string;
  brand: Brand;
  budgetCents: Cents;
  /**
   * Phase 0 intake tags. `project_type_tag` is required; `scope_tags` is
   * required as an array (may be empty at the very start of a project, but
   * is always present). Variance-band computation reads these to find
   * historical comparables. See `src/projects/types.ts` for the closed
   * taxonomies.
   */
  tags: ProjectTags;
}

export const PROJECTS = {
  clemKitchen: {
    id: 'proj_clem_kitchen',
    label: 'Clem Kitchen Remodel',
    brand: 'GGR',
    budgetCents: 9_500_000, // $95,000.00
    tags: {
      project_type_tag: 'kitchen_remodel',
      // Typical full-scope kitchen: demo, new electrical, plumbing rough,
      // drywall (light patching), tile backsplash, cabinets, countertops,
      // appliances install, finish plumbing fixtures, lighting, paint, LVP.
      scope_tags: [
        'demolition',
        'electrical',
        'plumbing',
        'drywall',
        'tile',
        'flooring',
        'cabinetry',
        'countertops',
        'appliances',
        'plumbing_fixtures',
        'lighting',
        'paint',
      ],
    },
  },
  coringBath: {
    id: 'proj_coring_bath',
    label: 'Coring Primary Bath',
    brand: 'GGR',
    budgetCents: 4_200_000, // $42,000.00
    tags: {
      project_type_tag: 'primary_bath_remodel',
      // Typical primary-bath remodel: demo, plumbing rework, drywall,
      // floor + wall tile, paint, finish plumbing fixtures, lighting.
      scope_tags: [
        'demolition',
        'plumbing',
        'drywall',
        'tile',
        'paint',
        'plumbing_fixtures',
        'lighting',
      ],
    },
  },
  mooreCabinet: {
    id: 'proj_moore_cabinet',
    label: 'Moore Cabinet Run',
    brand: 'Valle',
    budgetCents: 2_800_000, // $28,000.00
    tags: {
      project_type_tag: 'cabinetry_only',
      // Valle cabinetry-only job pulling in millwork for the matching
      // built-ins on the same run.
      scope_tags: ['cabinetry', 'millwork'],
    },
  },
} as const satisfies Record<string, SeedProject>;

export type ProjectKey = keyof typeof PROJECTS;
