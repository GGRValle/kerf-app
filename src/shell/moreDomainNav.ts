/**
 * D-059 · More sheet — role-scoped nine-domain nav from surfaceCatalog roleScope.
 */
import type { ShellBusinessDomain, ShellRoleRoot } from '../contracts/lane1/domains.js';
import { SHELL_BUSINESS_DOMAINS } from '../contracts/lane1/domains.js';
import type { I18nKey } from '../i18n/keys.js';
import { surfaceRegistry } from './surfaceCatalog.js';
import type { RegisteredSurface } from '../contracts/lane1/registerSurface.js';

const MORE_UTILITY_ROUTES = new Set([
  '/more',
  '/start',
  '/create',
  '/camera',
  '/right-hand',
  '/login',
]);

const DOMAIN_LABEL_KEYS: Record<ShellBusinessDomain, I18nKey> = {
  home: 'shell.domain.home',
  sales: 'shell.domain.sales',
  clients: 'shell.domain.clients',
  projects: 'shell.domain.projects',
  field: 'shell.domain.field',
  schedule: 'shell.domain.schedule',
  money: 'shell.domain.money',
  people_admin_ops: 'shell.domain.people_admin_ops',
  client_success: 'shell.domain.client_success',
};

const DOMAIN_ROUTE_PRIORITY: Record<ShellBusinessDomain, readonly string[]> = {
  home: ['/', '/on-me'],
  sales: ['/sales', '/decisions'],
  clients: ['/clients'],
  projects: ['/projects', '/draft-review'],
  field: ['/relay', '/field-capture'],
  schedule: ['/work', '/schedule'],
  money: ['/money'],
  people_admin_ops: ['/settings', '/reports'],
  client_success: ['/client-success', '/transcript-review'],
};

export interface MoreDomainLink {
  readonly domain: ShellBusinessDomain;
  readonly href: string;
  readonly labelKey: I18nKey;
  readonly component: string;
}

function pickSurfaceForDomain(surfaces: readonly RegisteredSurface[], domain: ShellBusinessDomain): RegisteredSurface | null {
  const inDomain = surfaces.filter((s) => s.domain === domain);
  if (inDomain.length === 0) return null;
  for (const route of DOMAIN_ROUTE_PRIORITY[domain]) {
    const hit = inDomain.find((s) => s.route === route);
    if (hit) return hit;
  }
  return inDomain.sort((a, b) => a.route.length - b.route.length)[0] ?? null;
}

/** Nine-domain list for the More sheet — filtered by registerSurface roleScope. */
export function moreDomainLinksForRole(role: ShellRoleRoot): readonly MoreDomainLink[] {
  const surfaces = surfaceRegistry
    .listForRole(role)
    .filter((s) => !MORE_UTILITY_ROUTES.has(s.route) && !s.route.startsWith('/home/'));

  const links: MoreDomainLink[] = [];
  for (const domain of SHELL_BUSINESS_DOMAINS) {
    const surface = pickSurfaceForDomain(surfaces, domain);
    if (surface === null) continue;
    links.push({
      domain,
      href: surface.route,
      labelKey: DOMAIN_LABEL_KEYS[domain],
      component: surface.component,
    });
  }
  return links;
}
