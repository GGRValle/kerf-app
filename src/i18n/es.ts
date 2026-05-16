import type { TranslationMap } from './keys.js';

// Spanish — first-class from day one. These entries ship in V2.1 Paid Beta but
// exist in the codebase now so no key lands English-only.
//
// TODO pre-V2.1: review with a native Spanish-speaking contractor (San Diego
// residential trades vocabulary, not academic Spanish).

export const ES: TranslationMap = {
  'systemState.projects.label': 'Proyectos activos',
  'systemState.intakes.label': 'Borradores por revisar',
  'systemState.approvals.label': 'Aprobaciones pendientes',
  'systemState.money.label': 'Dinero propuesto',

  'lifecycle.draft': 'Borrador',
  'lifecycle.recommended': 'Recomendado',
  'lifecycle.approved': 'Aprobado',
  'lifecycle.locked': 'Cerrado',

  'role.owner': 'Dueño',
  'role.moo': 'Gerente de Operaciones',
  'role.pm': 'Gerente de Proyecto',
  'role.field_super': 'Supervisor de Obra',
  'role.office': 'Oficina',
  'role.sub': 'Subcontratista',
  'role.client': 'Cliente',

  'error.permission.view_denied': 'No tiene permiso para ver esto.',
  'error.permission.edit_denied': 'No tiene permiso para editar esto.',
  'error.permission.approve_denied': 'No tiene permiso para aprobar esto.',
  'error.permission.amount_exceeds_ceiling': 'El monto excede su límite de aprobación.',

  'error.validation': 'Validación fallida.',
  'error.contract': 'Violación de contrato.',

  'field.brand.title': 'KERF · CAMPO',
  'field.project.label': 'Proyecto',
  'field.project.loading': 'Cargando proyectos…',
  'field.project.empty': 'Aún no hay proyectos — créelo primero desde la oficina.',
  'field.transcript.test_label': 'ESCRIBIR TRANSCRIPCIÓN (solo pruebas)',
  'field.transcript.placeholder': 'Pegue o escriba lo que habría dicho en obra…',
  'field.voice.section_label': 'Captura de voz',
  'field.voice.record_button': 'Grabar',
  'field.submit.label': 'Enviar entrada del diario',
  'field.submit.working': 'Enviando…',
  'field.confirm.title': 'Entrada capturada',
  'field.confirm.event_id': 'Id de evento',
  'field.confirm.transcript_preview': 'Vista previa de transcripción',
  'field.error.title': 'No se pudo guardar la entrada',
  'field.notice.entry_kind': 'Actualización de avance · tenant_ggr (demo V1.5)',
};
