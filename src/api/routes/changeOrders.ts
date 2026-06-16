import { Hono } from 'hono';

import {
  decideChangeOrder,
  getChangeOrderByDecisionId,
  submitChangeOrderForReview,
  type ChangeOrderSubmission,
} from '../../app/lib/changeOrderFlow.js';
import type { BuilderLine } from '../../app/lib/builderEngine.js';

export const changeOrderRoutes = new Hono();

interface SubmitBody {
  project_id?: string;
  title?: string;
  lines?: BuilderLine[];
  total_cents?: number;
  operator_confirm?: boolean;
}

interface DecideBody {
  action?: 'approve' | 'reject' | 'needs_review';
  operator_confirm?: boolean;
  reason?: string;
}

changeOrderRoutes.post('/change-orders/submit-for-review', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as SubmitBody;
  if (body.operator_confirm !== true) {
    return c.json({ error: 'operator_confirm_required', message: 'Confirm before routing to the Decision Card.' }, 400);
  }
  if (!body.project_id || !Array.isArray(body.lines) || typeof body.total_cents !== 'number') {
    return c.json({ error: 'invalid_body' }, 400);
  }

  try {
    const submission: ChangeOrderSubmission = {
      project_id: body.project_id,
      title: body.title ?? 'Change Order',
      lines: body.lines,
      total_cents: body.total_cents,
    };
    const result = submitChangeOrderForReview(submission);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'submit_failed';
    return c.json({ error: message }, 400);
  }
});

changeOrderRoutes.get('/change-orders/by-decision/:decisionId', (c) => {
  const decisionId = c.req.param('decisionId');
  const record = getChangeOrderByDecisionId(decisionId);
  if (!record) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({
    change_order_id: record.change_order_id,
    decision_id: record.decision_id,
    project_id: record.project_id,
    status: record.status,
    total_cents: record.total_cents,
    line_ids: record.line_ids,
    contract_id: record.contract_id,
    contract_adjusted_at: record.contract_adjusted_at ?? null,
  });
});

changeOrderRoutes.post('/change-orders/:changeOrderId/decide', async (c) => {
  const changeOrderId = c.req.param('changeOrderId');
  const body = (await c.req.json().catch(() => ({}))) as DecideBody;
  if (body.operator_confirm !== true) {
    return c.json({ error: 'operator_confirm_required', message: 'Visible approval gate — confirm before deciding.' }, 400);
  }
  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'needs_review') {
    return c.json({ error: 'invalid_action' }, 400);
  }

  try {
    const result = decideChangeOrder({
      change_order_id: changeOrderId,
      action: body.action,
      operator_confirm: true,
      reason: body.reason,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'decide_failed';
    const status = message.startsWith('unknown_') ? 404 : 400;
    return c.json({ error: message }, status);
  }
});
