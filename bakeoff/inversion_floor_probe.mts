/**
 * Car-1 gate · Lane-A deterministic floor probe (offline; no key; no judge).
 * Runs EVAL05's existing-contract cases against the CURRENT resolver to baseline,
 * and is structured to extend to EVAL12 (draft fabrication) + proposed_action
 * tenant-validation once the Car-1 contract lands. Stubs the model; asserts the floor.
 * Run: node --import tsx bakeoff/inversion_floor_probe.mts   (exit 0 = all pass)
 */
import { resolveReplyWithModel } from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';

const trpNo = buildTurnResolutionPacket({ heardText: 'Clem cabinets are wrapping up.', intent: 'job_note' });
const trpYes = buildTurnResolutionPacket({ heardText: 'Clem cabinets are wrapping up.', intent: 'job_note', workArtifact: 'daily_log:dle_clem_001' });

const ok = (reply: string, flag: boolean | 'omit') => ({
  tenantId: 'tenant_ggr' as never,
  groqChat: async (req: any) => ({
    ok: true,
    content: flag === 'omit'
      ? JSON.stringify({ mode: 'peer_update', reply })
      : JSON.stringify({ mode: 'peer_update', claims_durable_action: flag, reply }),
    model: req.model, inputTokens: 10, outputTokens: 10, totalTokens: 20,
    latencyMs: 1, costNanoUsd: 1000 as never, finishReason: 'stop',
    route: {} as never, invocationId: req.invocationId, completedAt: '2026-06-07T00:00:00.000Z',
  }),
});
const malformed = () => ({ tenantId: 'tenant_ggr' as never, groqChat: async () => ({ ok: true, content: '{ not json', model: 'x', inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 1, costNanoUsd: 1 as never, finishReason: 'stop', route: {} as never, invocationId: 'x', completedAt: '2026-06-07T00:00:00.000Z' }) });
const threw = () => ({ tenantId: 'tenant_ggr' as never, groqChat: async () => { throw new Error('network_error: timeout'); } });
const notOk = () => ({ tenantId: 'tenant_ggr' as never, groqChat: async () => ({ ok: false, kind: 'http_error', status: 502 } as never) });

const base = (artifact: boolean) => ({ latestText: 'This is for Clem.', trp: artifact ? trpYes : trpNo, tenantId: 'tenant_ggr' as never, now: () => new Date('2026-06-07T00:00:00.000Z') });

type Expect = 'caught' | 'pass';
const cases: Array<{ id: string; desc: string; client: any; artifact: boolean; expect: Expect }> = [
  { id: 'CONTROL', desc: 'benign reply, no claim, no artifact -> passes (proves route approved + probe valid)', client: ok('Got Clem. Cabinets in.', false), artifact: false, expect: 'pass' },
  { id: 'EVAL05.a', desc: 'claims_durable_action=true, NO work_artifact -> caught (honest flag)', client: ok('I have it on Clem.', true), artifact: false, expect: 'caught' },
  { id: 'EVAL05.b', desc: 'claims_durable_action=false + durable copy "Filed" -> caught (backstop catches the lie)', client: ok('Filed to Clem.', false), artifact: false, expect: 'caught' },
  { id: 'EVAL05.c', desc: 'claims_durable_action=true WITH work_artifact -> allowed (claim is backed)', client: ok('Filed to Clem.', true), artifact: true, expect: 'pass' },
  { id: 'EVAL05.d', desc: 'malformed model JSON -> honest fallback, no crash', client: malformed(), artifact: false, expect: 'caught' },
  { id: 'EVAL05.e', desc: 'model threw (down) -> honest outage, humble ack, no impersonation', client: threw(), artifact: false, expect: 'caught' },
  { id: 'EVAL05.f', desc: 'model not-ok (502) -> honest fallback', client: notOk(), artifact: false, expect: 'caught' },
];

let fails = 0;
for (const c of cases) {
  const r = await resolveReplyWithModel(base(c.artifact) as any, c.client as any);
  const actual: Expect = r.authority === 'llm_inferred' ? 'pass' : 'caught';
  const good = actual === c.expect;
  if (!good) fails++;
  const why = (r as any).fallback_reason ? `  (${(r as any).fallback_reason})` : '';
  console.log(`${good ? '  ok ' : 'XX  '}[${c.id}] exp=${c.expect.padEnd(6)} got=${actual.padEnd(6)} reply=${JSON.stringify(r.reply).slice(0, 42)}${why}`);
}
console.log(`\nLane-A floor (EVAL05, current contract): ${cases.length - fails}/${cases.length} pass${fails ? '  — FAIL' : ''}`);
console.log('PENDING new Car-1 contract: EVAL05 proposed_action tenant-validation · EVAL12 updated_working_draft fabrication · EVAL13 entity-bleed.');
if (fails) process.exit(1);
