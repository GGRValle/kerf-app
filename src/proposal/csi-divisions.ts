/**
 * Kerf proposal divisions — broad, tenant-configurable grouping labels used
 * on the CLIENT-FACING proposal artifact.
 *
 * Grounded in real GGR proposal practice (Dunne project, May 2026):
 *   Div 01 — General Requirements
 *   Div 02 — Existing Conditions
 *   Div 06 — Wood, Plastics & Composites
 *   Div 09 — Finishes
 *   Div 10 — Specialties
 *   Div 12 — Furnishings  (Valle cabinetry + countertops live here)
 *   Div 22 — Plumbing
 *   Div 26 — Electrical
 *
 * NOTE: GGR's INTERNAL cost sheet uses a different (GGR-specific) phase
 * scheme — 01 General, 02 Demo, 09 Electrical Rough, 11 Drywall, 12
 * Millwork, 13 Cabinetry, 14 Tile, 16 Plumbing Finish, 18 Electrical
 * Finish, 19 Painting. That scheme is NOT this module's concern; the
 * cost sheet stays in Excel for V1.5 per the operator's workflow. When
 * we wire xlsx import later, a mapping table converts GGR-internal
 * phases → CSI divisions for the printable proposal.
 *
 * These divisions are CSI-compatible at the broad two-digit trade-grouping
 * level, but Kerf does not redistribute the MasterFormat taxonomy or detailed
 * section titles. Tenants can map their own cost codes to these broad Kerf
 * divisions, or supply a licensed/custom mapping later.
 *
 * The full MasterFormat 2018 has 50+ divisions. Below is the
 * residential-remodel subset GGR actually uses. Operator can type a
 * division code we don't list — the validator accepts any 2-digit
 * code with a label.
 */

export interface CsiDivisionMeta {
  readonly code: string; // "01", "02", "06", … (always 2 digits, zero-padded)
  readonly label: string; // "General Requirements", "Existing Conditions", …
}

/**
 * Common residential-remodel CSI divisions. NOT exhaustive — operator
 * can use any 2-digit code with a custom label. This list drives
 * dropdown defaults in the UI.
 */
export const COMMON_CSI_DIVISIONS: readonly CsiDivisionMeta[] = [
  { code: '01', label: 'General Requirements' },
  { code: '02', label: 'Existing Conditions' },
  { code: '03', label: 'Concrete' },
  { code: '04', label: 'Masonry' },
  { code: '05', label: 'Metals' },
  { code: '06', label: 'Wood, Plastics & Composites' },
  { code: '07', label: 'Thermal & Moisture Protection' },
  { code: '08', label: 'Openings' },
  { code: '09', label: 'Finishes' },
  { code: '10', label: 'Specialties' },
  { code: '11', label: 'Equipment' },
  { code: '12', label: 'Furnishings' },
  { code: '13', label: 'Special Construction' },
  { code: '22', label: 'Plumbing' },
  { code: '23', label: 'HVAC' },
  { code: '26', label: 'Electrical' },
  { code: '27', label: 'Communications' },
  { code: '32', label: 'Exterior Improvements' },
];

const CSI_CODE_REGEX = /^[0-9]{2}$/;

/**
 * Whether the given string looks like a valid CSI division code
 * (2-digit, zero-padded). Doesn't enforce membership in the
 * COMMON_CSI_DIVISIONS list — operator may use any 2-digit code.
 */
export function isCsiDivisionCode(code: unknown): code is string {
  return typeof code === 'string' && CSI_CODE_REGEX.test(code);
}

/**
 * Lookup the canonical label for a division code. Returns null if
 * the code isn't in the common list (operator must supply a label).
 */
export function defaultLabelForCsiCode(code: string): string | null {
  const found = COMMON_CSI_DIVISIONS.find((d) => d.code === code);
  return found?.label ?? null;
}
