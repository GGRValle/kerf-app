# V1.5 Invoice Artifact Surface — Design
## Internal invoice generation + review/approval lifecycle for the GGR/Valle internal release

- **Date prepared:** 2026-05-15
- **Repo state at draft:** `main@bd4cf27` (post-PR #164)
- **Author:** Claude (Agent 8, integration lead)
- **Audience:** Christian, ChatGPT, Codex (review on 2026-05-16)
- **Status:** Design draft. **No code in this PR.** Pins Priority 4 of the 30-day brief (currently 0% complete) so Codex can review the shape alongside persistence on May 16.

---

## 1. Why this exists

The 2026-05-14 30-day brief Priority 4 names *"internal invoice artifacts"* as a real GGR/Valle requirement:

- Invoice generation INSIDE the system
- Review/approval gating
- Exportable structures
- Future QBO feed compatibility shape
- **NO direct QBO writes in this phase**

The current V1.5 spine ends at F-37 audit. Operator can review a draft, approve a decision, see an audit trail — but cannot turn an approved decision packet into an invoice artifact that can be reviewed, approved as final, and exported.

This doc designs that surface. **No autonomous money writes; no external sends.** The architectural posture from the 30-day brief is non-negotiable.

---

## 2. Non-negotiables (from the 30-day brief)

Mirrored verbatim:

- ✅ Deterministic core; LLMs at edges only
- ✅ All LLM output untrusted; schema/business-rule validation before side effects
- ✅ No autonomous pricing authority
- ✅ No autonomous money movement
- ✅ No external sends without approval
- ✅ Money as integer cents
- ✅ Structured artifacts shared between agents (not giant prompts)
- ❌ NOT building: QBO writes, direct accounting integration, payment processing, customer-portal billing

---

## 3. The invoice lifecycle this surface supports

Per the operational loop in the 30-day brief:

```
decision approved (F-36)  →  invoice drafted  →  operator reviews/edits
                          →  operator approves invoice (separate gate)
                          →  invoice locked (immutable artifact)
                          →  audit trail entry
                          →  EXPORTABLE STRUCTURE generated (PDF / .iif / .csv)
                          ↳  NOT auto-sent; NOT auto-written to QBO
```

The invoice is an **artifact**, not a transaction. It's a printable / exportable / forwardable structure the operator can copy/paste into QBO, mail to the client, or save as a record. Kerf never sends it anywhere on its own.

---

## 4. Data model

### 4.1 The invoice artifact

```typescript
export interface InvoiceArtifact {
  readonly invoice_id: string;            // ULID/UUID
  readonly tenant_id: PersistenceTenantId; // tenant_ggr | tenant_valle
  readonly project_id: string;             // links to the project that owns this invoice
  readonly decision_packet_id: string;     // source of truth — the approved decision this invoice draws from
  readonly invoice_kind: 'proposal' | 'progress_billing' | 'change_order' | 'final';
  readonly status: InvoiceStatus;
  readonly issue_date: string;             // ISO8601; operator-controlled
  readonly due_date: string | null;        // ISO8601; operator-controlled
  readonly client: InvoiceClient;
  readonly line_items: readonly InvoiceLineItem[];
  readonly subtotal_cents: number;         // integer cents; computed from line_items
  readonly tax_cents: number;              // integer cents; operator-entered (no jurisdiction lookup)
  readonly total_cents: number;            // integer cents; subtotal_cents + tax_cents
  readonly notes: string;                  // free-text operator field
  readonly terms: string;                  // payment terms language (operator-controlled)
  readonly source_refs: readonly SourceRef[]; // audit lineage — links back to scaffold + decision
  readonly created_at: string;             // ISO8601
  readonly created_by: PersistenceActor;
  readonly locked_at: string | null;       // null until operator approves; set on approval
  readonly locked_by: PersistenceActor | null;
}

export type InvoiceStatus =
  | 'draft'             // operator is editing
  | 'review'            // operator marked ready for review (gate before approval)
  | 'approved'          // operator approved; artifact is immutable
  | 'voided';           // operator marked void (rare; preserves audit)

export interface InvoiceClient {
  readonly name: string;
  readonly address_lines: readonly string[]; // free-form; no jurisdiction parsing
  readonly contact_email: string | null;     // optional; never auto-sent
  readonly contact_phone: string | null;
}

export interface InvoiceLineItem {
  readonly line_id: string;
  readonly description: string;
  readonly quantity: number;                 // can be fractional (e.g., 14.5 LF)
  readonly uom: string;                      // 'EA', 'LF', 'SF', 'LS', 'HR', etc.
  readonly unit_cents: number;               // integer cents per unit
  readonly extended_cents: number;           // integer cents = quantity × unit (rounded)
  readonly notes: string;                    // operator-controlled
  /** Optional links back to scaffold provenance — preserved when the line came from a scaffold. */
  readonly scaffold_provenance: InvoiceScaffoldProvenance | null;
}

export interface InvoiceScaffoldProvenance {
  readonly scaffold_id: string;
  readonly scaffold_line_id: string;
  readonly quantity_basis: string;          // mirrors KitchenScaffoldQuantityBasis
  readonly materials_basis: string;
}
```

### 4.2 Persistence events (additions to Step 1 vocabulary)

Three new event types — proposed for inclusion in `src/persistence/events.ts` after Codex review:

- `invoice.drafted` — operator generates a new invoice from an approved decision packet
- `invoice.edited` — operator edits a line item / total / note; emitted per edit batch
- `invoice.approved` — operator marks the invoice as final; locks the artifact

(No `invoice.sent` — Kerf doesn't send.)

(No `invoice.exported` — operator-driven export to file is a UI action, not a state transition; if we want to log it, fine, but it's not architectural.)

### 4.3 Storage

Per the persistence design (Steps 3-4):

```
.kerf/
  projects/
    tenant_ggr/
      proj_<id>/
        invoices/
          <invoice_id>.json      # the artifact (latest state, projection)
          <invoice_id>-export.pdf
          <invoice_id>-export.iif # QuickBooks import file (future)
```

The `events.jsonl` carries the narrative; the per-invoice JSON is the read-side projection.

---

## 5. The drafting flow

### Step 1 — Operator approves a decision (F-36)
Current behavior; no change.

### Step 2 — "Generate invoice" action on the approved decision
On F-36 (or a new `/invoices/<id>` route), operator clicks **"Generate invoice draft from decision"**. The system:

1. Reads the decision packet + scaffold lines.
2. Maps each scaffold line → an `InvoiceLineItem` (description, quantity, uom; unit_cents and extended_cents come from operator's KB rates, NOT from tier-1 ranges).
3. **`unit_cents` MUST be operator-entered or KB-locked** — never inferred from a tier-1 range (per the safety-gate rule: ranges aren't quotes).
4. If no operator KB rate exists for a line, the invoice line starts with `unit_cents: 0` and a `notes` field saying *"unit rate required before approval"*.
5. Emits `invoice.drafted` event.

### Step 3 — Operator edits draft
Inline edit of: description, quantity, uom, unit_cents, notes. Edits emit `invoice.edited` events.

### Step 4 — Operator marks "ready for review"
Same person could approve (single-operator GGR/Valle today) OR a second person (estimator submits → owner approves). Status → `review`.

### Step 5 — Operator approves
Validates: every line has `unit_cents > 0`; tax_cents is set; due_date is set (or explicitly null with note); subtotal/tax/total math checks. Sets `locked_at` + `locked_by`. Status → `approved`. Emits `invoice.approved`.

### Step 6 — Operator exports
Buttons on the approved-state invoice surface:
- **Download PDF** — renders the invoice to a print-friendly HTML page; browser print-to-PDF
- **Download .iif** — generates QuickBooks-IIF import file (future, Week 3+)
- **Download .csv** — line-item CSV for ad-hoc import

**No "send" button.** No email. No fax. No QBO write. Operator copies/saves/forwards from their own desktop.

---

## 6. UI surfaces

### 6.1 `/invoices` — list view
Per-project list of invoices: draft / review / approved / voided. Filterable by status, kind, date.

### 6.2 `/invoices/<invoice_id>` — detail view
- Read state when approved (immutable)
- Edit state when draft / review
- Status chip (matches F-34 severity chip pattern)
- "Generate from decision" / "Edit line" / "Mark for review" / "Approve" / "Void" actions per current state

### 6.3 `/invoices/<invoice_id>/print` — print-friendly render
Clean HTML page suitable for browser print-to-PDF. No system chrome; logo + client info + line items + totals + terms.

### 6.4 Decision card extension
On F-36 detail (`/decisions/<id>`), add a section: *"Invoice artifacts derived from this decision"* listing any invoices that link back via `decision_packet_id`.

---

## 7. Validation rules (locked at the type + write layer)

Every invoice that reaches `approved` status must pass:

| Rule | Enforced at |
|---|---|
| Every line has `unit_cents > 0` | `validateInvoice()` on transition to `approved` |
| `extended_cents === Math.round(quantity × unit_cents)` per line | `validateInvoice()` |
| `subtotal_cents === sum(line.extended_cents)` | `validateInvoice()` |
| `total_cents === subtotal_cents + tax_cents` | `validateInvoice()` |
| `tax_cents >= 0` (no negative tax) | `validateInvoice()` |
| `quantity > 0` per line (no zero/negative lines on approved invoices) | `validateInvoice()` |
| `due_date >= issue_date` when both present | `validateInvoice()` |
| All cents fields are integers (no floats) | TypeScript + runtime validator |
| Source decision packet exists and is itself in `approved` state | Cross-reference at draft generation |

A draft can be in any intermediate state. Only the `approved` transition enforces all rules.

---

## 8. What this design intentionally does NOT include

Per the 30-day brief:

- ❌ Auto-send to client (no email, no SMS, no portal upload)
- ❌ Direct QBO API writes (IIF file generation is in-scope as an export; the operator imports it)
- ❌ Payment processing (no Stripe, no ACH, no card)
- ❌ Multi-tenant invoice routing (single-tenant; tenant_id is forward-compat flag)
- ❌ Subscription / recurring billing
- ❌ Tax-rate jurisdiction lookup (operator enters tax cents manually)
- ❌ Client signature capture (out of scope for this phase)
- ❌ Multi-currency (USD only; integer cents)
- ❌ Markup / margin computation (the invoice carries the final price; how the operator built it is their own concern)
- ❌ Time-and-materials live tracking (no T&M timer; operator enters the final hours after the fact)

---

## 9. Open questions for Codex review (May 16)

1. **Invoice provenance to decision packet** — should `invoice.drafted` carry the full snapshot of scaffold line provenance, or just the `decision_packet_id` reference and re-read at render time? Snapshot is heavier on event size but stable if scaffold changes later; reference is leaner but requires scaffold to stay readable.

2. **"Approved" → "Voided" transition** — should a voided invoice keep `locked_at` + `locked_by`, or null them on void? Audit-preservation argument says keep; clarity argument says null.

3. **Line-item edit granularity for `invoice.edited`** — per-field (12 edits = 12 events) or per-line (12 edits to one line = 1 event)? Per-line matches PR #155's scaffold.refined pattern, so probably per-line is right.

4. **PDF rendering** — browser print-to-PDF (HTML route + CSS print stylesheet) vs server-side PDF library? Browser is simpler + matches the V1.5 single-tenant local posture. Server-side PDF would add a Node dependency we don't need yet.

5. **IIF export format** — should we write the IIF generator in this phase or defer to Week 3? The format is well-documented + small. Writing it now lets Christian dogfood the QBO-import path immediately. Deferring keeps Week 2 focused on the surface itself.

6. **Multiple invoices per decision** — can one decision packet support multiple invoices (progress billing 1, progress billing 2, final)? The data model allows it (decision_packet_id is many-to-one). UX needs to make this navigable.

7. **Change-order invoices** — a CO is structurally a new invoice tied to a "change_order" decision packet that itself references the parent project. Is `invoice_kind: 'change_order'` enough, or do we need a separate ChangeOrderArtifact type?

---

## 10. Build plan (after Codex review)

| Step | Description | Effort |
|---|---|---|
| **Step A** | Add `invoice.drafted`, `invoice.edited`, `invoice.approved` to the persistence events vocabulary (extends Step 1 PR #165) | 1 hour |
| **Step B** | Define `InvoiceArtifact` types in `src/persistence/invoice.ts` + validation | 2 hours |
| **Step C** | "Generate invoice draft from decision" action in F-36 + endpoint | 3 hours |
| **Step D** | Invoice list (`/invoices`) + detail (`/invoices/<id>`) routes | 4 hours |
| **Step E** | Inline-edit UI for draft invoices | 3 hours |
| **Step F** | "Mark for review" + "Approve" + "Void" transitions | 2 hours |
| **Step G** | Print-friendly route (`/invoices/<id>/print`) with print CSS | 2 hours |
| **Step H** | Export buttons: PDF (browser print), CSV (line-item dump) | 1 hour |
| **Step I** | IIF export (QuickBooks import file) — **Week 3** | 4 hours |

**Total estimated effort:** ~20 hours of build (3 days of focused work) for Steps A–H; +4 hours Week 3 for IIF.

Pacing: probably starts late Week 1 once persistence (Step 2-6) lands, runs through Week 2.

---

## 11. What I'm explicitly NOT proposing tonight

- ❌ Code (this is design only)
- ❌ Schema commitments before Codex review (the 7 open questions need answers)
- ❌ UI mockups (the V1.5 wireframes already exist per the 30-day brief; this design assumes the visual language)
- ❌ Cursor brief for any Step (briefs come after Codex review locks the design)

---

## 12. Decision needed

Three things needed from you + Codex before Step A code starts:

1. **Approve the data model shape.** If `InvoiceArtifact` is wrong (missing fields, wrong UoMs, wrong status transitions), Step A loses its anchor.
2. **Pick a default on the 7 open questions.** Either you decide directly, or you defer to Codex tomorrow.
3. **Decide whether IIF export (Step I) is in-Week-2 scope or Week 3.** Affects sequencing.

Once Codex unlocks decisions, Step A is a small extension to PR #165 (~1 hour). Step B-H runs through late Week 1 + Week 2.
