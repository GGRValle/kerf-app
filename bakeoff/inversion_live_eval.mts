/**
 * Car-1 gate · Lane-B LIVE conversational eval (PR #305 / c94e168).
 *
 * Drives the PR's REAL resolveReplyWithModel — system prompt, honesty floor,
 * draft-fabrication strip, working-draft merge shape — against a LIVE reply
 * brain (claude-haiku-4-5, temp 0). The structured, post-floor result is then
 * scored by a frontier judge (claude-sonnet-4-6, temp 0) against each eval's
 * gate card, never by string-match (README Lane B).
 *
 * The gate built this; Codex built Car 1. Run from the PR worktree so the
 * import resolves to the PR resolver:
 *   node --import tsx bakeoff/inversion_live_eval.mts
 *
 * Reads ANTHROPIC_API_KEY from env. No key is printed.
 */
import { resolveReplyWithModel, type ResolveReplyInput, type ResolveReplyResult, type ReplyResolverLlmClient } from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';

const API_KEY = process.env['ANTHROPIC_API_KEY'];
if (!API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(2); }

const REPLY_MODEL = 'claude-haiku-4-5';
const JUDGE_MODEL = 'claude-sonnet-4-6';
const NOW = () => new Date('2026-06-07T00:00:00.000Z');

interface AnthMsg { role: 'user' | 'assistant'; content: string }
async function anthropic(model: string, system: string | undefined, messages: AnthMsg[], maxTokens: number): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      ...(system ? { system } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${model} http_${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
}

/**
 * A groqChat-shaped client whose body is the LIVE Anthropic reply brain.
 * The resolver hands us its assembled system+user prompt; we route it to
 * claude-haiku-4-5 and hand the text back as GroqChatResult.content. The
 * resolver then parses + floors it exactly as in production.
 */
function liveReplyBrain(): ReplyResolverLlmClient {
  return {
    tenantId: 'tenant_ggr' as never,
    groqChat: async (req: any) => {
      const sys = req.messages.find((m: any) => m.role === 'system')?.content;
      const usr = req.messages.find((m: any) => m.role === 'user')?.content ?? '';
      let content = '';
      try {
        content = await anthropic(REPLY_MODEL, sys, [{ role: 'user', content: usr }], 700);
      } catch (e) {
        return { ok: false, kind: 'network_error', reason: String(e), latencyMs: 1, route: {} as never, invocationId: req.invocationId, completedAt: NOW().toISOString() } as never;
      }
      return {
        ok: true, content, model: REPLY_MODEL,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 1,
        costNanoUsd: 0 as never, finishReason: 'stop', route: {} as never,
        invocationId: req.invocationId, completedAt: NOW().toISOString(),
      } as never;
    },
  };
}

interface JudgeVerdict { pass: boolean; reasons: string[]; observations: string }
async function judge(evalId: string, gateCard: { pass: string[]; fail: string[] }, operatorText: string, result: ResolveReplyResult): Promise<JudgeVerdict> {
  const sys = `You are the frontier judge for the Kerf "Conversation Inversion" gate. You score a Right Hand assistant turn against a gate card. The gold transcript is a SHAPE, not a string — judge behavior, never wording. Be adversarial and literal about the fail conditions. Return STRICT JSON only: {"pass": true|false, "reasons": ["..."], "observations": "one tight paragraph"}.`;
  const payload = {
    operator_said: operatorText,
    right_hand_reply: result.reply,
    mode: result.mode,
    authority: result.authority,
    claims_durable_action: result.claims_durable_action,
    next_question: result.next_question ?? null,
    proposed_action: result.proposed_action ?? null,
    updated_working_draft: result.updated_working_draft ?? null,
    open_items: result.open_items ?? null,
    draft_fabrication_flags: result.draft_fabrication_flags ?? [],
  };
  const usr = [
    `EVAL: ${evalId}`,
    `PASS conditions (ALL must hold): ${JSON.stringify(gateCard.pass)}`,
    `FAIL conditions (ANY triggers fail): ${JSON.stringify(gateCard.fail)}`,
    '',
    'The assistant turn (already passed the deterministic honesty floor; authority=llm_inferred means the live model reply survived the floor, humble_fallback means the floor replaced it):',
    JSON.stringify(payload, null, 2),
    '',
    'Score it. A "consequence-ranked question" is ONE question that changes the shape of the number/estimate (e.g. footprint move, structural). A "slot/schema question" asks for budget/address/client/timeline before a draft exists and is a FAIL. Identity/contact facts belong in open_items, not as a blocking question. Count the questions in reply + next_question together.',
  ].join('\n');
  const raw = await anthropic(JUDGE_MODEL, sys, [{ role: 'user', content: usr }], 800);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const v = JSON.parse(cleaned);
    return { pass: !!v.pass, reasons: Array.isArray(v.reasons) ? v.reasons : [], observations: String(v.observations ?? '') };
  } catch {
    return { pass: false, reasons: ['judge_returned_non_json'], observations: raw.slice(0, 400) };
  }
}

function countQuestions(result: ResolveReplyResult): number {
  let n = (result.reply.match(/\?/g) ?? []).length;
  if (result.next_question && result.next_question.trim()) n += 1;
  return n;
}

function show(label: string, result: ResolveReplyResult): void {
  console.log(`\n  ── ${label} ──`);
  console.log(`  authority: ${result.authority}  mode: ${result.mode}  claims_durable_action: ${result.claims_durable_action}`);
  console.log(`  reply: ${JSON.stringify(result.reply)}`);
  if (result.next_question) console.log(`  next_question: ${JSON.stringify(result.next_question)}`);
  if (result.proposed_action) console.log(`  proposed_action: ${JSON.stringify(result.proposed_action)}`);
  const d = result.updated_working_draft;
  if (d) {
    if (d.scope) console.log(`  draft.scope (${d.scope.length}): ${JSON.stringify(d.scope)}`);
    if (d.known_entities) console.log(`  draft.known_entities: ${JSON.stringify(d.known_entities)}`);
    if (d.open_items) console.log(`  draft.open_items: ${JSON.stringify(d.open_items)}`);
    if (d.allowances) console.log(`  draft.allowances: ${JSON.stringify(d.allowances)}`);
    if (d.next_action) console.log(`  draft.next_action: ${JSON.stringify(d.next_action)}`);
    if (d.proposed_artifact) console.log(`  draft.proposed_artifact: ${JSON.stringify(d.proposed_artifact)}`);
  }
  if (result.open_items) console.log(`  result.open_items: ${JSON.stringify(result.open_items)}`);
  if (result.draft_fabrication_flags?.length) console.log(`  FABRICATION FLAGS: ${JSON.stringify(result.draft_fabrication_flags)}`);
  console.log(`  question count (reply + next_question): ${countQuestions(result)}`);
}

const client = liveReplyBrain();
const results: Array<{ id: string; pass: boolean; note: string }> = [];

// ─────────────────────────────────────────────────────────────────────────
// DECISIVE — Okonkwo novel narrative (PR P1 generalization, run LIVE).
// Decisive gate criterion (per gate card): working draft with scope captured
// + at most 1 consequence-ranked question + identity as open_items.
// ─────────────────────────────────────────────────────────────────────────
{
  const text = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';
  const input: ResolveReplyInput = {
    latestText: text,
    draftText: text,
    currentPath: '/',
    userRole: 'owner',
    tenantId: 'tenant_ggr' as never,
    trp: buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' }),
    workingDraft: undefined,
    conversationTurns: [{ speaker: 'operator', text }],
    now: NOW,
  };
  const r = await resolveReplyWithModel(input, client);
  show('OKONKWO turn 1 (live haiku)', r);

  const d = r.updated_working_draft;
  const scopeBlob = (d?.scope ?? []).join(' | ').toLowerCase();
  const openBlob = ([...(d?.open_items ?? []), ...(r.open_items ?? [])]).join(' | ').toLowerCase();
  const scopeHits = ['curbless', 'vanity', 'adu', 'mini-split', 'tile', 'kitchenette'].filter((k) => scopeBlob.includes(k));
  const qCount = countQuestions(r);
  const identityInOpen = ['address', 'budget', 'timeline', 'decision', 'contact', 'client'].some((k) => openBlob.includes(k));

  const v = await judge('OKONKWO', {
    pass: [
      'a working draft exists with the bath+ADU scope captured (curbless shower, 7 LF vanity, ~90 sqft heated tile, 400 sqft ADU, kitchenette plumbing, mini-split)',
      'at most ONE consequence-ranked question (a question that changes the estimate shape), or zero',
      'identity/logistics (address, budget, timeline, decision maker) carried as open_items, not asked as a blocking question',
      'no fabricated numbers or entities (draft_fabrication_flags should be empty)',
    ],
    fail: [
      'any slot/schema question (budget/address/client/timeline) asked before a draft exists',
      'more than one question this turn',
      'any created/filed/saved claim before a gate (claims_durable_action true with no artifact)',
      'scope dropped or not captured in the working draft',
    ],
  }, text, r);

  console.log(`  [deterministic cross-check] scope keywords captured: ${scopeHits.length}/6 (${scopeHits.join(',')})`);
  console.log(`  [deterministic cross-check] question count <=1: ${qCount <= 1}  identity in open_items: ${identityInOpen}`);
  console.log(`  [JUDGE] pass=${v.pass}  reasons=${JSON.stringify(v.reasons)}`);
  console.log(`  [JUDGE] ${v.observations}`);

  // Decisive composite: judge PASS AND deterministic floor satisfied.
  const deterministicOk = r.authority === 'llm_inferred' && scopeHits.length >= 4 && qCount <= 1 && identityInOpen && (r.draft_fabrication_flags?.length ?? 0) === 0;
  const pass = v.pass && deterministicOk;
  results.push({ id: 'OKONKWO (decisive)', pass, note: `judge=${v.pass} det=${deterministicOk} scope=${scopeHits.length}/6 q=${qCount} idOpen=${identityInOpen}` });
}

// ─────────────────────────────────────────────────────────────────────────
// EVAL01 / GOLD — the paragraph test (conversational lane), run LIVE.
// ─────────────────────────────────────────────────────────────────────────
{
  const text = 'Kitchen plus a whole downstairs remodel. About 60 lineal feet of white oak cabinetry, quartzite countertops, and replace wood flooring. The existing tile and carpet will be removed and we will install glue-down wood flooring, about a thousand square foot. We\'re going to paint the downstairs — baseboards, walls, ceilings. Quartzite for budget purposes. About a 12x15 kitchen with an island.';
  const input: ResolveReplyInput = {
    latestText: text,
    draftText: text,
    currentPath: '/',
    userRole: 'owner',
    tenantId: 'tenant_ggr' as never,
    trp: buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' }),
    conversationTurns: [{ speaker: 'operator', text }],
    now: NOW,
  };
  const r = await resolveReplyWithModel(input, client);
  show('EVAL01 GOLD kitchen paragraph (live haiku)', r);
  const v = await judge('EVAL01', {
    pass: [
      'draft posture with EXACTLY one consequence-ranked question (footprint / moving walls-sink-island), or zero',
      'scope reflected back and carried as allowances (white oak 60 LF / quartzite / ~1000 sqft flooring / paint)',
    ],
    fail: [
      'any slot-question (budget/address/client) before a draft exists',
      'a second schema question',
      'any created/filed claim before the gate',
    ],
  }, text, r);
  console.log(`  [JUDGE] pass=${v.pass}  reasons=${JSON.stringify(v.reasons)}`);
  console.log(`  [JUDGE] ${v.observations}`);
  const qOk = countQuestions(r) <= 1;
  const pass = v.pass && r.authority === 'llm_inferred' && qOk;
  results.push({ id: 'EVAL01 paragraph', pass, note: `judge=${v.pass} q<=1=${qOk}` });
}

// ─────────────────────────────────────────────────────────────────────────
// EVAL01 variant — embedded client name -> ZERO client re-asks.
// ─────────────────────────────────────────────────────────────────────────
{
  const text = 'New kitchen job for the Chen family — kitchen plus a whole downstairs remodel. About 60 lineal feet of white oak cabinetry, quartzite countertops, replace wood flooring about a thousand square foot, paint the downstairs. About a 12x15 kitchen with an island.';
  const input: ResolveReplyInput = {
    latestText: text,
    draftText: text,
    currentPath: '/',
    userRole: 'owner',
    tenantId: 'tenant_ggr' as never,
    trp: buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' }),
    conversationTurns: [{ speaker: 'operator', text }],
    now: NOW,
  };
  const r = await resolveReplyWithModel(input, client);
  show('EVAL01 Chen-embedded variant (live haiku)', r);
  const blob = `${r.reply} ${r.next_question ?? ''}`.toLowerCase();
  const reAsksClient = /(what('?s| is) (the )?(client|customer|name)|who('?s| is) the client|whose|which (client|customer))/i.test(blob);
  const v = await judge('EVAL01_chen', {
    pass: [
      'draft posture + at most one consequence-ranked question',
      'ZERO client re-asks — it already heard "Chen", so it must NOT ask who the client is',
    ],
    fail: [
      'asks for the client/customer name when "Chen" was already given',
      'any slot-question before a draft',
      'a second schema question',
    ],
  }, text, r);
  console.log(`  [deterministic cross-check] re-asks client name: ${reAsksClient}`);
  console.log(`  [JUDGE] pass=${v.pass}  reasons=${JSON.stringify(v.reasons)}`);
  console.log(`  [JUDGE] ${v.observations}`);
  const pass = v.pass && !reAsksClient && r.authority === 'llm_inferred';
  results.push({ id: 'EVAL01 Chen-embedded', pass, note: `judge=${v.pass} reAsksClient=${reAsksClient}` });
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════ LANE B SCORECARD ══════════════════════');
let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.note}`);
}
console.log(`\n  Lane B: ${results.length - fails}/${results.length} pass${fails ? '  — has failures' : ''}`);
process.exit(fails ? 1 : 0);
