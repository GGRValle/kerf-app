import type { Cents } from '../../blackboard/types.js';

/**
 * Contract 5 · Selection.
 * Library item ↔ project selection instance; money in integer cents; markup never client-visible.
 */
export type SelectionLineType =
  | 'labor'
  | 'material'
  | 'product'
  | 'allowance'
  | 'subcontract'
  | 'equipment'
  | 'markup'
  | 'fee';

export type SelectionLifecycle = 'proposed' | 'approved' | 'ordered' | 'installed';

export const SELECTION_LIFECYCLE_ORDER: readonly SelectionLifecycle[] = [
  'proposed',
  'approved',
  'ordered',
  'installed',
];

export interface LibraryItemRef {
  readonly id: string;
  readonly sku?: string;
  readonly label: string;
}

export interface ProjectSelectionInstance {
  readonly id: string;
  readonly library_ref: string;
  readonly project_id: string;
  readonly lifecycle: SelectionLifecycle;
  readonly line_type: SelectionLineType;
  /** Always integer cents — never floats, never dollars in storage. */
  readonly amount_cents: Cents;
  /**
   * Client-facing previews may show this line when true. Hard canon: `markup`
   * must never be client-visible — enforced by {@link assertSelectionClientVisibility}.
   */
  readonly client_visible: boolean;
}

export function assertSelectionMoneyCents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new Error('selection amount must be integer cents');
  }
  return value;
}

/** Bar-2: markup ⇒ non-client-visible. Rejects margin leak at validator boundary. */
export function assertSelectionClientVisibility(
  line_type: SelectionLineType,
  client_visible: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (line_type === 'markup' && client_visible) {
    return { ok: false, reason: 'markup lines must not be client-visible' };
  }
  return { ok: true };
}

export function validateProjectSelectionInstance(
  instance: Pick<ProjectSelectionInstance, 'line_type' | 'client_visible' | 'amount_cents'>,
): { ok: true } | { ok: false; reason: string } {
  try {
    assertSelectionMoneyCents(instance.amount_cents);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'invalid amount_cents' };
  }
  return assertSelectionClientVisibility(instance.line_type, instance.client_visible);
}
