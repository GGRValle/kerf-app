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

/** Sales · Design · Knowledge Base · Estimate — the "price it, propose it" surfaces. */
export const LANE2_SURFACES: readonly RegisterSurfaceInput[] = [
  { domain: 'sales', route: '/sales', roleScope: ['owner', 'pm', 'admin_ops'], component: 'sales/pipeline', backTo: '/' },
  { domain: 'sales', route: '/sales/:id', roleScope: ['owner', 'pm', 'admin_ops'], component: 'sales/deal', backTo: '/sales' },
  { domain: 'sales', route: '/design/:projectId', roleScope: ['owner', 'pm', 'admin_ops'], component: 'design/workspace', backTo: '/sales' },
  { domain: 'sales', route: '/library', roleScope: ['owner', 'pm', 'admin_ops'], component: 'kb/library', backTo: '/' },
  { domain: 'sales', route: '/estimate/:projectId', roleScope: ['owner', 'pm', 'admin_ops'], component: 'estimate/builder', backTo: '/design/:projectId' },
];

/**
 * Clients CRM · Client Portal preview · Client Success · Warranty — the folded-in
 * lane-3 slice, registered here with mandatory backTo (post-#287 conformance pass).
 *
 * The CLIENT-facing portal door (`/portal`, `/portal/s/:token`) is intentionally
 * NOT registered here: it is not an operator shell surface (no role projection /
 * sidebar entry) — it is the client's own authenticated door, a separate tier.
 */
export const LANE2_CLIENT_SURFACES: readonly RegisterSurfaceInput[] = [
  { domain: 'clients', route: '/clients/:id', roleScope: ['owner', 'pm', 'admin_ops'], component: 'clients/record', backTo: '/clients' },
  { domain: 'clients', route: '/clients/:id/warranty', roleScope: ['owner', 'pm', 'admin_ops'], component: 'clients/warranty', backTo: '/clients/:id' },
  { domain: 'clients', route: '/projects/:id/portal-preview', roleScope: ['owner', 'pm', 'admin_ops'], component: 'clients/portal-preview', backTo: '/projects/:id' },
  { domain: 'client_success', route: '/client-success', roleScope: ['owner', 'pm', 'admin_ops'], component: 'client-success/index', backTo: '/' },
  { domain: 'client_success', route: '/client-success/:clientId', roleScope: ['owner', 'pm', 'admin_ops'], component: 'client-success/detail', backTo: '/client-success' },
];

/** The full set this lane owns (sales spine + folded-in clients/portal/success). */
export const LANE2_ALL_SURFACES: readonly RegisterSurfaceInput[] = [
  ...LANE2_SURFACES,
  ...LANE2_CLIENT_SURFACES,
];

/** Register all Lane 2 (Win the Work) surfaces into a registry; returns the registered set. */
export function registerLane2Surfaces(registry: SurfaceRegistry): readonly RegisteredSurface[] {
  return LANE2_ALL_SURFACES.map((s) => registry.register(s));
}
