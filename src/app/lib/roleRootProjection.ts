/**
 * Lane 0.2 · Role-root projection wrapper.
 */
import type { RoleRootContext, RoleRoot } from './layout-props.js';

export const LAYER_A_DOMAIN_IDS = [
  'home', 'start', 'sales', 'projects', 'schedule', 'money', 'team_ops', 'marketing',
  'settings', 'audit', 'capture', 'field', 'comms', 'clients', 'hr', 'purchasing',
  'reports', 'margin', 'work_orders', 'invoices', 'time',
] as const;

export type LayerADomainId = (typeof LAYER_A_DOMAIN_IDS)[number];
export const ROLE_ROOTS: readonly RoleRoot[] = ['owner', 'pm', 'admin_ops', 'field_hand', 'sub'] as const;

export interface BusinessGraphSlice { readonly availableDomains: readonly LayerADomainId[]; }
export interface RoleSurfaceCapabilities {
  readonly moneyWrite: boolean; readonly moneyRead: boolean; readonly marginVisible: boolean;
  readonly portfolioProjects: boolean; readonly salesVisible: boolean; readonly marketingVisible: boolean;
}
export interface RoleProjectedSurface<T> {
  readonly context: RoleRootContext;
  readonly visibleDomains: readonly LayerADomainId[];
  readonly hiddenDomains: readonly LayerADomainId[];
  readonly capabilities: RoleSurfaceCapabilities;
  readonly payload: T;
}

const ALL_DOMAINS: readonly LayerADomainId[] = LAYER_A_DOMAIN_IDS;
const ROLE_VISIBLE: Record<RoleRoot, readonly LayerADomainId[]> = {
  owner: ALL_DOMAINS,
  pm: ['home','start','projects','schedule','money','team_ops','settings','field','comms','clients','capture'],
  admin_ops: ['home','start','projects','schedule','money','team_ops','settings','audit','hr','purchasing','reports','comms'],
  field_hand: ['home','capture','schedule','time','work_orders','comms','settings'],
  sub: ['home','work_orders','invoices','comms','settings'],
};
const ROLE_CAPABILITIES: Record<RoleRoot, RoleSurfaceCapabilities> = {
  owner: { moneyWrite: true, moneyRead: true, marginVisible: true, portfolioProjects: true, salesVisible: true, marketingVisible: true },
  pm: { moneyWrite: false, moneyRead: true, marginVisible: false, portfolioProjects: true, salesVisible: false, marketingVisible: false },
  admin_ops: { moneyWrite: true, moneyRead: true, marginVisible: false, portfolioProjects: true, salesVisible: false, marketingVisible: false },
  field_hand: { moneyWrite: false, moneyRead: false, marginVisible: false, portfolioProjects: false, salesVisible: false, marketingVisible: false },
  sub: { moneyWrite: false, moneyRead: false, marginVisible: false, portfolioProjects: false, salesVisible: false, marketingVisible: false },
};
export const ROLE_HOME_WIREFRAMES: Record<RoleRoot, string> = {
  owner: 'F-A1 / F-A2', pm: 'F-P1 / F-P2', admin_ops: 'F-AO1 / F-AO2', field_hand: 'F-C1', sub: 'F-SH1 / F-SH2',
};

function intersectDomains(available: readonly LayerADomainId[], allowed: readonly LayerADomainId[]): LayerADomainId[] {
  const allowedSet = new Set(allowed);
  return available.filter((d) => allowedSet.has(d));
}

export function projectForRole<T>(graph: BusinessGraphSlice, context: RoleRootContext, payload: T): RoleProjectedSurface<T> {
  const allowed = ROLE_VISIBLE[context.roleRoot];
  const visibleDomains = intersectDomains(graph.availableDomains, allowed);
  const visibleSet = new Set(visibleDomains);
  return {
    context,
    visibleDomains,
    hiddenDomains: graph.availableDomains.filter((d) => !visibleSet.has(d)),
    capabilities: ROLE_CAPABILITIES[context.roleRoot],
    payload,
  };
}

export const DEFAULT_BUSINESS_GRAPH_SLICE: BusinessGraphSlice = { availableDomains: ALL_DOMAINS };
