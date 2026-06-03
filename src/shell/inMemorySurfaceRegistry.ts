import {
  validateRegisterSurfaceInput,
  type RegisterSurfaceInput,
  type RegisteredSurface,
  type SurfaceRegistry,
} from '../contracts/lane1/registerSurface.js';
import type { ShellRoleRoot } from '../contracts/lane1/domains.js';

let surfaceSeq = 0;

/** Lane 1 reference registry — production wiring replaces this in the app shell. */
export function createInMemorySurfaceRegistry(): SurfaceRegistry {
  const byRoute = new Map<string, RegisteredSurface>();

  return {
    register(input: RegisterSurfaceInput): RegisteredSurface {
      const check = validateRegisterSurfaceInput(input);
      if (!check.ok) throw new Error(check.reason);
      const isHome = input.route === '/' || input.route === '';
      const surface: RegisteredSurface = {
        ...input,
        id: `surface_${++surfaceSeq}`,
        isHome,
      };
      byRoute.set(input.route, surface);
      return surface;
    },

    getByRoute(route: string): RegisteredSurface | undefined {
      return byRoute.get(route);
    },

    listForRole(role: ShellRoleRoot): readonly RegisteredSurface[] {
      return [...byRoute.values()].filter((s) => s.roleScope.includes(role));
    },
  };
}
