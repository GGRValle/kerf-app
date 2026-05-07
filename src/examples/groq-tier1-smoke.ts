// Groq Tier 1 (Llama 4 Scout) smoke benchmark harness — 15 cases. Not a test;
// a runnable example that exercises `groqChat` against the real Groq endpoint
// with realistic-shaped prompts and produces a structured JSON report with
// per-case latency, token counts, cost, and aggregate p50/p95/throughput.
//
// Run with `npm run smoke:groq-tier1`. The npm script passes `--env-file=.env.local`
// to Node, which loads GROQ_API_KEY + GROQ_BASE_URL + KERF_BENCHMARK_MODEL into
// process.env. The harness reads them at the boundary; nothing inside
// `src/altitude/modelAdapter/` touches env.
//
// Output: writes JSON to `src/examples/evidence/groq-tier1-smoke/results-<date>.json`
// and prints a one-screen summary to stdout. Do NOT redact the report —
// pricing + token counts are the point. The API key never enters the report.
//
// Case design rationale (15 cases):
//   - 5× Tenant Context (Cat A): system prompt embeds GGR/Valle/HPG facts,
//     user asks a question that requires reading those facts. Mirrors what
//     production agents will do once tenant-context loading lands.
//   - 5× Decision Altitude (Cat B): user describes a decision; model returns
//     L1/L2/L3/L4. Mirrors the routing step that V18 validates.
//   - 3× Source Basis (Cat C): claim + sources; model classifies basis. Mirrors
//     V7 source-basis-required validator's typed input.
//   - 2× Edge (Cat D): D1 = minimum-prompt cold-call latency floor; D2 = long
//     embedded contract context, tests throughput on prompts the proposal-review
//     surface will actually generate.
//
// Temperature 0 for reproducibility; max_tokens capped so cost stays bounded.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GROQ_LLAMA_4_SCOUT_PRICING,
  HOSTING_ROUTE_REGISTRY_VERSION,
  defaultGroqClientDeps,
  groqChat,
  nanoUsdToUsdString,
  type GroqChatRequest,
  type GroqChatResult,
  type NanoUsd,
} from '../altitude/modelAdapter/index.js';
import type { ISO8601 } from '../blackboard/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Cases
// ──────────────────────────────────────────────────────────────────────────

interface BenchmarkCase {
  readonly caseId: string;
  readonly category: 'tenant_context' | 'decision_altitude' | 'source_basis' | 'edge';
  readonly name: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

const KERF_SYSTEM = 'You are Kerf, an operating brain for a contracting business. Be concise and precise.';

const GGR_FACTS = [
  'Tenant: GGR Design + Remodeling, San Diego CA.',
  'Default gross margin target: 35%.',
  'Self-performs: framing, drywall, painting, finish carpentry.',
  'Subs out: plumbing, electrical, tile, HVAC.',
  'Authority: changes over $5,000 require owner (Christian) approval.',
  'Standard exclusions: hazmat remediation, structural engineering fees, permit expediting beyond 2 visits.',
].join(' ');

const VALLE_FACTS = [
  'Tenant: VALLE cabinetry + millwork (DBA of Get Green Remodeling, Inc).',
  'Default gross margin target: 38% on cabinetry; allowance pass-through at 0% on appliances.',
  'Self-performs: cabinet design, in-house millwork, install crews.',
  'Subs out: countertop fab, glass, specialty hardware.',
].join(' ');

const MARK_AND_GRACE_CONTRACT = [
  'Project: Mark and Grace Wegrzyn — Poway kitchen + primary bathroom remodel.',
  'Original subtotal: $123,940.08. Change Order #1 net: ($9,231.35). Final: $114,708.73.',
  'Phase-organized 12 line items: 1. Demolition $4,200; 2. Framing $8,650; 3. Plumbing $14,200;',
  '4. Electrical $9,800; 5. HVAC $3,600; 6. Drywall $11,200; 7. Tile $13,400; 8. Cabinetry $24,800;',
  '9. Countertops $9,200; 10. Painting $5,400; 11. Fixtures $7,890; 12. Final clean $1,600.',
  'P&L 5/5/2026: 10 months in. Subs over budget by $13,550 — almost exactly the project gross profit ($14,663).',
  'Drift drivers: demolition exposed unforeseen rot (Phase 1); plumbing required cast-iron replacement (Phase 3);',
  'drywall scope expanded after framing repairs (Phase 6).',
].join(' ');

const CASES: BenchmarkCase[] = [
  // ── Cat A — Tenant Context (5) ──────────────────────────────────────────
  {
    caseId: 'C01',
    category: 'tenant_context',
    name: 'GGR one-line summary',
    system: `${KERF_SYSTEM} Tenant facts: ${GGR_FACTS}`,
    user: 'Summarize this tenant in one sentence.',
    maxTokens: 64,
  },
  {
    caseId: 'C02',
    category: 'tenant_context',
    name: 'Valle margin lookup',
    system: `${KERF_SYSTEM} Tenant facts: ${VALLE_FACTS}`,
    user: "What's the default gross margin target on cabinetry? Answer with just the percentage.",
    maxTokens: 16,
  },
  {
    caseId: 'C03',
    category: 'tenant_context',
    name: 'GGR standard exclusions list',
    system: `${KERF_SYSTEM} Tenant facts: ${GGR_FACTS}`,
    user: 'List the three standard exclusions for this tenant. Bullet list, no commentary.',
    maxTokens: 96,
  },
  {
    caseId: 'C04',
    category: 'tenant_context',
    name: 'GGR approval threshold',
    system: `${KERF_SYSTEM} Tenant facts: ${GGR_FACTS}`,
    user: 'What dollar threshold triggers owner approval? One number.',
    maxTokens: 16,
  },
  {
    caseId: 'C05',
    category: 'tenant_context',
    name: 'GGR sub-out classification',
    system: `${KERF_SYSTEM} Tenant facts: ${GGR_FACTS}`,
    user: 'Does this tenant self-perform plumbing or subcontract it? Answer in one word.',
    maxTokens: 8,
  },

  // ── Cat B — Decision Altitude (5) ───────────────────────────────────────
  {
    caseId: 'C06',
    category: 'decision_altitude',
    name: 'L1 field decision',
    system: `${KERF_SYSTEM} Altitudes: L1 field crew, L2 PM, L3 owner, L4 frontier/strategy. Reply with only the altitude code.`,
    user: 'An apprentice asks: "Can I cut the existing 1/2 inch copper pipe to fit the new vanity rough-in?"',
    maxTokens: 8,
  },
  {
    caseId: 'C07',
    category: 'decision_altitude',
    name: 'L2 PM-scope decision',
    system: `${KERF_SYSTEM} Altitudes: L1 field crew, L2 PM, L3 owner, L4 frontier/strategy. Reply with only the altitude code.`,
    user: 'A PM asks: "Can I order an additional 8 feet of base trim — about $40?"',
    maxTokens: 8,
  },
  {
    caseId: 'C08',
    category: 'decision_altitude',
    name: 'L3 owner-scope decision',
    system: `${KERF_SYSTEM} Altitudes: L1 field crew, L2 PM, L3 owner, L4 frontier/strategy. Reply with only the altitude code.`,
    user: 'A PM asks: "Should we approve a $15,000 change order to redo the subfloor we found rotted under the kitchen?"',
    maxTokens: 8,
  },
  {
    caseId: 'C09',
    category: 'decision_altitude',
    name: 'L4 strategic decision',
    system: `${KERF_SYSTEM} Altitudes: L1 field crew, L2 PM, L3 owner, L4 frontier/strategy. Reply with only the altitude code.`,
    user: 'The owner asks: "Should we expand into commercial tenant improvement work next quarter?"',
    maxTokens: 8,
  },
  {
    caseId: 'C10',
    category: 'decision_altitude',
    name: 'Ambiguous + rationale',
    system: `${KERF_SYSTEM} Altitudes: L1 field crew, L2 PM, L3 owner, L4 frontier/strategy. Reply with the altitude code and one short clause justifying it.`,
    user: 'A field crew wants to add an extra subcontractor day to finish framing earlier. Cost impact: about $1,200.',
    maxTokens: 64,
  },

  // ── Cat C — Source Basis (3) ────────────────────────────────────────────
  {
    caseId: 'C11',
    category: 'source_basis',
    name: 'Verified-quote pass',
    system: `${KERF_SYSTEM} Source classes: tenant_catalog, verified_quote, historical_actual, project_actual, public_reference, kerf_seed, model_inference, placeholder, missing. Reply with the single source class label.`,
    user: 'Claim: plumbing rough labor = $9,000. Source: written quote PDF from ABC Plumbing dated 2026-05-01.',
    maxTokens: 12,
  },
  {
    caseId: 'C12',
    category: 'source_basis',
    name: 'Model-inference flag',
    system: `${KERF_SYSTEM} Source classes: tenant_catalog, verified_quote, historical_actual, project_actual, public_reference, kerf_seed, model_inference, placeholder, missing. Reply with the single source class label.`,
    user: 'Claim: tile labor = $3,200. Source: estimated by Kerf based on similar project size, no quote attached.',
    maxTokens: 12,
  },
  {
    caseId: 'C13',
    category: 'source_basis',
    name: 'Missing source',
    system: `${KERF_SYSTEM} Source classes: tenant_catalog, verified_quote, historical_actual, project_actual, public_reference, kerf_seed, model_inference, placeholder, missing. Reply with the single source class label.`,
    user: 'Claim: HVAC = $4,500. Source: not provided.',
    maxTokens: 12,
  },

  // ── Cat D — Edge (2) ────────────────────────────────────────────────────
  {
    caseId: 'C14',
    category: 'edge',
    name: 'Minimal prompt floor',
    system: 'Reply OK.',
    user: 'ping',
    maxTokens: 4,
  },
  {
    caseId: 'C15',
    category: 'edge',
    name: 'Long-context summary',
    system: `${KERF_SYSTEM} Project context: ${MARK_AND_GRACE_CONTRACT}`,
    user: 'In one sentence: what was the main cause of the project running tight on margin?',
    maxTokens: 96,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Harness
// ──────────────────────────────────────────────────────────────────────────

interface CaseResult {
  readonly case_id: string;
  readonly category: BenchmarkCase['category'];
  readonly name: string;
  readonly ok: boolean;
  readonly latency_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly tokens_per_second: number;
  readonly cost_nano_usd: NanoUsd;
  readonly response_preview: string | null;
  readonly finish_reason: string | null;
  readonly failure_kind?: string;
  readonly failure_reason?: string;
  readonly http_status?: number;
}

function pct(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? 0;
}

function previewOf(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…';
}

async function runCase(
  c: BenchmarkCase,
  ctx: { endpoint: string; model: string; tenantId: string; baseTime: ISO8601 },
  apiKey: string,
  baseUrl: string,
): Promise<{ result: GroqChatResult; row: CaseResult }> {
  const deps = defaultGroqClientDeps(apiKey, baseUrl, GROQ_LLAMA_4_SCOUT_PRICING);
  const req: GroqChatRequest = {
    endpoint: ctx.endpoint,
    model: ctx.model,
    messages: [
      { role: 'system', content: c.system },
      { role: 'user', content: c.user },
    ],
    tenantId: ctx.tenantId,
    invocationId: `groq-tier1-smoke-${c.caseId}`,
    purpose: `groq_tier1_smoke_${c.category}`,
    workflow: 'benchmark_harness',
    temperature: 0,
    maxTokens: c.maxTokens,
    requestedAt: ctx.baseTime,
  };

  const result = await groqChat(req, deps);

  if (result.ok) {
    const tokensPerSecond =
      result.latencyMs > 0 ? Math.round((result.outputTokens * 1000) / result.latencyMs) : 0;
    return {
      result,
      row: {
        case_id: c.caseId,
        category: c.category,
        name: c.name,
        ok: true,
        latency_ms: result.latencyMs,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.totalTokens,
        tokens_per_second: tokensPerSecond,
        cost_nano_usd: result.costNanoUsd,
        response_preview: previewOf(result.content),
        finish_reason: result.finishReason,
      },
    };
  }

  return {
    result,
    row: {
      case_id: c.caseId,
      category: c.category,
      name: c.name,
      ok: false,
      latency_ms: result.latencyMs,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      tokens_per_second: 0,
      cost_nano_usd: 0,
      response_preview: null,
      finish_reason: null,
      failure_kind: result.kind,
      failure_reason: String(result.reason).slice(0, 200),
      http_status: result.httpStatus,
    },
  };
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(
      `${name} is not set. Run via \`npm run smoke:groq-tier1\` (which loads .env.local), ` +
        `or ensure the variable is exported in your shell.`,
    );
  }
  return v;
}

async function main(): Promise<void> {
  const apiKey = readEnv('GROQ_API_KEY');
  const baseUrl = readEnv('GROQ_BASE_URL');
  const model = readEnv('KERF_BENCHMARK_MODEL');
  const endpoint = 'groq://llama-4-scout';
  const tenantId = 'tenant_ggr';

  if (model !== 'meta-llama/llama-4-scout-17b-16e-instruct') {
    console.warn(
      `[groq-tier1-smoke] WARNING: KERF_BENCHMARK_MODEL=${model} ` +
        'differs from the registry-approved Scout model id. ' +
        'Route check will fail with source_model_mismatch.',
    );
  }

  const startedAt = new Date().toISOString();
  console.log(`[groq-tier1-smoke] starting ${CASES.length} cases against ${endpoint} (${model})`);

  const rows: CaseResult[] = [];
  for (const c of CASES) {
    process.stdout.write(`  ${c.caseId} ${c.name.padEnd(34)} `);
    const ctx = {
      endpoint,
      model,
      tenantId,
      baseTime: new Date().toISOString() as ISO8601,
    };
    const { row } = await runCase(c, ctx, apiKey, baseUrl);
    rows.push(row);
    if (row.ok) {
      console.log(
        `${String(row.latency_ms).padStart(5)}ms  ` +
          `${String(row.input_tokens).padStart(4)}/${String(row.output_tokens).padStart(3)} tok  ` +
          `${String(row.tokens_per_second).padStart(4)} tok/s`,
      );
    } else {
      console.log(`FAILED (${row.failure_kind}: ${row.failure_reason})`);
    }
    // Minor courtesy delay between calls (Groq tier handles this trivially,
    // but spreads any per-second rate limiter we can't see from here).
    await new Promise((r) => setTimeout(r, 100));
  }

  const completedAt = new Date().toISOString();
  const okRows = rows.filter((r) => r.ok);
  const latencies = okRows.map((r) => r.latency_ms);
  const totalInput = okRows.reduce((s, r) => s + r.input_tokens, 0);
  const totalOutput = okRows.reduce((s, r) => s + r.output_tokens, 0);
  const totalCostNanoUsd = okRows.reduce((s, r) => s + r.cost_nano_usd, 0);
  const totalLatencyMs = okRows.reduce((s, r) => s + r.latency_ms, 0);
  const meanThroughput =
    totalLatencyMs > 0 ? Math.round((totalOutput * 1000) / totalLatencyMs) : 0;

  const verdictTargetMs = 2000;
  const p95 = pct(latencies, 0.95);
  const p50 = pct(latencies, 0.5);

  const report = {
    harness: 'groq-tier1-smoke',
    harness_version: '0.1.0',
    started_at: startedAt,
    completed_at: completedAt,
    endpoint,
    model,
    registry_version: HOSTING_ROUTE_REGISTRY_VERSION,
    approved_by_decision: 'D-023',
    pricing_nano_usd_per_million: GROQ_LLAMA_4_SCOUT_PRICING,
    case_count: CASES.length,
    cases: rows,
    summary: {
      passed: okRows.length,
      failed: rows.length - okRows.length,
      all_passed: okRows.length === rows.length,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_cost_nano_usd: totalCostNanoUsd,
      total_cost_usd_display: nanoUsdToUsdString(totalCostNanoUsd),
      p50_latency_ms: p50,
      p95_latency_ms: p95,
      min_latency_ms: latencies.length > 0 ? Math.min(...latencies) : 0,
      max_latency_ms: latencies.length > 0 ? Math.max(...latencies) : 0,
      mean_throughput_tokens_per_second: meanThroughput,
    },
    verdict: {
      frame_j_voice_loop_target_ms: verdictTargetMs,
      p50_under_target: p50 < verdictTargetMs,
      p95_under_target: p95 < verdictTargetMs,
      notes:
        p95 < verdictTargetMs
          ? `p95 ${p95}ms is under the ${verdictTargetMs}ms Frame J target — Tier 1 latency clears the operator-facing voice-loop bar on these prompt shapes.`
          : `p95 ${p95}ms exceeds ${verdictTargetMs}ms — Frame J voice-loop will need streaming or shorter max_tokens to hit the target.`,
    },
  };

  // Write the report.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dateStamp = startedAt.slice(0, 10);
  const outDir = resolve(__dirname, 'evidence/groq-tier1-smoke');
  const outPath = resolve(outDir, `results-${dateStamp}.json`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log('\n[groq-tier1-smoke] summary');
  console.log(`  passed:        ${report.summary.passed}/${report.case_count}`);
  console.log(`  p50 latency:   ${report.summary.p50_latency_ms}ms`);
  console.log(`  p95 latency:   ${report.summary.p95_latency_ms}ms`);
  console.log(`  throughput:    ${report.summary.mean_throughput_tokens_per_second} tok/s`);
  console.log(
    `  cost (15-case): ${report.summary.total_cost_usd_display} ` +
      `(${report.summary.total_input_tokens} in / ${report.summary.total_output_tokens} out)`,
  );
  console.log(`  verdict:       ${report.verdict.notes}`);
  console.log(`  report:        ${outPath}`);

  if (!report.summary.all_passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[groq-tier1-smoke] fatal error:', err);
  process.exitCode = 1;
});
