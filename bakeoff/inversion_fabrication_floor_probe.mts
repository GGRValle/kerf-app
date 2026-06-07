/**
 * Car-1 gate · Lane-A deterministic probe — fabrication-floor OVER-STRIP (EVAL12 inverse).
 *
 * EVAL12 asks the draft-fabrication floor to strip INVENTED scope/numbers. This
 * probe asserts the floor's other edge: it must NOT strip scope the operator
 * actually said just because the model paraphrased it. Token-exact support
 * (`hasSourceSupport`) drops an entire scope/allowance line when ONE token in it
 * is absent from the operator corpus — even a faithful clarifier ("HVAC",
 * "conversion", "install", "approximately"). That silently deletes real scope
 * and mislabels it as fabrication. No model, no key — pure resolver logic.
 *
 * Run: node --import tsx bakeoff/inversion_fabrication_floor_probe.mts
 */
import { cleanWorkingDraftUpdateWithFlags, type ResolveReplyInput } from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';

const OKONKWO = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';

const input: ResolveReplyInput = {
  latestText: OKONKWO,
  draftText: OKONKWO,
  tenantId: 'tenant_ggr' as never,
  trp: buildTurnResolutionPacket({ heardText: OKONKWO, intent: 'job_intake' }),
  conversationTurns: [{ speaker: 'operator', text: OKONKWO }],
};

type Case = { id: string; scope: string; expectKept: boolean; note: string };
const cases: Case[] = [
  { id: 'A verbatim', scope: 'converting the garage to a 400 sqft ADU', expectKept: true, note: 'exact operator words -> kept (control)' },
  { id: 'B +clarifier', scope: 'Garage ADU conversion: 400 sqft, rough plumbing for kitchenette, mini-split HVAC', expectKept: true, note: 'faithful paraphrase, adds "HVAC"/"conversion" -> SHOULD be kept' },
  { id: 'C reorder', scope: 'mini-split and rough plumbing for a kitchenette in the 400 sqft garage ADU', expectKept: true, note: 'same facts, reordered -> SHOULD be kept' },
  { id: 'D invented', scope: 'skylight and 600 sqft rooftop deck', expectKept: false, note: 'genuinely not said -> correctly stripped' },
];

let fails = 0;
for (const c of cases) {
  const { update, flags } = cleanWorkingDraftUpdateWithFlags({ scope: [c.scope] }, input);
  const kept = !!update?.scope?.includes(c.scope);
  const ok = kept === c.expectKept;
  if (!ok) fails++;
  console.log(`${ok ? '  ok ' : 'XX  '}[${c.id}] expectKept=${c.expectKept} kept=${kept}`);
  console.log(`        scope: ${JSON.stringify(c.scope)}`);
  console.log(`        flags: ${JSON.stringify(flags)}   (${c.note})`);
}
console.log(`\nFabrication-floor over-strip probe: ${cases.length - fails}/${cases.length} as-expected${fails ? '  — DEFECT: floor strips faithful paraphrase of operator scope' : ''}`);
process.exit(fails ? 1 : 0);
