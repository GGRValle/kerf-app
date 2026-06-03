/**
 * Layer A · nine business-graph domains projected through the shell sidebar.
 * Matches Operating Model Canon v1 (2026-05-17); not the finer-grained nav slice ids.
 */
export const SHELL_BUSINESS_DOMAINS = [
  'home',
  'sales',
  'clients',
  'projects',
  'field',
  'schedule',
  'money',
  'people_admin_ops',
  'client_success',
] as const;

export type ShellBusinessDomain = (typeof SHELL_BUSINESS_DOMAINS)[number];

/** Role roots (Layer B projections). Server resolves login → exactly one tenant + role. */
export const SHELL_ROLE_ROOTS = [
  'owner',
  'pm',
  'admin_ops',
  'field_hand',
  'sub',
] as const;

export type ShellRoleRoot = (typeof SHELL_ROLE_ROOTS)[number];
