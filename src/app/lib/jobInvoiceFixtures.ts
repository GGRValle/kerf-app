export type JobInvoiceStatus = 'paid' | 'ready' | 'scheduled' | 'blocked';

export interface JobInvoiceLine {
  readonly id: string;
  readonly label: string;
  readonly amount_cents: number;
}

export interface JobInvoice {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly client_name: string;
  readonly label: string;
  readonly invoice_no: string;
  readonly milestone: string;
  readonly status: JobInvoiceStatus;
  readonly status_label: string;
  readonly amount_cents: number;
  readonly detail: string;
  readonly line_ids: readonly string[];
  readonly lines: readonly JobInvoiceLine[];
  readonly gate_note: string;
  readonly due_label: string;
}

export const JOB_INVOICES: readonly JobInvoice[] = [
  {
    id: 'inv-weg-01',
    project_id: 'proj_wegrzyn_kitchen',
    project_name: 'Wegrzyn kitchen + primary bath',
    client_name: 'Wegrzyn',
    label: 'Deposit invoice',
    invoice_no: 'INV-WEG-01',
    milestone: 'Payment 1 of 4',
    status: 'paid',
    status_label: 'Paid',
    amount_cents: 46_875_00,
    detail: 'Received May 30',
    due_label: 'Received',
    gate_note: 'Recorded payment is already tied to the signed contract.',
    line_ids: ['line_contract_deposit'],
    lines: [
      { id: 'line_contract_deposit', label: 'Contract deposit', amount_cents: 46_875_00 },
    ],
  },
  {
    id: 'inv-weg-02',
    project_id: 'proj_wegrzyn_kitchen',
    project_name: 'Wegrzyn kitchen + primary bath',
    client_name: 'Wegrzyn',
    label: 'Progress invoice',
    invoice_no: 'INV-WEG-02',
    milestone: 'Payment 2 of 4',
    status: 'ready',
    status_label: 'Ready to issue',
    amount_cents: 42_750_00,
    detail: 'Tile and cabinet phase',
    due_label: 'Due on issue',
    gate_note: 'Right Hand drafted this from the signed contract. Nothing is issued, sent, posted, or recorded until you confirm.',
    line_ids: ['line_kit_cabinets', 'line_tile_floor', 'line_primary_bath_labor', 'line_appliance_allowance'],
    lines: [
      { id: 'line_kit_cabinets', label: 'Cabinet install labor', amount_cents: 14_500_00 },
      { id: 'line_tile_floor', label: 'Tile phase labor', amount_cents: 11_800_00 },
      { id: 'line_primary_bath_labor', label: 'Primary bath rough materials', amount_cents: 9_950_00 },
      { id: 'line_appliance_allowance', label: 'Appliance allowance draw', amount_cents: 6_500_00 },
    ],
  },
  {
    id: 'inv-weg-03',
    project_id: 'proj_wegrzyn_kitchen',
    project_name: 'Wegrzyn kitchen + primary bath',
    client_name: 'Wegrzyn',
    label: 'Progress invoice',
    invoice_no: 'INV-WEG-03',
    milestone: 'Payment 3 of 4',
    status: 'scheduled',
    status_label: 'Scheduled',
    amount_cents: 61_875_00,
    detail: 'Locked until rough inspections',
    due_label: 'Not due yet',
    gate_note: 'Scheduled only. Rough inspection proof must land before issue.',
    line_ids: ['line_rough_inspection', 'line_finish_materials'],
    lines: [
      { id: 'line_rough_inspection', label: 'Rough inspection phase', amount_cents: 36_250_00 },
      { id: 'line_finish_materials', label: 'Finish materials draw', amount_cents: 25_625_00 },
    ],
  },
  {
    id: 'inv-weg-04',
    project_id: 'proj_wegrzyn_kitchen',
    project_name: 'Wegrzyn kitchen + primary bath',
    client_name: 'Wegrzyn',
    label: 'Final invoice',
    invoice_no: 'INV-WEG-04',
    milestone: 'Payment 4 of 4',
    status: 'blocked',
    status_label: 'Blocked',
    amount_cents: 36_000_00,
    detail: 'Closeout gate required',
    due_label: 'Closeout first',
    gate_note: 'Final invoice stays blocked until punch, closeout, and client-ready proof are complete.',
    line_ids: ['line_final_punch', 'line_closeout'],
    lines: [
      { id: 'line_final_punch', label: 'Final punch draw', amount_cents: 21_000_00 },
      { id: 'line_closeout', label: 'Closeout balance', amount_cents: 15_000_00 },
    ],
  },
];

export function formatInvoiceMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function invoicesForProject(projectId: string): readonly JobInvoice[] {
  return JOB_INVOICES.filter((invoice) => invoice.project_id === projectId);
}

export function findJobInvoice(invoiceId: string): JobInvoice | null {
  return JOB_INVOICES.find((invoice) => invoice.id === invoiceId) ?? null;
}

export function jobInvoiceContractTotal(projectId: string): number {
  return invoicesForProject(projectId).reduce((sum, invoice) => sum + invoice.amount_cents, 0);
}
