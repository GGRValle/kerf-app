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

export interface LibraryItemRef {
  readonly id: string;
  readonly sku?: string;
  readonly label: string;
}

export interface ProjectSelectionInstance {
  readonly id: string;
  readonly library_item_id: string;
  readonly project_id: string;
  readonly lifecycle: SelectionLifecycle;
  readonly line_type: SelectionLineType;
  /** Always integer cents — never floats, never dollars in storage. */
  readonly amount_cents: Cents;
  /**
   * Markup lines may exist on the selection but must not surface on client-facing
   * previews or portals (Operating Model · money doctrine).
   */
  readonly client_visible: boolean;
}

export function assertSelectionMoneyCents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new Error('selection amount must be integer cents');
  }
  return value;
}
