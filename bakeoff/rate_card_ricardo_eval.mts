/**
 * Ricardo rate-card eval (polish card Part A) — the founder's triplet as the
 * seed answer key (NOT a generalization claim; keep/remove signal becomes the
 * expanding key). Keyed: GROQ_API_KEY required; optional ANTHROPIC_API_KEY for
 * the frontier escalation run.
 *
 * Input: the Ricardo summary SCOPE OF WORK narrative (founder's own artifact).
 * Answer key: the seed's ricardo_* fields (RICARDO_FILLED_EXPECTED + per-line
 * ricardo_included / ricardo_quantity).
 */
import { buildEstimatorPrompt } from '../src/estimator/orchestration/promptBuilder.js';
import { makeGroqModelCaller } from '../src/estimator/orchestration/groqModelCaller.js';
import { makeAnthropicModelCaller } from '../src/estimator/orchestration/anthropicModelCaller.js';
import { estimateProject } from '../src/estimator/orchestration/estimateProject.js';
import { parseRawResponse, enforceTrustDiscipline } from '../src/estimator/orchestration/responseParser.js';
import { tenantRateCardFor, RICARDO_FILLED_EXPECTED } from '../src/estimator/rateCard.js';

const SCOPE_NARRATIVE = "Full kitchen remodel: remove existing cabinetry and install new full-custom cabinets \u2014 35 LF base, 30 LF uppers, 8 LF tall \u2014 in a warm wood, modern slab-door style finished in hardwax oil (Rubio Monocoat class), with uppers raised to the 9-ft ceiling and closed with a modern flat trim. New honed black quartzite countertops with full-height splash in the same material. Kitchen flooring replaced with approximately 250 SF of large-format tile over a self-leveled substrate. New 5-inch flat-stock baseboards, and full paint of the kitchen area walls and ceiling. Lighting package: eight new recessed cans, hardwired under-cabinet LED across the upper runs, and toe-kick LED at the bases, on dedicated driver/switching. Powder bathroom modernization: new contractor-supplied vanity and countertop, new toilet (supplied and installed), wainscoting with wallpaper above, and new light fixtures.";

const card = tenantRateCardFor('tenant_ggr');
const allTags = [...new Set(card.map((l) => l.scope_tag))];
const included = card.filter((l) => l.ricardo_included);
const includedCodes = new Set(included.map((l) => l.cost_code));
const statedDims: Record<string, number> = { 'CB-001': 35, 'CB-002': 30, 'CB-003': 8, 'EL-004': 8 };

async function runOnce(label: string, caller: any): Promise<boolean> {
  const inputs: any = {
    tenantId: 'tenant_ggr', projectArchetype: 'kitchen_remodel', scopeTags: allTags,
    scopeNarrative: SCOPE_NARRATIVE, invocationId: 'ricardo_eval', requestedAt: new Date().toISOString(),
  };
  const prompt = buildEstimatorPrompt({
    inputs, renderedBands: [], rateCard: card,
    ...(CANDIDATE_LIMIT !== undefined ? { candidateLimit: CANDIDATE_LIMIT } : {}),
  });

  const r = await caller({ systemMessage: prompt.systemMessage, userMessage: prompt.userMessage + '\n\nOPERATOR SCOPE:\n' + SCOPE_NARRATIVE, tenantId: 'tenant_ggr', invocationId: 'ricardo_eval', purpose: 'estimator_project_generation', workflow: 'proposal_generation', requestedAt: new Date().toISOString() });
  if (!r.ok) { console.log(label, 'MODEL CALL FAILED:', r.reason); return false; }
  let clean;
  try {
    clean = enforceTrustDiscipline({ raw: parseRawResponse(r.content), bandsByScope: new Map(), tenantId: 'tenant_ggr' as any, rateCard: card, requireRateCardPricing: true });
  } catch (e: any) {
    console.log(label, 'PARSE FAILED:', String(e.message).slice(0, 100));
    return false;
  }
  const priced = clean.itemized_lines.filter((l) => l.unit_cents > 0);
  const exactId = priced.filter((l) => l.matched_by === 'line_id').length;
  const selectedCodes = new Set(priced.map((l) => l.cost_code).filter(Boolean));
  const hit = [...selectedCodes].filter((c) => includedCodes.has(c));
  const precision = selectedCodes.size ? hit.length / selectedCodes.size : 0;
  const recall = hit.length / includedCodes.size;
  let qtyOk = 0, qtyTotal = 0;
  for (const [code, dim] of Object.entries(statedDims)) {
    const line = priced.find((l) => l.cost_code === code);
    if (line) { qtyTotal++; if (Math.abs(line.quantity - dim) < 0.01) qtyOk++; }
  }
  const total = priced.reduce((s, l) => s + l.extended_cents, 0);
  const target = RICARDO_FILLED_EXPECTED.summary_sell_total_cents;
  const within10 = Math.abs(total - target) / target <= 0.10;
  console.log(label + ' SCORECARD');
  console.log('  priced lines: ' + priced.length + ' | exact-id: ' + exactId + '/' + priced.length + ' (' + Math.round(100 * exactId / Math.max(1, priced.length)) + '%)');
  console.log('  precision vs FILLED: ' + (100 * precision).toFixed(0) + '% | recall vs FILLED(46): ' + (100 * recall).toFixed(0) + '% (pre-extrapolation: unstated GC/demo periphery not expected)');
  console.log('  stated-dim qty accuracy: ' + qtyOk + '/' + qtyTotal);
  console.log('  total: $' + (total / 100).toLocaleString() + ' vs $' + (target / 100).toLocaleString() + ' -> within ±10%: ' + within10);
  return within10 && exactId / Math.max(1, priced.length) >= 0.6 && qtyOk >= Math.max(1, qtyTotal - 1);
}

// Production caller (NOT an inline copy): the eval exercises the exact code
// path the deployed estimator runs — adaptive thinking, thinking-block
// filtering, and the max_tokens truncation guard included.
function anthropicEstimatorCaller(model: string) {
  return makeAnthropicModelCaller({ apiKey: process.env.ANTHROPIC_API_KEY!, model });
}

// Classified-tags fixture (candidate-cap card): production runs classification
// before assembly, so allTags overstates the tag surface. The FILLED key's own
// tag set is the classifier-ideal pinned fixture for this narrative.
const classifiedTags = [...new Set(included.map((l) => l.scope_tag))];
const TAG_MODE = process.env.EVAL_TAG_MODE === 'classified' ? 'classified' : 'all';
const EVAL_TAGS = TAG_MODE === 'classified' ? classifiedTags : allTags;
const CANDIDATE_LIMIT = process.env.EVAL_CANDIDATE_LIMIT ? Number(process.env.EVAL_CANDIDATE_LIMIT) : undefined;

/** Full two-pass pipeline (selection + extrapolation) — the metric that
 * matters post-extrapolation: whole-total vs the 46-line FILLED key. */
async function runFullPipeline(label: string, caller: any) {
  const inputs: any = {
    tenantId: 'tenant_ggr', projectArchetype: 'kitchen_remodel', scopeTags: EVAL_TAGS,
    // operatorNotes is how the production adapter feeds the narrative to
    // pass-1 (buildEstimatorInputsFromRightHand); scopeNarrative feeds pass-2.
    operatorNotes: SCOPE_NARRATIVE,
    scopeNarrative: SCOPE_NARRATIVE, invocationId: 'ricardo_full_' + label.replace(/\W+/g, '_'), requestedAt: new Date().toISOString(),
  };
  let result;
  try {
    result = await estimateProject(inputs, {
      modelCaller: caller, comparablePool: [], rateCard: card,
      ...(CANDIDATE_LIMIT !== undefined ? { candidateLimit: CANDIDATE_LIMIT } : {}),
    });
  } catch (e: any) {
    console.log(label, 'PIPELINE FAILED:', String(e.message).slice(0, 140));
    return null;
  }
  const lines = result.estimatorResponse.itemized_lines.filter((l: any) => l.unit_cents > 0);
  const stated = lines.filter((l: any) => !l.suggested);
  const suggested = lines.filter((l: any) => l.suggested);
  const exactId = lines.filter((l: any) => l.matched_by === 'line_id').length;
  let qtyOk = 0, qtyTotal = 0;
  for (const [code, dim] of Object.entries(statedDims)) {
    const line = lines.find((l: any) => l.cost_code === code);
    if (line) { qtyTotal++; if (Math.abs(line.quantity - dim) < 0.01) qtyOk++; }
  }
  const total = lines.reduce((s: number, l: any) => s + l.extended_cents, 0);
  const target = RICARDO_FILLED_EXPECTED.summary_sell_total_cents;
  const deltaPct = (100 * (total - target)) / target;
  console.log(label + ' FULL-PIPELINE SCORECARD');
  console.log('  lines: ' + stated.length + ' stated + ' + suggested.length + ' suggested | exact-id: ' + exactId + '/' + lines.length);
  console.log('  stated-dim qty: ' + qtyOk + '/' + qtyTotal + ' | total: $' + (total / 100).toLocaleString() + ' vs $' + (target / 100).toLocaleString() + ' (' + deltaPct.toFixed(1) + '%)');
  return { label, ok: Math.abs(deltaPct) <= 10, total, stated: stated.length, suggested: suggested.length, exactIdPct: Math.round(100 * exactId / Math.max(1, lines.length)), qty: qtyOk + '/' + qtyTotal, deltaPct };
}

// ── Tier-ladder mode (EVAL_TIER_LADDER=1): sonnet vs opus-4.8 vs fable on
// the FULL pipeline, repeats for variance (variance is what killed groq).
// The legacy groq→frontier selection-only tripwire below stays the default.
if (process.env.EVAL_TIER_LADDER === '1') {
  const ladder: Array<{ model: string; runs: number }> = [
    { model: 'claude-sonnet-4-6', runs: 2 },
    { model: 'claude-opus-4-8', runs: 2 },
    { model: 'claude-fable-5', runs: 1 },
  ];
  const rows: any[] = [];
  for (const rung of ladder) {
    for (let i = 1; i <= rung.runs; i++) {
      const row = await runFullPipeline(rung.model + ' #' + i, anthropicEstimatorCaller(rung.model));
      if (row) rows.push(row);
      console.log('');
    }
  }
  console.log('TIER LADDER SUMMARY (target $' + (RICARDO_FILLED_EXPECTED.summary_sell_total_cents / 100).toLocaleString() + ' ±10%) — tags=' + TAG_MODE + ' (' + EVAL_TAGS.length + ') candidateLimit=' + (CANDIDATE_LIMIT ?? 'default40'));
  for (const r of rows) {
    console.log('  ' + r.label.padEnd(22) + ' $' + (r.total / 100).toLocaleString().padStart(11) + '  D' + r.deltaPct.toFixed(1).padStart(6) + '%  ' + (r.ok ? 'WITHIN' : 'OUTSIDE') + '  ' + r.stated + '+' + r.suggested + ' lines  exact-id ' + r.exactIdPct + '%  qty ' + r.qty);
  }
  process.exit(0);
}

const groqCaller = makeGroqModelCaller({ apiKey: process.env.GROQ_API_KEY!, baseUrl: 'https://api.groq.com/openai/v1' });
const groqPass = await runOnce('GROQ (llama-4-scout)', groqCaller);
let frontierPass = false;
if (!groqPass && process.env.ANTHROPIC_API_KEY) {
  console.log('');
  frontierPass = await runOnce('FRONTIER (claude-sonnet-4-6)', anthropicEstimatorCaller('claude-sonnet-4-6'));
}
console.log('');
console.log(groqPass
  ? 'TIER VERDICT: groq PASSES the seed eval - no escalation needed.'
  : frontierPass
    ? 'TIER VERDICT: groq FAILED, FRONTIER PASSES - route the estimator selection call to frontier.'
    : 'TIER VERDICT: both tiers below threshold - coverage gap is extrapolation-shaped (unstated periphery); re-run after the extrapolation card.');
process.exit(0);
