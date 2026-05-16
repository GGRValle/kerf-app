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
  | 'error.contract'

  // Right Hand — Field Daily relay (/relay) — B.5
  | 'rh.relay.brand.title'
  | 'rh.relay.list.subtitle'
  | 'rh.relay.list.loading'
  | 'rh.relay.list.empty'
  | 'rh.relay.detail.back'
  | 'rh.relay.detail.loading'
  | 'rh.relay.detail.transcript_toggle'
  | 'rh.relay.detail.transcript_empty'
  | 'rh.relay.detail.photos_title'
  | 'rh.relay.detail.photos_placeholder'
  | 'rh.relay.detail.facts_caption'
  | 'rh.relay.detail.drift_title'
  | 'rh.relay.detail.no_drift'
  | 'rh.relay.detail.audit_link'
  | 'rh.relay.detail.mark_reviewed'
  | 'rh.relay.detail.not_found'
  | 'rh.relay.detail.review_pending'
  | 'rh.relay.detail.review_error'
  | 'rh.relay.drift.info'
  | 'rh.relay.drift.caution'
  | 'rh.relay.drift.warn'
  | 'rh.relay.drift.block'
  | 'rh.relay.facts.completed_work'
  | 'rh.relay.facts.blocked_work'
  | 'rh.relay.facts.schedule_status'
  | 'rh.relay.facts.scope_change_flags'
  | 'rh.relay.facts.money_risk_flags'
  | 'rh.relay.facts.client_decision_flags'
  | 'rh.relay.facts.materials_needed'
  | 'rh.relay.facts.inspection_notes'
  | 'rh.relay.facts.safety_notes'

  // Field Daily — /field capture surface (B.4)
  | 'field.brand.title'
  | 'field.project.label'
  | 'field.project.loading'
  | 'field.project.empty'
  | 'field.transcript.test_label'
  | 'field.transcript.placeholder'
  | 'field.voice.section_label'
  | 'field.voice.record_button'
  | 'field.submit.label'
  | 'field.submit.working'
  | 'field.confirm.title'
  | 'field.confirm.event_id'
  | 'field.confirm.transcript_preview'
  | 'field.error.title'
  | 'field.notice.entry_kind';

export type Locale = 'en' | 'es';

// Enforces that every locale supplies every key. Adding a key to I18nKey that
// isn't in both en.ts and es.ts is a compile error. Intentional.
export type TranslationMap = Record<I18nKey, string>;
