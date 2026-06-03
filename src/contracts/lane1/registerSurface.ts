import type { ShellBusinessDomain, ShellRoleRoot } from './domains.js';

/**
 * Contract 2 · registerSurface — back-button rule (D-060).
 * `backTo` is mandatory for every non-home surface; home surfaces omit it.
 */
export type SurfaceComponentRef = string;

export interface RegisterSurfaceInput {
  readonly domain: ShellBusinessDomain;
  /** App route path (no query strings — Bar 2: no PII in URLs). */
  readonly route: string;
  readonly roleScope: readonly ShellRoleRoot[];
  readonly component: SurfaceComponentRef;
  /** Required when `route` is not the role home (`/`). */
  readonly backTo?: string;
}

export interface RegisteredSurface extends RegisterSurfaceInput {
  readonly id: string;
  readonly isHome: boolean;
}

export interface SurfaceRegistry {
  register(input: RegisterSurfaceInput): RegisteredSurface;
  getByRoute(route: string): RegisteredSurface | undefined;
  listForRole(role: ShellRoleRoot): readonly RegisteredSurface[];
}

export type RegisterSurfaceFn = SurfaceRegistry['register'];

/** Validates back-button rule at registration time (fail fast for Lane 1 wiring). */
export function validateRegisterSurfaceInput(
  input: RegisterSurfaceInput,
): { ok: true } | { ok: false; reason: string } {
  const isHome = input.route === '/' || input.route === '';
  if (isHome && input.backTo !== undefined) {
    return { ok: false, reason: 'home surfaces must not declare backTo' };
  }
  if (!isHome && (input.backTo === undefined || input.backTo.trim().length === 0)) {
    return { ok: false, reason: 'non-home surfaces require backTo' };
  }
  if (input.route.includes('?')) {
    return { ok: false, reason: 'route must not include query strings' };
  }
  if (input.roleScope.length === 0) {
    return { ok: false, reason: 'roleScope must include at least one role root' };
  }
  return { ok: true };
}
