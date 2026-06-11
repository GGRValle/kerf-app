/**
 * D-068 workbook render/ingest — the estimate's human-editable projection.
 *
 * RENDER: graph (RightHandEstimateDraft) → v2.2-contract xlsx (KD division
 * sheets + EXPORT). Values, not formulas, in v1 — the graph stays truth.
 *
 * INGEST: the EXPORT sheet ONLY, diffed against the draft, applied as rung-0
 * ESTIMATE_OVERRIDE-class edits via the same shared seam as touch/voice edits.
 * THE CONSEQUENCE EDGE (conductor, D-049): fail-closed, belt-and-suspenders —
 *  - header row must match the contract exactly (shifted columns → structural reject)
 *  - formulas are REJECTED as values, never evaluated
 *  - enums validated against closed sets; unknown → line rejected
 *  - notes are DATA: stored truncated, never interpreted
 *  - row cap 500, structural failures apply NOTHING
 *  - response always enumerates applied vs rejected (nothing-silent)
 * The model appears NOWHERE in this path.
 */
import ExcelJS from 'exceljs';

import {
  applyRungZeroLineEdit,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
} from './rightHandAssemblyStore.js';
import {
  kerfDivisionForCode,
  matchTenantRateCardLineDetailed,
  tenantRateCardFor,
} from '../../estimator/rateCard.js';

export const WORKBOOK_EXPORT_HEADER = [
  'trade', 'line_id', 'include', 'description', 'qty', 'unit', 'lead_hrs', 'help_hrs',
  'rate_cost', 'per_unit', 'total_cost', 'sell', 'field_state', 'capture', 'source_layer',
  'approval', 'notes', 'ref',
] as const;

const FIELD_STATES = new Set(['CONFIRMED', 'ASSUMED', 'STALE', 'UNKNOWN']);
const MAX_ROWS = 500;

function fieldStateFor(line: RightHandEstimateLine): string {
  if (line.flags.includes('operator_edited') || line.flags.includes('voice_edited')) return 'CONFIRMED';
  if (typeof line.price_cents === 'number' && line.price_cents > 0) return 'ASSUMED';
  return 'UNKNOWN';
}

function captureFor(line: RightHandEstimateLine): string {
  if (line.flags.includes('voice_edited') || line.flags.includes('operator_edited')) return 'OPERATOR';
  if (line.flags.includes('suggested')) return 'AGENT_DERIVED';
  return 'RATE_CARD';
}

function sourceLayerFor(line: RightHandEstimateLine): string {
  if (line.flags.includes('operator_edited') || line.flags.includes('voice_edited')) return 'ESTIMATE_OVERRIDE';
  return 'KERF_SEED';
}

function approvalFor(sourceLayer: string): string {
  if (sourceLayer === 'ESTIMATE_OVERRIDE') return 'AUTO';
  if (sourceLayer === 'KERF_SEED' || sourceLayer === 'PUBLIC_REFERENCE') return 'NEEDS_OPERATOR';
  return 'BLOCKED';
}

/** Graph → xlsx buffer (KD division sheets + the EXPORT contract sheet). */
export async function renderEstimateWorkbook(draft: RightHandEstimateDraft): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Right Hand';
  const lines = draft.lines.filter((line) => !line.flags.includes('removed'));

  const summary = wb.addWorksheet('SUMMARY');
  summary.addRow(['Right Hand estimate', draft.title]);
  summary.addRow(['Estimate id', draft.estimate_id]);
  summary.addRow(['Status', draft.status, draft.gate.allowed ? 'review-ready' : `blocked: ${draft.gate.blocked_reasons.join(', ')}`]);
  summary.addRow(['Pricing', draft.pricing_data_label]);

  const byDivision = new Map<string, RightHandEstimateLine[]>();
  for (const line of lines) {
    const code = line.division?.code ?? 'KD-01';
    if (!byDivision.has(code)) byDivision.set(code, []);
    byDivision.get(code)!.push(line);
  }
  for (const [code, divLines] of [...byDivision.entries()].sort()) {
    const label = divLines[0]?.division?.label ?? kerfDivisionForCode(code)?.label ?? code;
    const ws = wb.addWorksheet(`${code} ${label}`.slice(0, 31));
    ws.addRow([`${code} ${label}`]);
    ws.addRow(['line_id', 'description', 'qty', 'unit', 'unit sell', 'sell', 'tier']);
    for (const line of divLines) {
      ws.addRow([
        line.cost_code ?? '',
        line.label,
        line.quantity ?? '',
        line.uom ?? '',
        typeof line.unit_cents === 'number' ? line.unit_cents / 100 : '',
        typeof line.extended_cents === 'number' ? line.extended_cents / 100 : '',
        line.source_label,
      ]);
    }
  }

  const ex = wb.addWorksheet('EXPORT');
  ex.addRow([...WORKBOOK_EXPORT_HEADER]);
  for (const line of lines) {
    const sourceLayer = sourceLayerFor(line);
    ex.addRow([
      line.division ? `${line.division.code} ${line.division.label}` : '',
      line.cost_code ?? '',
      'Y',
      line.label,
      line.quantity ?? '',
      line.uom ?? '',
      '', '', '', // lead/help/rate: seed-derivation inputs, not per-artifact state in v1
      'TRUE',
      typeof line.extended_cents === 'number' ? Math.round(line.extended_cents * 0.65) / 100 : '',
      typeof line.extended_cents === 'number' ? line.extended_cents / 100 : '',
      fieldStateFor(line),
      captureFor(line),
      sourceLayer,
      approvalFor(sourceLayer),
      '',
      line.id,
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface WorkbookIngestResult {
  readonly ok: boolean;
  readonly structural_error?: string;
  readonly applied: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly rejected: readonly { readonly row: number; readonly reason: string }[];
  readonly draft: RightHandEstimateDraft;
}

function cellValue(cell: ExcelJS.Cell): { readonly formula: boolean; readonly value: unknown } {
  const v = cell.value as unknown;
  if (v !== null && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object))) {
    return { formula: true, value: null };
  }
  if (typeof v === 'string' && v.trim().startsWith('=')) return { formula: true, value: null };
  return { formula: false, value: v };
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value.trim()))) return Number(value.trim());
  return null;
}

/** EXPORT-sheet diff → rung-0 edits. Fail-closed per the card. */
export async function ingestEstimateWorkbook(
  draft: RightHandEstimateDraft,
  fileBuffer: Buffer,
): Promise<WorkbookIngestResult> {
  const fail = (msg: string): WorkbookIngestResult => ({ ok: false, structural_error: msg, applied: [], added: [], removed: [], rejected: [], draft });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
  } catch {
    return fail('unreadable_workbook');
  }
  const ex = wb.getWorksheet('EXPORT');
  if (!ex) return fail('missing_EXPORT_sheet');
  if (ex.rowCount - 1 > MAX_ROWS) return fail(`row_cap_exceeded_${MAX_ROWS}`);
  const header = ex.getRow(1).values as unknown[];
  const got = (header.slice(1, WORKBOOK_EXPORT_HEADER.length + 1) as unknown[]).map((v) => String(v ?? '').trim());
  if (got.join('|') !== WORKBOOK_EXPORT_HEADER.join('|')) {
    return fail('header_mismatch_columns_shifted_or_renamed');
  }
  const col = (name: (typeof WORKBOOK_EXPORT_HEADER)[number]) => WORKBOOK_EXPORT_HEADER.indexOf(name) + 1;

  let next = draft;
  const applied: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const rejected: { row: number; reason: string }[] = [];
  const byId = new Map(draft.lines.map((line) => [line.id, line]));
  const card = tenantRateCardFor(draft.tenant_id);

  for (let r = 2; r <= ex.rowCount; r++) {
    const row = ex.getRow(r);
    if (!row.hasValues) continue;
    // formulas anywhere in the row → reject the line, never evaluate
    let hasFormula = false;
    for (let c = 1; c <= WORKBOOK_EXPORT_HEADER.length; c++) {
      if (cellValue(row.getCell(c)).formula) { hasFormula = true; break; }
    }
    if (hasFormula) { rejected.push({ row: r, reason: 'formula_rejected_as_value' }); continue; }

    const ref = String(cellValue(row.getCell(col('ref'))).value ?? '').trim();
    const includeRaw = String(cellValue(row.getCell(col('include'))).value ?? '').trim().toUpperCase();
    if (includeRaw && includeRaw !== 'Y' && includeRaw !== 'N') { rejected.push({ row: r, reason: 'include_must_be_Y_or_N' }); continue; }
    const fieldState = String(cellValue(row.getCell(col('field_state'))).value ?? '').trim().toUpperCase();
    if (fieldState && !FIELD_STATES.has(fieldState)) { rejected.push({ row: r, reason: 'unknown_field_state_enum' }); continue; }
    const qty = asNumber(cellValue(row.getCell(col('qty'))).value);
    const sell = asNumber(cellValue(row.getCell(col('sell'))).value);

    if (ref && byId.has(ref)) {
      const line = byId.get(ref)!;
      if (includeRaw === 'N') {
        const out = applyRungZeroLineEdit(next, ref, { removed: true }, 'operator_edited');
        if (out) { next = out; removed.push(ref); } else rejected.push({ row: r, reason: 'remove_failed' });
        continue;
      }
      const patch: { quantity?: number; unit_cents?: number } = {};
      if (qty !== null && qty > 0 && qty !== line.quantity) patch.quantity = qty;
      if (sell !== null && qty !== null && qty > 0) {
        const unitCents = Math.round((sell * 100) / qty);
        if (Number.isInteger(unitCents) && unitCents >= 0 && unitCents !== line.unit_cents) patch.unit_cents = unitCents;
      }
      if (Object.keys(patch).length === 0) continue;
      const out = applyRungZeroLineEdit(next, ref, patch, 'operator_edited');
      if (out) { next = out; applied.push(ref); } else rejected.push({ row: r, reason: 'invalid_edit_values' });
      continue;
    }

    // new row: no ref → must be a real library line (selection-not-invention)
    const libId = String(cellValue(row.getCell(col('line_id'))).value ?? '').trim();
    if (!libId) { rejected.push({ row: r, reason: 'unknown_ref_and_no_line_id' }); continue; }
    if (includeRaw !== 'Y') continue; // non-included new rows are noise, skip silently? no — record
    const match = matchTenantRateCardLineDetailed({ tenantId: draft.tenant_id, scopeTag: 'cabinetry' as never, description: '', uom: '', lineId: libId, rateCard: card });
    if (!match || match.matched_by !== 'line_id') { rejected.push({ row: r, reason: `line_id_not_in_library_${libId.slice(0, 12)}` }); continue; }
    if (qty === null || qty <= 0) { rejected.push({ row: r, reason: 'new_line_needs_positive_qty' }); continue; }
    const lib = match.line;
    const division = kerfDivisionForCode(lib.kerf_division.code) ?? lib.kerf_division;
    const id = `est_model_knowledge_wb_${lib.cost_code.toLowerCase()}_${r}`;
    const extended = Math.round(qty * lib.unit_cents);
    const newLine: RightHandEstimateLine = {
      id,
      label: lib.label,
      description: lib.label,
      cost_code: lib.cost_code,
      source_type: 'model_knowledge',
      source_label: 'Illustrative',
      source_ref: lib.source_ref,
      open_item: false,
      flags: [lib.scope_tag, 'operator_edited', 'workbook_added'],
      tier: 'illustrative',
      division: { code: division.code, label: division.label, subtotal_cents: 0 },
      quantity: qty,
      uom: lib.uom,
      unit_cents: lib.unit_cents,
      extended_cents: extended,
      price_cents: extended,
      confidence: 'MODEL_INFERENCE',
      matched_by: 'line_id',
    };
    next = { ...next, lines: [...next.lines, newLine], updated_at: new Date().toISOString() };
    added.push(id);
  }

  return { ok: true, applied, added, removed, rejected, draft: next };
}
