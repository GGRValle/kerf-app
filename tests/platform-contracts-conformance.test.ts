import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runContractsConformance } from '../src/platform/contractsConformance.js';
import { requiresConfirmation, isAutonomousAllowed } from '../src/platform/gateAffordance.js';
import { validateTwoArtifactPair } from '../src/contracts/lane1/twoArtifact.js';

describe('platform contracts-conformance harness (Lane 8 re-homed)', () => {
  it('platform modules pass with only expected gaps cleared', () => {
    const report = runContractsConformance();
    assert.equal(report.platformReady, true, JSON.stringify(report.findings.filter((f) => f.severity === 'block')));
    assert.equal(report.ok, true);
  });

  it('consequence gate: read free, durable_write confirm, money/send never autonomous', () => {
    assert.equal(requiresConfirmation('read'), false);
    assert.equal(requiresConfirmation('answer'), false);
    assert.equal(requiresConfirmation('durable_write'), true);
    assert.equal(isAutonomousAllowed('money_write'), false);
    assert.equal(isAutonomousAllowed('send'), false);
  });

  it('validateTwoArtifactPair rejects ref mismatch', () => {
    const bad = validateTwoArtifactPair({
      work: {
        id: 'work_a',
        kind: 'job_note',
        locality: { tenant: 'tenant_ggr', consequence_tier: 'reversible' },
        surface_route: '/projects/p1',
        created_at: '2026-06-02T00:00:00.000Z',
      },
      attention: {
        id: 'att_a',
        work_artifact_ref: 'work_b',
        state: 'needs_you',
        domain: 'field',
        headline: 'Test',
        because: 'Test',
        consequence_tier: 'reversible',
        source_ref: 'src:test',
        role_scope: ['owner'],
        locality: { tenant: 'tenant_ggr', consequence_tier: 'reversible' },
      },
    });
    assert.equal(bad.ok, false);
  });
});
