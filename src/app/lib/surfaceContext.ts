import type { RoleRootContext } from './layout-props.js';

export type SurfaceName =
  | 'home'
  | 'estimate'
  | 'proposal'
  | 'invoice'
  | 'money'
  | 'field_capture';

export interface SurfaceContextIds {
  readonly client_id?: string;
  readonly project_id?: string;
  readonly estimate_id?: string;
  readonly proposal_id?: string;
  readonly invoice_id?: string;
  readonly line_ids?: readonly string[];
}

export interface SurfaceContextPrevious {
  readonly surface: SurfaceName;
  readonly ids: SurfaceContextIds;
}

export interface SurfaceContext extends SurfaceContextIds {
  readonly surface: SurfaceName;
  readonly tenant: RoleRootContext['tenantId'];
  readonly role: RoleRootContext['roleRoot'];
  readonly phase?: string;
  readonly previous: SurfaceContextPrevious | null;
}

export interface SurfaceContextInput extends SurfaceContextIds {
  readonly surface: SurfaceName;
  readonly phase?: string;
}

export function createSurfaceContext(
  principal: RoleRootContext,
  input: SurfaceContextInput,
  previous: SurfaceContextPrevious | null = null,
): SurfaceContext {
  return {
    surface: input.surface,
    tenant: principal.tenantId,
    role: principal.roleRoot,
    client_id: input.client_id,
    project_id: input.project_id,
    estimate_id: input.estimate_id,
    proposal_id: input.proposal_id,
    invoice_id: input.invoice_id,
    line_ids: input.line_ids,
    phase: input.phase,
    previous,
  };
}

export function leaveBehindForSurface(context: SurfaceContext): SurfaceContextPrevious {
  return {
    surface: context.surface,
    ids: {
      client_id: context.client_id,
      project_id: context.project_id,
      estimate_id: context.estimate_id,
      proposal_id: context.proposal_id,
      invoice_id: context.invoice_id,
      line_ids: context.line_ids,
    },
  };
}

export function isSurfaceContextPrevious(value: unknown): value is SurfaceContextPrevious {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isSurfaceName(record.surface)) return false;
  return typeof record.ids === 'object' && record.ids !== null;
}

function isSurfaceName(value: unknown): value is SurfaceName {
  return (
    value === 'home' ||
    value === 'estimate' ||
    value === 'proposal' ||
    value === 'invoice' ||
    value === 'money' ||
    value === 'field_capture'
  );
}
