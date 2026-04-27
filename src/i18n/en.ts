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
};
