// One-off sample runner — exercises the V1 variance-band cascade against
// the real GGR + Valle onboarding fixtures and prints a markdown table for
// the PR description. Not committed to canon; remove or move under
// `npm run` script once the design pass canonizes it.

import { getVarianceBand } from '../variance/index.js';
import {
  ggrOnboardingSession,
  valleOnboardingSession,
} from '../test-fixtures/index.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';
import type {
  OnboardingAnswerPastProjectExamples,
  PastProjectComparable,
} from '../onboarding/index.js';

function pool(session: typeof ggrOnboardingSession): readonly PastProjectComparable[] {
  const a = session.answers.find((x) => x.kind === 'past_project_examples') as
    | OnboardingAnswerPastProjectExamples
    | undefined;
  if (!a) throw new Error('no past_project_examples');
  return a.payload.examples;
}

interface Case {
  label: string;
  pool: readonly PastProjectComparable[];
  q: { projectTypeTag: ProjectTypeTag; scopeSubset: readonly ScopeTag[] };
}

const cases: Case[] = [
  { label: 'GGR / kitchen_remodel × cabinetry',           pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'kitchen_remodel',      scopeSubset: ['cabinetry'] } },
  { label: 'GGR / kitchen_remodel × ∅',                   pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'kitchen_remodel',      scopeSubset: [] } },
  { label: 'GGR / primary_bath_remodel × tile',           pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'primary_bath_remodel', scopeSubset: ['tile'] } },
  { label: 'GGR / multi_room_remodel × demolition',       pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'multi_room_remodel',   scopeSubset: ['demolition'] } },
  { label: 'GGR / adu × electrical',                      pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'adu',                  scopeSubset: ['electrical'] } },
  { label: 'Valle / cabinetry_only × cabinetry',          pool: pool(valleOnboardingSession), q: { projectTypeTag: 'cabinetry_only',       scopeSubset: ['cabinetry'] } },
  { label: 'Valle / millwork_only × millwork',            pool: pool(valleOnboardingSession), q: { projectTypeTag: 'millwork_only',        scopeSubset: ['millwork'] } },
  { label: 'Valle / cabinetry_only × ∅',                  pool: pool(valleOnboardingSession), q: { projectTypeTag: 'cabinetry_only',       scopeSubset: [] } },
  { label: 'GGR / addition × structural (no comparable)', pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'addition',             scopeSubset: ['structural'] } },
];

const fmt = (cents: number | undefined): string =>
  cents === undefined
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

console.log('| query | rung | confidence | basis | N | p25 | p50 | p75 | p90 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const r = getVarianceBand({
    ...c.q,
    comparablePool: c.pool,
    computedAt: '2026-05-07T19:30:00.000Z',
  });
  const s = r.statistics;
  const rung = r.cascade_rung === null ? 'Final' : String(r.cascade_rung);
  console.log(
    `| ${c.label} | ${rung} | ${r.confidence} | ${r.basis} | ${r.matched_count} | ` +
      `${fmt(s?.p25_cents)} | ${fmt(s?.p50_cents)} | ${fmt(s?.p75_cents)} | ${fmt(s?.p90_cents)} |`,
  );
}
