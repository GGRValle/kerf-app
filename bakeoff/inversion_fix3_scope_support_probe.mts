/**
 * Car-1 gate · FIX-3 acceptance probe — scope-support over-strip (the production regression).
 *
 * FIX2's `hasScopeSourceSupport` keeps a scope line only if EVERY non-whitelist anchor token
 * appears in the operator corpus. A faithful model elaboration ("supply", "install", "liner",
 * "drain", "demo") or a morphological variant ("floors" vs "flooring") drops the WHOLE line and
 * mislabels it `unsupported_scope`. This bit in prod: Sonnet said "Mini-split supply and install"
 * → the decisive Okonkwo item was dropped + flagged as fabrication.
 *
 * FIX-3 must move support from token-whitelist to ANCHORED COVERAGE: keep a line whose distinctive
 * operator content is present (stem/lemma-matched) while tolerating model elaboration — WITHOUT
 * going permissive (no operator anchor, a contradicting number, or an invented distinctive head
 * noun must still strip). Stemming alone is NOT sufficient: "supply"/"liner"/"drain"/"demo" are not
 * stems of any operator word.
 *
 * ACCEPTANCE (all green against the fix): this probe 9/9 AND inversion_fabrication_floor_probe.mts
 * 4/4 AND inversion_floor_probe.mts 7/7 AND the resolver suite AND `tsc --noEmit`.
 * Run: node --import tsx bakeoff/inversion_fix3_scope_support_probe.mts   (exit 0 = 9/9)
 */
import { cleanWorkingDraftUpdateWithFlags, type ResolveReplyInput } from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';

const OKONKWO = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';
const GOLD = "Kitchen plus a whole downstairs remodel. About 60 lineal feet of white oak cabinetry, quartzite countertops, and replace wood flooring. The existing tile and carpet will be removed and we will install glue-down wood flooring, about a thousand square foot. We're going to paint the downstairs — baseboards, walls, ceilings. Quartzite for budget purposes. About a 12x15 kitchen with an island.";

const ctx = (corpus: string): ResolveReplyInput => ({
  latestText: corpus, draftText: corpus, tenantId: 'tenant_ggr' as never,
  trp: buildTurnResolutionPacket({ heardText: corpus, intent: 'job_intake' }),
  conversationTurns: [{ speaker: 'operator', text: corpus }],
});

type Case = { id: string; corpus: string; scope: string; keep: boolean; note: string };
const cases: Case[] = [
  // KEEP — operator-anchored, model-elaborated (the live prod drops + morphological variants)
  { id: 'PROD mini-split', corpus: OKONKWO, scope: 'Mini-split supply and install', keep: true, note: 'op "mini-split"; "supply" elaboration — DECISIVE Okonkwo item, dropped live' },
  { id: 'PROD demo-studs ', corpus: OKONKWO, scope: 'Hall bath demo to studs', keep: true, note: 'op "hall bath down to studs"; "demo" elaboration' },
  { id: 'PROD curbless  ', corpus: OKONKWO, scope: 'Curbless shower — tile, liner, drain', keep: true, note: 'op "curbless shower"; liner/drain elaboration' },
  { id: 'FIX2 regress  ', corpus: OKONKWO, scope: 'Garage ADU conversion: 400 sqft, rough plumbing for kitchenette, mini-split HVAC', keep: true, note: 'must stay kept (FIX2 case B)' },
  { id: 'morph floors  ', corpus: GOLD, scope: 'glue-down wood floors', keep: true, note: 'op "flooring"; stem variant' },
  { id: 'morph cabinets', corpus: GOLD, scope: 'white oak cabinets', keep: true, note: 'op "cabinetry"; stem variant' },
  // STRIP — genuine fabrication; the fix must NOT go permissive
  { id: 'FAB invented  ', corpus: OKONKWO, scope: 'skylight and 600 sqft rooftop deck', keep: false, note: 'no operator anchor — strip' },
  { id: 'FAB number    ', corpus: OKONKWO, scope: 'heated tile floor about 120 sqft', keep: false, note: 'op said 90 sqft; 120 inflation — strip' },
  { id: 'FAB shared-stem', corpus: OKONKWO, scope: 'bathroom skylight', keep: false, note: 'OVER-LOOSEN GUARD: "bath" stem-anchors but "skylight" is the invented head noun — must strip' },
];

let fails = 0;
for (const c of cases) {
  const { update, flags } = cleanWorkingDraftUpdateWithFlags({ scope: [c.scope] }, ctx(c.corpus));
  const kept = !!update?.scope?.includes(c.scope);
  const ok = kept === c.keep;
  if (!ok) fails++;
  console.log(`${ok ? '  ok ' : 'XX  '}[${c.id}] want=${c.keep ? 'KEEP ' : 'STRIP'} got=${kept ? 'kept' : 'stripped'}   (${c.note})`);
  if (flags.length) console.log(`          flags: ${JSON.stringify(flags)}`);
}
console.log(`\nFIX-3 acceptance: ${cases.length - fails}/${cases.length} as-expected${fails ? '  — NOT YET FIXED (fix must reach 9/9 without regressing fabrication 4/4 + honesty 7/7)' : '  ✓ FIXED'}`);
process.exit(fails ? 1 : 0);
