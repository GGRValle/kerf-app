/**
 * Lane 2 · Surface registration (Contract 2 · registerSurface, D-060).
 *
 * Declares this lane's surfaces against Lane 1's frozen registry contract so
 * that when the shell consumes the registry the Sales/Design/KB/Estimate
 * surfaces appear with correct domain, role scope, and a mandatory backTo
 * (every non-home surface). No query strings in any route (Bar 2: no PII in URLs).
 */
import type {
  RegisterSurfaceInput,
  SurfaceRegistry,
  RegisteredSurface,
} from '../contracts/lane1/registerSurface.js';

export const LANE2_SURFACES: readonly RegisterSurfaceInput[] = [
  { domain: 'sales', route: '/sales', roleScope: ['owner', 'pm', 'admin_ops'], component: 'sales/pipeline', backTo: '/' },
  { domain: 'sales', route: '/sales/:id', roleScope: ['owner', 'pm', 'admin_ops'], component: 'sales/deal', backTo: '/sales' },
  { domain: 'sales', route: '/design/:projectId', roleScope: ['owner', 'pm', 'admin_ops'], component: 'design/workspace', backTo: '/sales' },
  { domain: 'sales', route: '/library', roleScope: ['owner', 'pm', 'admin_ops'], component: 'kb/library', backTo: '/' },
  { domain: 'sales', route: '/estimate/:projectId', roleScope: ['owner', 'pm', 'admin_ops'], component: 'estimate/builder', backTo: '/design/:projectId' },
];

/** Register all Lane 2 surfaces into a registry; returns the registered set. */
export function registerLane2Surfaces(registry: SurfaceRegistry): readonly RegisteredSurface[] {
  return LANE2_SURFACES.map((s) => registry.register(s));
}
