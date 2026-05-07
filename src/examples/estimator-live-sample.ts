// Live Estimator end-to-end sample — exercises the full chain against
// the real Groq endpoint and prints token + cost data for the PR brief.
//
// Run with: `npm run sample:estimator-live` (loads .env.local).
// CI does NOT run this — it requires a real API key. Tests use a stub
// modelCaller and stay hermetic.

import {
  estimateProject,
  makeGroqModelCaller,
} from '../estimator/orchestration/index.js';
import { ggrOnboardingSession } from '../test-fixtures/index.js';
import type {
  OnboardingAnswerPastProjectExamples,
  PastProjectComparable,
} from '../onboarding/index.js';
import { nanoUsdToUsdString } from '../altitude/modelAdapter/index.js';

function readEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`${name} not set — run via 'npm run sample:estimator-live' which loads .env.local`);
  }
  return v;
}

function ggrPool(): readonly PastProjectComparable[] {
  const a = ggrOnboardingSession.answers.find((x) => x.kind === 'past_project_examples') as
    | OnboardingAnswerPastProjectExamples
    | undefined;
  if (!a) throw new Error('no past_project_examples');
  return a.payload.examples;
}

async function main(): Promise<void> {
  const apiKey = readEnv('GROQ_API_KEY');
  const baseUrl = readEnv('GROQ_BASE_URL');

  const modelCaller = makeGroqModelCaller({ apiKey, baseUrl });

  const inputs = {
    tenantId: 'tenant_ggr',
    projectArchetype: 'kitchen_remodel' as const,
    scopeTags: ['cabinetry', 'electrical', 'plumbing_fixtures', 'lighting', 'paint'] as const,
    operatorNotes: 'Kitchen remodel for repeat client, ~10 weeks projected duration.',
    invocationId: `inv_estimator_live_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`,
    requestedAt: new Date().toISOString() as `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z`,
  };

  console.log(`[estimator-live] running estimateProject() with ${inputs.scopeTags.length} bands…`);
  const t0 = Date.now();
  const result = await estimateProject(inputs, {
    modelCaller,
    comparablePool: ggrPool(),
    onboardingSession: ggrOnboardingSession,
  });
  const elapsedMs = Date.now() - t0;

  console.log('');
  console.log('── BANDS QUERIED ────────────────────────────────────────────');
  for (const [scope, band] of result.bandsByScope) {
    console.log(
      `  ${scope.padEnd(20)} rung=${band.cascade_rung} confidence=${band.confidence.padEnd(20)} ` +
        `precision_allowed=${band.precision_allowed}`,
    );
  }

  console.log('');
  console.log('── PACKET ────────────────────────────────────────────────────');
  console.log(`  packet_id:                 ${result.packet.packet_id}`);
  console.log(`  workflow:                  ${result.packet.workflow}`);
  console.log(`  classification.confidence: ${result.packet.classification.confidence_band}`);
  console.log(`  model_inference_label:     ${result.packet.model_inference_label}`);
  console.log(`  money_fields.source_class: ${result.packet.money_fields?.source_class}`);
  console.log(`  source_refs count:         ${result.packet.source_refs.length}`);
  console.log(`  evidence_ids count:        ${result.packet.evidence_ids.length}`);
  console.log(`  claim_ids count:           ${result.packet.claim_ids.length}`);
  console.log(`  status:                    ${result.packet.status}`);
  console.log(`  amount_cents (project):    ${result.packet.money_fields?.amount_cents ?? '(null)'}`);

  console.log('');
  console.log('── EXTRACTED FACTS ──────────────────────────────────────────');
  console.log(`  ${JSON.stringify(result.packet.extracted_facts, null, 2).split('\n').join('\n  ')}`);

  console.log('');
  console.log('── COST + TOKENS ────────────────────────────────────────────');
  console.log(`  tokens_in:           ${result.modelCallerOutput.tokensIn}`);
  console.log(`  tokens_out:          ${result.modelCallerOutput.tokensOut}`);
  console.log(`  cost_nano_usd:       ${result.modelCallerOutput.costNanoUsd}`);
  console.log(`  cost_usd:            ${nanoUsdToUsdString(result.modelCallerOutput.costNanoUsd)}`);
  console.log(`  end_to_end_latency:  ${elapsedMs}ms`);
  console.log(`  model:               ${result.modelCallerOutput.modelId}`);
  console.log(`  endpoint:            ${result.modelCallerOutput.endpoint}`);

  console.log('');
  console.log('── BUDGET CHECK ─────────────────────────────────────────────');
  // Cost-per-invocation extrapolation against $18.50/tenant/month target.
  // Conservative: 50 invocations/day → 1500/month.
  const costMicroUsd = result.modelCallerOutput.costNanoUsd / 1000;
  const monthlyAt50PerDay = (costMicroUsd * 1500) / 1_000_000;
  const monthlyAt100PerDay = (costMicroUsd * 3000) / 1_000_000;
  console.log(`  per-invocation:                $${(costMicroUsd / 1_000_000).toFixed(6)}`);
  console.log(`  monthly @ 50 invocations/day:  $${monthlyAt50PerDay.toFixed(4)}  (vs $18.50 budget)`);
  console.log(`  monthly @ 100 invocations/day: $${monthlyAt100PerDay.toFixed(4)}  (vs $18.50 budget)`);
}

main().catch((err) => {
  console.error('[estimator-live] error:', err);
  process.exitCode = 1;
});
