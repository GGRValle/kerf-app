// i18n key catalog. Every string that will be RENDERED TO A USER must be a key
// in this union. User-entered data (decision titles, memory body, scope text)
// is NOT i18n — it's passed through as-is.
//
// Spanish is first-class from day one. Every new key must have both EN and ES
// entries before it can be used. Typecheck enforces via `TranslationMap`.

export type I18nKey =
  // System State tiles
  | 'systemState.projects.label'
  | 'systemState.intakes.label'
  | 'systemState.approvals.label'
  | 'systemState.money.label'

  // Lifecycle
  | 'lifecycle.draft'
  | 'lifecycle.recommended'
  | 'lifecycle.approved'
  | 'lifecycle.locked'

  // Roles
  | 'role.owner'
  | 'role.moo'
  | 'role.pm'
  | 'role.field_super'
  | 'role.office'
  | 'role.sub'
  | 'role.client'

  // Permission errors
  | 'error.permission.view_denied'
  | 'error.permission.edit_denied'
  | 'error.permission.approve_denied'
  | 'error.permission.amount_exceeds_ceiling'

  // Generic
  | 'error.validation'
  | 'error.contract';

export type Locale = 'en' | 'es';

// Enforces that every locale supplies every key. Adding a key to I18nKey that
// isn't in both en.ts and es.ts is a compile error. Intentional.
export type TranslationMap = Record<I18nKey, string>;
