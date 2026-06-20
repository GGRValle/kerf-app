/**
 * Smoke seed for the per-job Money / Invoice surfaces (#404 follow-up).
 * Locks: tenant/id scoping, a graduated (gate.allowed) basis with line ids, a
 * tied-out proposal projecting billable deposit + final (→ 'ready' on the page),
 * the CA §7159 cap, no internal-vocab leak, the page fallback wiring, and the
 * no-store/no-ledger/no-money-write invariant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRightHandSmokeDraft,
  SMOKE_ESTIMATE_ID,
  SMOKE_PROJECT_ID,
} from '../src/app/lib/rightHandSmokeFixtures.js';
import { buildProposalFromRightHandEstimate } from '../src/api/lib/estimateProposalProjection.js';
import { buildInvoiceFromRightHandEstimate } from '../src/api/lib/estimateInvoiceProjection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-06-18T12:00:00.000Z');
const TENANT = 'tenant_ggr';

test('smoke fixture is id- and tenant-scoped (null for anything else)', () => {
  assert.equal(getRightHandSmokeDraft('rhe_other', TENANT), null);
  assert.equal(getRightHandSmokeDraft(SMOKE_ESTIMATE_ID, 'tenant_other'), null);
  const d = getRightHandSmokeDraft(SMOKE_ESTIMATE_ID, TENANT);
  assert.ok(d, 'returns the draft for the smoke id + tenant');
  assert.equal(d.tenant_id, TENANT);
  assert.equal(d.project_id, SMOKE_PROJECT_ID);
});

test('smoke draft is graduated (gate.allowed) and carries line ids', () => {
  const d = getRightHandSmokeDraft(SMOKE_ESTIMATE_ID, TENANT);
  assert.ok(d);
  assert.equal(d.gate.allowed, true);
  assert.equal(d.gate.blocked_reasons.length, 0);
  assert.ok(d.lines.length >= 2);
  for (const line of d.lines) {
    assert.ok(line.id.length > 0, 'each line carries an id (line_id carry-through)');
    assert.equal(line.source_type, 'company_data');
    assert.ok(line.flags.includes('operator_graduated'));
    assert.ok((line.extended_cents ?? 0) > 0, 'each line is priced');
  }
});

test('smoke draft projects a tied-out proposal + billable deposit & final (→ ready)', () => {
  const d = getRightHandSmokeDraft(SMOKE_ESTIMATE_ID, TENANT);
  assert.ok(d);
  const basis = buildProposalFromRightHandEstimate(d, { now: NOW });
  assert.ok(basis.proposal.total_cents > 0, 'proposal basis ties out to a positive total');
  const down = buildInvoiceFromRightHandEstimate(d, { now: NOW, milestone: 'down_payment' }).invoice;
  const final = buildInvoiceFromRightHandEstimate(d, { now: NOW, milestone: 'final' }).invoice;
  assert.ok(down.amount_due_cents > 0, 'deposit is billable → ready');
  assert.ok(final.amount_due_cents > 0, 'final is billable → ready');
  assert.ok(down.amount_due_cents <= 100_000, 'down payment respects the CA §7159 $1,000 cap');
});

test('smoke draft leaks no internal vocabulary into operator/client copy', () => {
  const d = getRightHandSmokeDraft(SMOKE_ESTIMATE_ID, TENANT);
  assert.ok(d);
  for (const line of d.lines) {
    assert.doesNotMatch(line.label, /Kerf|MODEL_INFERENCE|KERF_SEED|kerf:\/\//i);
    assert.doesNotMatch(line.description, /Kerf|MODEL_INFERENCE|KERF_SEED|kerf:\/\//i);
  }
  assert.doesNotMatch(d.title, /Kerf/i);
});

test('money + invoice pages fall back to the tenant-scoped smoke fixture', () => {
  const money = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/money.astro'), 'utf8');
  const invoice = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/invoice.astro'), 'utf8');
  for (const [name, src] of [['money', money], ['invoice', invoice]] as const) {
    assert.match(src, /getRightHandSmokeDraft\(estimateId, tenant\)/, `${name} consults the smoke fixture`);
    // fixture is a precedence FALLBACK — the real store still backs every other id
    assert.match(src, /getRightHandEstimateStore\(\)\.read\(tenant, estimateId\)/, `${name} keeps the real store path`);
  }
});

test('smoke fixture itself performs no store/ledger/money write', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/lib/rightHandSmokeFixtures.ts'), 'utf8');
  assert.doesNotMatch(src, /\.save\(|getInvoiceLedgerStore|invoice\/issue|issueInvoice|appendLedger/, 'fixture writes nothing');
});

test('smoke money page keeps Issue controls but the issue handler is read-only on the fixture', () => {
  const money = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/money.astro'), 'utf8');
  // Issue controls still render for the allowed (deposit/final) milestones
  assert.match(money, /data-issue-milestone/, 'issue controls still render');
  // The page marks itself a smoke fixture only when the smoke draft supplied it
  assert.match(money, /const isSmokeFixture = smokeDraft !== null/, 'frontmatter derives the smoke flag');
  assert.match(money, /data-smoke=\{isSmokeFixture \? 'true' : undefined\}/, 'article carries the smoke flag');
  // The client handler reads the flag and short-circuits BEFORE the POST
  const script = (money.match(/<script>[\s\S]*?<\/script>/) ?? [''])[0];
  assert.match(script, /dataset\['smoke'\] === 'true'/, 'handler reads the smoke flag');
  assert.match(script, /Smoke fixture is read-only\. Nothing was recorded\./, 'clear read-only message');
  const guardIdx = script.indexOf('Smoke fixture is read-only');
  const fetchIdx = script.indexOf('/invoice/issue');
  assert.ok(guardIdx > 0 && fetchIdx > 0 && guardIdx < fetchIdx, 'the read-only guard precedes the issue POST (no write on smoke)');
});
