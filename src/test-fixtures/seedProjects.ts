import type { EntityId } from '../blackboard/types';
import type { Cents } from '../blackboard/types';
import type { Brand } from '../shared/money';

export interface SeedProject {
  id: EntityId;
  label: string;
  brand: Brand;
  budgetCents: Cents;
}

export const PROJECTS = {
  clemKitchen: {
    id: 'proj_clem_kitchen',
    label: 'Clem Kitchen Remodel',
    brand: 'GGR',
    budgetCents: 9_500_000, // $95,000.00
  },
  coringBath: {
    id: 'proj_coring_bath',
    label: 'Coring Primary Bath',
    brand: 'GGR',
    budgetCents: 4_200_000, // $42,000.00
  },
  mooreCabinet: {
    id: 'proj_moore_cabinet',
    label: 'Moore Cabinet Run',
    brand: 'Valle',
    budgetCents: 2_800_000, // $28,000.00
  },
} as const satisfies Record<string, SeedProject>;

export type ProjectKey = keyof typeof PROJECTS;
