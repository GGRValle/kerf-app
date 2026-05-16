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

  'rh.relay.brand.title': 'KERF · MANO DERECHA · RELAY',
  'rh.relay.list.subtitle': 'Relay de oficina — hechos extraídos de entradas diarias de campo',
  'rh.relay.list.loading': 'Cargando tarjetas relay…',
  'rh.relay.list.empty': 'Aún no hay tarjetas relay. Las entradas de campo con hechos extraídos aparecerán aquí.',
  'rh.relay.detail.back': '← Volver a la lista relay',
  'rh.relay.detail.loading': 'Cargando entrada…',
  'rh.relay.detail.transcript_toggle': 'Transcripción fuente',
  'rh.relay.detail.transcript_empty': '—',
  'rh.relay.detail.photos_title': 'Fotos',
  'rh.relay.detail.photos_placeholder': 'Captura de fotos con sustrato D-043 (marcador de posición).',
  'rh.relay.detail.facts_caption': 'Hechos extraídos (candidatos)',
  'rh.relay.detail.drift_title': 'Señal de desviación',
  'rh.relay.detail.no_drift': 'Sin señal de desviación para esta entrada.',
  'rh.relay.detail.audit_link': 'Rastro de auditoría →',
  'rh.relay.detail.mark_reviewed': 'Marcar revisado',
  'rh.relay.detail.not_found': 'Entrada no encontrada en el feed relay.',
  'rh.relay.detail.review_pending': 'El endpoint de revisión llega en el paso B.6 — aún no conectado.',
  'rh.relay.detail.review_error': 'No se pudo marcar como revisado.',
  'rh.relay.drift.info': 'Info',
  'rh.relay.drift.caution': 'Precaución',
  'rh.relay.drift.warn': 'Alerta',
  'rh.relay.drift.block': 'Bloqueo',
  'rh.relay.facts.completed_work': 'Trabajo completado',
  'rh.relay.facts.blocked_work': 'Trabajo bloqueado',
  'rh.relay.facts.schedule_status': 'Estado del cronograma',
  'rh.relay.facts.scope_change_flags': 'Cambios de alcance',
  'rh.relay.facts.money_risk_flags': 'Riesgos de dinero',
  'rh.relay.facts.client_decision_flags': 'Decisiones del cliente',
  'rh.relay.facts.materials_needed': 'Materiales necesarios',
  'rh.relay.facts.inspection_notes': 'Notas de inspección',
  'rh.relay.facts.safety_notes': 'Notas de seguridad',
};
