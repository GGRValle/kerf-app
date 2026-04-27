import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_EVENT_SEVERITIES,
  createMemoryEventLog,
  type ComplianceEventPayload,
  type ComplianceEventSeverity,
  type ComplianceKbEntryPayload,
  type Event,
  type SourceRef,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const OSHA_FALL_SOURCE: SourceRef = {
  kind: 'external',
  uri: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.501',
  excerpt: 'Duty to have fall protection.',
};

const IIPP_SOURCE: SourceRef = {
  kind: 'external',
  uri: 'https://www.dir.ca.gov/dosh/etools/09-031/index.htm',
  excerpt: 'California employers must establish, implement, and maintain an IIPP.',
};

const CSLB_SOURCE: SourceRef = {
  kind: 'external',
  uri: 'https://www.cslb.ca.gov/Contractors/Bond_Basics.aspx',
  excerpt: 'CSLB contractor bond requirements.',
};

const sampleComplianceEntry: ComplianceKbEntryPayload = {
  jurisdiction: 'OSHA',
  code: '29 CFR 1926.501',
  title: 'Duty to have fall protection',
  summary: 'Construction employers must provide fall protection systems where required.',
  last_verified_at: '2026-04-27T00:00:00.000Z',
  sources: [OSHA_FALL_SOURCE],
};

test('compliance_kb_entry entity events are typed and round-trip through the event log', async () => {
  const event: Event<ComplianceKbEntryPayload> = {
    id: 'evt_compliance_kb_osha_fall_protection',
    at: '2026-04-27T12:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind: 'entity.created',
    entity: { id: 'compliance_kb_osha_1926_501', kind: 'compliance_kb_entry' },
    payload: sampleComplianceEntry,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    sources: [OSHA_FALL_SOURCE],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.entity.kind, 'compliance_kb_entry');
  assert.equal(appended.kind, 'entity.created');
  assert.equal(Object.isFrozen(appended), true);

  const storedPayload = stored?.payload as ComplianceKbEntryPayload | undefined;
  assert.equal(storedPayload?.jurisdiction, 'OSHA');
  assert.equal(storedPayload?.code, '29 CFR 1926.501');
  assert.equal(storedPayload?.sources.length, 1);
  assert.equal(storedPayload?.sources[0].kind, 'external');
});

test('compliance_event events round-trip for every closed severity variant', async () => {
  const log = createMemoryEventLog();

  for (const severity of COMPLIANCE_EVENT_SEVERITIES) {
    const payload: ComplianceEventPayload = {
      kbEntryId: 'compliance_kb_osha_1926_501',
      severity,
      detectedAt: '2026-04-27T13:00:00.000Z',
      attestationId: severity === 'info' ? 'attestation_iipp_2026_04' : undefined,
      remediation:
        severity === 'violation'
          ? 'Pause exterior second-story work until fall-protection plan is attached.'
          : undefined,
    };
    const event: Event<ComplianceEventPayload> = {
      id: `evt_compliance_${severity}`,
      at: '2026-04-27T13:00:00.000Z',
      actor: ACTORS.cosAgent,
      kind: 'compliance_event',
      entity: { id: 'compliance_kb_osha_1926_501', kind: 'compliance_kb_entry' },
      payload,
      data_class: 'internal',
      retention_policy: 'until_close+7y',
      privilege_class: null,
      sources: [OSHA_FALL_SOURCE],
    };

    const appended = await log.append(event);
    assert.equal(appended.kind, 'compliance_event');
    assert.equal(appended.entity.kind, 'compliance_kb_entry');
    assert.equal((appended.payload as ComplianceEventPayload).severity, severity);
  }
});

test('ComplianceKbEntryPayload requires at least one SourceRef (source-or-silent)', () => {
  // Type-level enforcement via the non-empty tuple `[SourceRef, ...SourceRef[]]`.
  // If the type ever loosens, this `// @ts-expect-error` stops compiling.
  const _emptyShouldFailTypecheck: ComplianceKbEntryPayload = {
    jurisdiction: 'OSHA',
    code: '29 CFR 1926.501',
    title: 'Duty to have fall protection',
    summary: 'Construction fall-protection requirement.',
    last_verified_at: '2026-04-27T00:00:00.000Z',
    // @ts-expect-error sources must be non-empty per source-or-silent
    sources: [],
  };

  assert.equal(Array.isArray(_emptyShouldFailTypecheck.sources), true);
});

test('compliance KB entries cover regulatory bodies and open local jurisdictions', () => {
  const jurisdictions = [
    'OSHA',
    'CA-IIPP',
    'CSLB',
    'EPA',
    'state',
    'federal',
    'local',
    'industry',
    'city-of-poway',
  ];
  const entries: ComplianceKbEntryPayload[] = jurisdictions.map((jurisdiction) => ({
    jurisdiction,
    code: `${jurisdiction}-REFERENCE`,
    title: `${jurisdiction} compliance reference`,
    summary: 'Placeholder KB row shape for a curated compliance reference.',
    last_verified_at: '2026-04-27T00:00:00.000Z',
    sources: [jurisdiction === 'CA-IIPP' ? IIPP_SOURCE : jurisdiction === 'CSLB' ? CSLB_SOURCE : OSHA_FALL_SOURCE],
  }));
  const severities = ['info', 'warning', 'violation'] satisfies ComplianceEventSeverity[];

  assert.deepEqual(entries.map((entry) => entry.jurisdiction), jurisdictions);
  assert.deepEqual([...COMPLIANCE_EVENT_SEVERITIES], severities);
});
