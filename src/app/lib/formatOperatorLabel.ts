/**
 * Plain-English labels for closed taxonomies shown on operator surfaces.
 * Raw snake_case / event-type strings stay valid in audit JSON and tests.
 */

const SCOPE_TAG_LABELS: Record<string, string> = {
  plumbing_fixtures: 'Plumbing fixtures',
  windows_doors: 'Windows & doors',
};

const DOMAIN_LABELS: Record<string, string> = {
  team_ops: 'Team',
  work_orders: 'Work orders',
  admin_ops: 'Admin & ops',
};

export function humanizeSnakeCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatScopeTag(tag: string): string {
  return SCOPE_TAG_LABELS[tag] ?? humanizeSnakeCase(tag);
}

export function formatDomainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? humanizeSnakeCase(domain);
}

export function formatAuditFieldValue(value: string): string {
  return humanizeSnakeCase(value.replace(/\./g, ' '));
}
