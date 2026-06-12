import { Hono } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import { appendDailyLogEntryAndSurface } from '../lib/dailyLogCommit.js';
import { getApiDeps } from '../lib/deps.js';
import {
  requireApiTenant,
  tenantOverrideFlags,
  tenantParamConflictsWithScope,
  type ApiVariables,
} from '../lib/tenantContext.js';
import {
  assignmentVisibleToSub,
  COMPLIANCE_ROWS,
  getAssignment,
  getProjectBrain,
  listAssignmentsForProject,
  listAssignmentsForSub,
  listProjectNotes,
  listProjectSelections,
  listScheduleEventsForProject,
  markWorkOrderSent,
  resolveSubToken,
  type ProjectBrainSummary,
} from '../../app/lib/lane3WorkFixtures.js';
import { getLane23ProjectForTenant } from '../../app/lib/lane23Fixtures.js';
import { getProjectRecordForTenant } from '../../app/lib/projectRecords.js';
import {
  buildCameraCaptureJobNotePair,
  entryKindForCaptureKind,
  friendlyCaptureTitle,
} from '../../app/lib/lane3TwoArtifact.js';
import { assignmentEnvelope } from '../../schedule/d032Substrate.js';
import type { AttentionArtifact } from '../../contracts/lane1/attentionArtifact.js';

export const lane3WorkRoutes = new Hono<{ Variables: ApiVariables }>();

type ProjectVisibility = 'fixture' | 'event_backed' | null;

/**
 * Lane3 project reads must see fixture projects AND event-backed projects —
 * POST /projects and D-066 convert-to-project both emit project.created with
 * no fixture row, and those projects were 404ing on every lane3 surface.
 * Fixture hit short-circuits so fixture-project behavior is unchanged.
 */
async function resolveProjectVisibility(
  projectId: string,
  tenant: PersistenceTenantId,
): Promise<ProjectVisibility> {
  if (getLane23ProjectForTenant(projectId, tenant) !== null) return 'fixture';
  const { tenantReader } = getApiDeps();
  const record = await getProjectRecordForTenant(tenantReader, tenant, projectId);
  return record !== null ? 'event_backed' : null;
}

async function projectVisibleToTenant(projectId: string, tenant: PersistenceTenantId): Promise<boolean> {
  return (await resolveProjectVisibility(projectId, tenant)) !== null;
}

/** A just-created project has no brain data yet — present, empty, truthful. */
const EMPTY_PROJECT_BRAIN: ProjectBrainSummary = {
  next_action: '',
  crew_on_site: '',
  open_items: 0,
  last_capture: '',
};

lane3WorkRoutes.get('/projects/:id/brain', async (c) => {
  const tenant = requireApiTenant(c);
  const projectId = c.req.param('id');
  const visibility = await resolveProjectVisibility(projectId, tenant);
  if (visibility === null) return c.json({ error: 'project_not_found' }, 404);
  const brain = getProjectBrain(projectId);
  if (brain === null) {
    // Fixture projects keep their existing contract; event-backed projects
    // are real but brainless at creation, which is a 200, not a 404.
    if (visibility === 'fixture') return c.json({ error: 'brain_not_found' }, 404);
    return c.json({ project_id: projectId, brain: EMPTY_PROJECT_BRAIN, ...tenantOverrideFlags(c) });
  }
  return c.json({ project_id: projectId, brain, ...tenantOverrideFlags(c) });
});

lane3WorkRoutes.get('/projects/:id/selections', async (c) => {
  const tenant = requireApiTenant(c);
  const projectId = c.req.param('id');
  if (!(await projectVisibleToTenant(projectId, tenant))) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project_id: projectId, selections: listProjectSelections(projectId), ...tenantOverrideFlags(c) });
});

lane3WorkRoutes.get('/projects/:id/notes', async (c) => {
  const tenant = requireApiTenant(c);
  const projectId = c.req.param('id');
  if (!(await projectVisibleToTenant(projectId, tenant))) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project_id: projectId, notes: listProjectNotes(projectId), ...tenantOverrideFlags(c) });
});

lane3WorkRoutes.get('/projects/:id/schedule-substrate', async (c) => {
  const tenant = requireApiTenant(c);
  const projectId = c.req.param('id');
  if (!(await projectVisibleToTenant(projectId, tenant))) return c.json({ error: 'project_not_found' }, 404);
  const events = listScheduleEventsForProject(tenant, projectId);
  const assignments = listAssignmentsForProject(tenant, projectId).map((a) => ({
    ...a,
    envelope: assignmentEnvelope(a),
  }));
  return c.json({ schedule_events: events, crew_assignments: assignments, ...tenantOverrideFlags(c) });
});

lane3WorkRoutes.post('/projects/:id/camera-capture', async (c) => {
  const projectId = c.req.param('id');
  type CameraCaptureBody = {
    capture_kind?: 'photo' | 'walkthrough' | 'scan';
    file_name?: string;
    confirmed?: boolean;
  };
  const body: CameraCaptureBody = await c.req.json<CameraCaptureBody>().catch(() => ({}));
  const tenant = requireApiTenant(c);
  if (!(await projectVisibleToTenant(projectId, tenant))) return c.json({ error: 'project_not_found' }, 404);
  const kind = body.capture_kind ?? 'photo';
  if (kind !== 'photo' && kind !== 'walkthrough' && kind !== 'scan') {
    return c.json({ error: 'invalid_capture_kind' }, 400);
  }
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmation_required', message: 'Set confirmed:true to file capture' }, 400);
  }

  const friendly = friendlyCaptureTitle(kind);
  const transcript = `${friendly}${body.file_name ? ` · ${body.file_name}` : ''}`;
  const photoUris = kind === 'photo' || kind === 'scan' ? [`kerf://capture/${projectId}/${Date.now()}`] : [];
  const audioUri = kind === 'walkthrough' ? `kerf://capture/${projectId}/walk_${Date.now()}` : null;

  const { eventStore, tenantReader } = getApiDeps();
  const result = await appendDailyLogEntryAndSurface({
    eventStore,
    tenantReader,
    tenant,
    projectId,
    entryKind: entryKindForCaptureKind(kind),
    transcriptText: transcript,
    audioUri,
    photoUris,
    clockSubKind: null,
    actor: { id: 'field_capture', role: 'field_super' },
  });

  const pair = buildCameraCaptureJobNotePair({
    tenant_id: tenant,
    project_id: projectId,
    entry_id: result.event.entry_id,
    capture_kind: kind,
    friendly_title: friendly,
    body_preview: transcript,
  });

  return c.json(
    {
      ok: true,
      daily_log: result,
      artifacts: pair,
      daily_log_route: `/projects/${projectId}/daily_log`,
      ...tenantOverrideFlags(c),
    },
    201,
  );
});

lane3WorkRoutes.post('/schedule/assignments/:id/send-work-order', async (c) => {
  const tenant = requireApiTenant(c);
  const assignmentId = c.req.param('id');
  const body = await c.req.json<{ confirmed?: boolean }>();
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmation_required' }, 400);
  }
  const existing = getAssignment(assignmentId);
  if (existing === null || existing.tenant_id !== tenant) return c.json({ error: 'assignment_not_found' }, 404);
  const assignment = markWorkOrderSent(assignmentId, new Date().toISOString());
  if (assignment === null) return c.json({ error: 'assignment_not_found' }, 404);
  return c.json({
    ok: true,
    assignment,
    message: 'Work order marked sent — no autonomous SMS/email from Kerf.',
    ...tenantOverrideFlags(c),
  });
});

lane3WorkRoutes.post('/schedule/assignments/:id/message-sub', async (c) => {
  const tenant = requireApiTenant(c);
  const assignment = getAssignment(c.req.param('id'));
  if (assignment === null || assignment.tenant_id !== tenant) return c.json({ error: 'assignment_not_found' }, 404);
  const body = await c.req.json<{ confirmed?: boolean; message?: string }>();
  if (body.confirmed !== true) {
    return c.json({
      error: 'confirmation_required',
      draft: `Relay draft for ${assignment.sub_label}: ${body.message ?? 'Confirm scope and start time.'}`,
      relay_route: '/relay',
    }, 400);
  }
  return c.json({
    ok: true,
    relay_route: `/relay?sub=${assignment.sub_id}&assignment=${assignment.assignment_id}`,
    drafted_message: body.message ?? `Scope confirmed for ${assignment.trade} · ${assignment.location_label}`,
    autonomous_send: false,
    ...tenantOverrideFlags(c),
  });
});

lane3WorkRoutes.get('/sub/portal/session/:token', (c) => {
  const token = c.req.param('token');
  const session = resolveSubToken(token);
  if (session === null) {
    return c.json({ error: 'sub_session_not_found' }, 404);
  }
  if (tenantParamConflictsWithScope(c.req.url, session.tenant_id)) {
    return c.json({ error: 'sub_isolation_violation' }, 403);
  }
  const assignments = listAssignmentsForSub(session.sub_id).map((a) => ({
    assignment_id: a.assignment_id,
    project_id: a.project_id,
    trade: a.trade,
    start_at: a.start_at,
    end_at: a.end_at,
    location_label: a.location_label,
    wo_sent_at: a.wo_sent_at,
  }));
  return c.json({
    sub_id: session.sub_id,
    sub_label: session.sub_label,
    assignments,
  });
});

lane3WorkRoutes.get('/sub/portal/session/:token/assignments/:assignmentId', (c) => {
  const token = c.req.param('token');
  const assignmentId = c.req.param('assignmentId');
  const session = resolveSubToken(token);
  const assignment = getAssignment(assignmentId);
  if (session === null || assignment === null) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (tenantParamConflictsWithScope(c.req.url, session.tenant_id)) {
    return c.json({ error: 'sub_isolation_violation' }, 403);
  }
  if (!assignmentVisibleToSub(assignment, session.sub_id)) {
    return c.json({ error: 'sub_isolation_violation' }, 403);
  }
  return c.json({
    assignment: {
      assignment_id: assignment.assignment_id,
      trade: assignment.trade,
      location_label: assignment.location_label,
      start_at: assignment.start_at,
      end_at: assignment.end_at,
      envelope: assignmentEnvelope(assignment),
    },
  });
});

lane3WorkRoutes.get('/team-ops/compliance', (c) => {
  const tenant = requireApiTenant(c);
  const attention: AttentionArtifact[] = COMPLIANCE_ROWS.filter((r) => r.days_until_expiry <= 30).map(
    (r) => ({
      id: `attn_coi_${r.sub_id}`,
      work_artifact_ref: `compliance:${r.sub_id}`,
      state: 'risk_changed' as const,
      domain: 'people_admin_ops' as const,
      headline: `${r.sub_label} · ${r.cert_type} expiring`,
      because: `Certificate expires ${r.expires_at} (${r.days_until_expiry} days)`,
      consequence_tier: 'reversible' as const,
      source_ref: `coi:${r.sub_id}`,
      role_scope: ['owner', 'pm', 'admin_ops'] as const,
      locality: { tenant, consequence_tier: 'reversible' as const },
    }),
  );
  return c.json({ compliance: COMPLIANCE_ROWS, attention, ...tenantOverrideFlags(c) });
});
