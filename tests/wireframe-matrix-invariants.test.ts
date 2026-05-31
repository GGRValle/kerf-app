// Executable invariants for the wireframe object-ownership matrix.
// Keeps the audit from rotting into prose: the taxonomy is now self-checking.
// These assert INTENDED-DESIGN consistency (consequence class <-> intended gate),
// NOT runtime enforcement — runtime proof is the separate code-audit lane and is
// tracked per-row in `runtime_write_gate_verified`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSV = fileURLToPath(
  new URL('../docs/wireframes/wireframe_object_ownership_matrix_2026-05-30.csv', import.meta.url),
);

function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  const header = records.shift();
  assert.ok(header, 'CSV has a header row');
  return records
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])) as Record<string, string>);
}

const WRITES = new Set(['none', 'draft', 'durable', 'external_send', 'export', 'money']);
const GATES = new Set(['none', 'parser', 'operator_confirm', 'policy_gate', 'money_guard', 'send_guard', 'egress_guard']);
const STRUCTURE = new Set(['RH-primitive', 'graph-view', 'hybrid']);
const NEEDS = new Set(['yes', 'no', 'maybe']);
const RUNTIME = new Set(['pending', 'verified', 'n/a']);

const rows = parseCsv(readFileSync(CSV, 'utf8'));

test('matrix: 109 rows with the split-axis columns present', () => {
  assert.equal(rows.length, 109);
  const first = rows[0];
  assert.ok(first);
  for (const col of [
    'reads_graph', 'writes_graph', 'intended_write_gate',
    'structure', 'needs_rh_thread', 'runtime_write_gate_verified',
  ]) {
    assert.ok(col in first, `missing column: ${col}`);
  }
});

test('matrix: every cell is in its allowed enum', () => {
  for (const r of rows) {
    assert.ok(r.reads_graph === 'yes' || r.reads_graph === 'no', `${r.surface_id}: reads_graph=${r.reads_graph}`);
    assert.ok(WRITES.has(r.writes_graph), `${r.surface_id}: writes_graph=${r.writes_graph}`);
    assert.ok(GATES.has(r.intended_write_gate), `${r.surface_id}: intended_write_gate=${r.intended_write_gate}`);
    assert.ok(STRUCTURE.has(r.structure), `${r.surface_id}: structure=${r.structure}`);
    assert.ok(NEEDS.has(r.needs_rh_thread), `${r.surface_id}: needs_rh_thread=${r.needs_rh_thread}`);
    assert.ok(RUNTIME.has(r.runtime_write_gate_verified), `${r.surface_id}: runtime=${r.runtime_write_gate_verified}`);
  }
});

// --- consequence-class invariants: writes_graph <-> intended_write_gate ---
test('invariant: a write always names a gate (writes_graph != none -> gate != none)', () => {
  for (const r of rows) {
    if (r.writes_graph !== 'none') {
      assert.notEqual(r.intended_write_gate, 'none', `${r.surface_id} writes ${r.writes_graph} with no gate`);
    }
  }
});

test('invariant: money -> money_guard', () => {
  for (const r of rows) {
    if (r.writes_graph === 'money') assert.equal(r.intended_write_gate, 'money_guard', r.surface_id);
  }
});

test('invariant: external_send -> send_guard', () => {
  for (const r of rows) {
    if (r.writes_graph === 'external_send') assert.equal(r.intended_write_gate, 'send_guard', r.surface_id);
  }
});

test('invariant: export -> operator_confirm | egress_guard', () => {
  for (const r of rows) {
    if (r.writes_graph === 'export') {
      assert.ok(['operator_confirm', 'egress_guard'].includes(r.intended_write_gate), `${r.surface_id} export gate=${r.intended_write_gate}`);
    }
  }
});

test('invariant: durable -> parser | operator_confirm | policy_gate', () => {
  for (const r of rows) {
    if (r.writes_graph === 'durable') {
      assert.ok(['parser', 'operator_confirm', 'policy_gate'].includes(r.intended_write_gate), `${r.surface_id} durable gate=${r.intended_write_gate}`);
    }
  }
});

test('invariant: a Right Hand primitive never needs an external RH thread (it is the thread)', () => {
  for (const r of rows) {
    if (r.structure === 'RH-primitive') assert.equal(r.needs_rh_thread, 'no', r.surface_id);
  }
});
