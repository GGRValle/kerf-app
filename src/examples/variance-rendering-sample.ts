// One-off sample runner — produces operator-facing rendered variance bands
// against real GGR + Valle fixtures so the trust-discipline language can
// be eyeballed end-to-end.

import { renderVarianceBand } from '../estimator/varianceIntegration/index.js';
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
  { label: 'Valle / cabinetry_only × cabinetry (HIGH)',         pool: pool(valleOnboardingSession), q: { projectTypeTag: 'cabinetry_only',  scopeSubset: ['cabinetry'] } },
  { label: 'GGR / kitchen_remodel × cabinetry (LOW fallback)',  pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'kitchen_remodel', scopeSubset: ['cabinetry'] } },
  { label: 'GGR / addition × structural (LOW cross-archetype)', pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'addition',        scopeSubset: ['structural'] } },
  { label: 'Valle / cabinetry_only × ∅ (HIGH BY_ARCHETYPE)',    pool: pool(valleOnboardingSession), q: { projectTypeTag: 'cabinetry_only',  scopeSubset: [] } },
  { label: 'GGR / primary_bath × tile (INSUFFICIENT_DATA)',     pool: pool(ggrOnboardingSession),   q: { projectTypeTag: 'primary_bath_remodel', scopeSubset: ['tile'] } },
];

for (const c of cases) {
  const cascadeResult = getVarianceBand({
    ...c.q,
    comparablePool: c.pool,
    computedAt: '2026-05-07T20:00:00.000Z',
  });
  const rendered = renderVarianceBand(cascadeResult);
  console.log('─'.repeat(72));
  console.log(`CASE: ${c.label}`);
  console.log(`  rung=${rendered.cascade_rung} confidence=${rendered.confidence} ` +
    `precision_allowed=${rendered.precision_allowed} basis=${rendered.basis}`);
  console.log(`  source_ref: ${rendered.source_refs[0]?.uri}`);
  console.log(`  operator_summary:`);
  console.log(`    ${rendered.operator_summary}`);
}
console.log('─'.repeat(72));
