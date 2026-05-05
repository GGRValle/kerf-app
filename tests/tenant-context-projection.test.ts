import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTenantContextFacts,
  type TenantContextFactPath,
} from '../src/onboarding/index.js';
import { ggrOnboardingSession } from '../src/test-fixtures/ggrOnboardingSession.js';

function byPath(rows: readonly { path: TenantContextFactPath; displayValue: string }[], path: TenantContextFactPath): string {
  const hit = rows.find((row) => row.path === path);
  assert.ok(hit, `missing tenant-context row: ${path}`);
  return hit.displayValue;
}

test('deriveTenantContextFacts returns required tenant_context rows for GGR fixture', () => {
  const rows = deriveTenantContextFacts(ggrOnboardingSession);
  const paths = rows.map((row) => row.path);

  assert.deepEqual(paths, [
    'tenant_context.margin_target',
    'tenant_context.primary_client_segment',
    'tenant_context.preferred_materials_supplier',
    'tenant_context.lead_carpenter_loaded_rate',
    'tenant_context.proposal_style_tone',
    'tenant_context.owner_approval_threshold',
  ]);
});

test('deriveTenantContextFacts formats margin/rate/threshold into display strings', () => {
  const rows = deriveTenantContextFacts(ggrOnboardingSession);

  assert.equal(byPath(rows, 'tenant_context.margin_target'), '45%');
  assert.match(byPath(rows, 'tenant_context.lead_carpenter_loaded_rate'), /^\$\d+\.\d{2}\/hr$/);
  assert.equal(byPath(rows, 'tenant_context.owner_approval_threshold'), '$25,000');
});

test('deriveTenantContextFacts captures primary segment + supplier + proposal tone', () => {
  const rows = deriveTenantContextFacts(ggrOnboardingSession);

  assert.match(byPath(rows, 'tenant_context.primary_client_segment'), /homeowner/i);
  assert.match(byPath(rows, 'tenant_context.preferred_materials_supplier'), /Wood West/i);
  assert.equal(byPath(rows, 'tenant_context.proposal_style_tone'), 'formal-but-friendly');
});

test('deriveTenantContextFacts honors limit option', () => {
  const rows = deriveTenantContextFacts(ggrOnboardingSession, { limit: 3 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.path), [
    'tenant_context.margin_target',
    'tenant_context.primary_client_segment',
    'tenant_context.preferred_materials_supplier',
  ]);
});
