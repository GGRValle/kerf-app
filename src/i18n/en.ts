import type { TranslationMap } from './keys.js';

export const EN: TranslationMap = {
  'systemState.projects.label': 'Active projects',
  'systemState.intakes.label': 'Drafts awaiting review',
  'systemState.approvals.label': 'Approvals waiting',
  'systemState.money.label': 'Money proposed',

  'lifecycle.draft': 'Draft',
  'lifecycle.recommended': 'Recommended',
  'lifecycle.approved': 'Approved',
  'lifecycle.locked': 'Locked',

  'role.owner': 'Owner',
  'role.moo': 'Manager of Operations',
  'role.pm': 'Project Manager',
  'role.field_super': 'Field Supervisor',
  'role.office': 'Office',
  'role.sub': 'Subcontractor',
  'role.client': 'Client',

  'error.permission.view_denied': 'You do not have permission to view this.',
  'error.permission.edit_denied': 'You do not have permission to edit this.',
  'error.permission.approve_denied': 'You do not have permission to approve this.',
  'error.permission.amount_exceeds_ceiling': 'Amount exceeds your approval ceiling.',

  'error.validation': 'Validation failed.',
  'error.contract': 'Contract violation.',

  'field.brand.title': 'KERF · FIELD',
  'field.project.label': 'Project',
  'field.project.loading': 'Loading projects…',
  'field.project.empty': 'No projects yet — create one from the office flow first.',
  'field.transcript.test_label': 'TYPE TRANSCRIPT (testing only)',
  'field.transcript.placeholder': 'Paste or type what you would have said on site…',
  'field.voice.section_label': 'Voice capture',
  'field.voice.record_button': 'Record',
  'field.submit.label': 'Submit daily log entry',
  'field.submit.working': 'Submitting…',
  'field.confirm.title': 'Entry captured',
  'field.confirm.event_id': 'Event id',
  'field.confirm.transcript_preview': 'Transcript preview',
  'field.error.title': 'Could not save entry',
  'field.notice.entry_kind': 'Progress update · tenant_ggr (V1.5 demo)',
};
