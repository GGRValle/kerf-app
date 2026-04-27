import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedClock } from '../src/shared/index.js';
import {
  applyInvoiceFollowupApprovalAction,
  detectInvoiceFollowupCandidates,
  draftInvoiceFollowup,
  requestInvoiceFollowupApproval,
  type InvoiceFollowupFacts,
} from '../src/workflows/index.js';

const AS_OF = fixedClock('2026-04-10T12:00:00.000Z');

function baseFacts(overrides: Partial<InvoiceFollowupFacts> = {}): InvoiceFollowupFacts {
  return {
    invoices: [
      {
        id: 'inv_001',
        invoiceNumber: 'GGR-2026-0042',
        status: 'sent',
        amountCents: 200_000,
        dueDate: '2026-04-05T00:00:00.000Z',
        clientId: 'client_001',
        projectId: 'project_001',
      },
    ],
    clients: [{ id: 'client_001', name: 'Clem Homeowner', email: 'clem@example.com' }],
    projects: [{ id: 'project_001', name: 'Clem Kitchen Remodel' }],
    payments: [],
    ...overrides,
  };
}

test('detects an eligible overdue unpaid invoice', () => {
  const candidates = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].invoiceId, 'inv_001');
  assert.equal(candidates[0].remainingCents, 200_000);
  assert.equal(candidates[0].daysPastDue, 5);
  assert.equal(candidates[0].event.kind, 'invoice_followup.detected');
  assert.equal(candidates[0].event.workflow, 'invoice_followup');
  assert.equal(candidates[0].event.action_class, 'read_only');
  assert.equal(candidates[0].event.decision_altitude, 'L0');
  assert.equal(candidates[0].event.entity.decision_altitude, 'L0');
});

test('excludes paid, void, draft, and not-yet-due invoices', () => {
  const candidates = detectInvoiceFollowupCandidates(
    baseFacts({
      invoices: [
        {
          id: 'inv_paid',
          status: 'paid',
          amountCents: 100_000,
          dueDate: '2026-04-01T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
        {
          id: 'inv_void',
          status: 'void',
          amountCents: 100_000,
          dueDate: '2026-04-01T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
        {
          id: 'inv_draft',
          status: 'draft',
          amountCents: 100_000,
          dueDate: '2026-04-01T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
        {
          id: 'inv_future',
          status: 'sent',
          amountCents: 100_000,
          dueDate: '2026-04-11T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
        {
          id: 'inv_today',
          status: 'viewed',
          amountCents: 100_000,
          dueDate: '2026-04-10T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
      ],
    }),
    { clock: AS_OF },
  );

  assert.deepEqual(candidates, []);
});

test('calculates remaining balance from partial payments', () => {
  const candidates = detectInvoiceFollowupCandidates(
    baseFacts({
      invoices: [
        {
          id: 'inv_partial',
          invoiceNumber: 'GGR-2026-0043',
          status: 'partial',
          amountCents: 200_000,
          dueDate: '2026-04-05T00:00:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
      ],
      payments: [
        {
          id: 'pay_before',
          invoiceId: 'inv_partial',
          amountCents: 50_000,
          receivedAt: '2026-04-08T12:00:00.000Z',
        },
        {
          id: 'pay_after',
          invoiceId: 'inv_partial',
          amountCents: 25_000,
          receivedAt: '2026-04-11T12:00:00.000Z',
        },
      ],
    }),
    { clock: AS_OF },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].paidCents, 50_000);
  assert.equal(candidates[0].remainingCents, 150_000);
});

test('calculates days past due with the injected clock', () => {
  const candidates = detectInvoiceFollowupCandidates(
    baseFacts({
      invoices: [
        {
          id: 'inv_late_day',
          status: 'sent',
          amountCents: 100_000,
          dueDate: '2026-04-07T23:30:00.000Z',
          clientId: 'client_001',
          projectId: 'project_001',
        },
      ],
    }),
    { clock: fixedClock('2026-04-10T12:00:00.000Z') },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].daysPastDue, 3);
});

test('draft includes source facts and Blackboard-ready draft metadata', () => {
  const [candidate] = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });
  const draft = draftInvoiceFollowup(candidate);

  assert.match(draft.message, /GGR-2026-0042/);
  assert.match(draft.message, /\$2,000.00/);
  assert.equal(draft.event.kind, 'invoice_followup.drafted');
  assert.equal(draft.event.action_class, 'draft');
  assert.equal(draft.event.payload.message, draft.message);
  assert.ok(
    draft.sourceFacts.some(
      (fact) =>
        fact.source === 'invoice.amountCents - payments.amountCents' &&
        fact.value === 200_000,
    ),
  );
  assert.ok(draft.sourceFacts.some((fact) => fact.source === 'INVOICE_FOLLOWUP_PAYMENT_TERMS'));
});

test('approval request carries decision authority and action metadata', () => {
  const [candidate] = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });
  const draft = draftInvoiceFollowup(candidate);
  const request = requestInvoiceFollowupApproval(draft, {
    requestId: 'approval_inv_001',
    decisionAuthority: { role: 'owner', actorId: 'u-christian' },
  });

  assert.equal(request.id, 'approval_inv_001');
  assert.equal(request.state, 'requested');
  assert.equal(request.decisionAuthority.role, 'owner');
  assert.equal(request.decisionAuthority.actorId, 'u-christian');
  assert.equal(request.actionClass, 'send_external');
  assert.deepEqual(
    request.actions.map((action) => [action.action, action.actionClass]),
    [
      ['approve', 'send_external'],
      ['edit', 'send_external'],
      ['reject', 'draft'],
    ],
  );
  assert.equal(request.event.kind, 'invoice_followup.approval_requested');
  assert.equal(request.event.decision_authority.actorId, 'u-christian');
  assert.equal(request.event.decision_altitude, 'L0');
});

test('approve, edit, and reject are pure state transitions', () => {
  const [candidate] = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });
  const draft = draftInvoiceFollowup(candidate);
  const request = requestInvoiceFollowupApproval(draft, { requestId: 'approval_inv_001' });
  const decidedClock = fixedClock('2026-04-10T13:00:00.000Z');

  const approved = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'approve' },
    { clock: decidedClock },
  );
  assert.equal(approved.state, 'approved');
  assert.equal(approved.approvedMessage, draft.message);
  assert.equal(approved.event.kind, 'invoice_followup.approved');
  assert.equal(approved.event.action_class, 'send_external');
  assert.equal(approved.event.decision_altitude, 'L0');

  const edited = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'edit', editedMessage: ' Please use this revised reminder. ' },
    { clock: decidedClock },
  );
  assert.equal(edited.state, 'edited');
  assert.equal(edited.approvedMessage, 'Please use this revised reminder.');
  assert.equal(edited.event.kind, 'invoice_followup.approved');

  const rejected = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'reject', reason: 'Client already paid.' },
    { clock: decidedClock },
  );
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.approvedMessage, null);
  assert.equal(rejected.rejectionReason, 'Client already paid.');
  assert.equal(rejected.event.kind, 'invoice_followup.rejected');
  assert.equal(rejected.event.action_class, 'draft');
});
