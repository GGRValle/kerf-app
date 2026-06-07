# Gate scorecard — PR #305 (`5048ca1`, FIX2) · Conversation Inversion (Dispatch 1)

**Gate:** Claude Code (independent). **Date:** 2026-06-07. Re-gate per `Dispatch_Card_Inversion_1_FIX2_2026-06-07`.
**Config:** reply brain `claude-haiku-4-5` (+ `claude-sonnet-4-6` A/B per D-064) · judge `claude-sonnet-4-6` · temp 0.
**Method:** PR as worktree; my own committed probes (verified byte-identical to `9f4bfd6`, then re-restored) imported against the PR's fixed resolver. Builder's numbers not taken on trust.

## Verdict: **MERGE** (qualified — one required fast-follow)

All four card acceptance bars hold under independent verification, and the D-064 A/B resolves exactly as the card anticipated. One residual — the fabrication floor still over-strips *some* faithful paraphrases — is logged as a required Pass-5 fast-follow. It fails **safe** (drops + flags, never fabricates; honesty floor intact), is surfaced not silent, and sits outside the card's named Okonkwo bar — so it does not block, but Christian's Pass-4 should see it.

## Card bars — independently verified

| # | Bar | Result |
|---|---|---|
| 1 | Fabrication probe 4/4 | ✅ **4/4** — Case B (HVAC clarifier) now **kept**; Case D (invented "skylight / 600 sqft deck") still **stripped**; A/C kept. Ran myself. |
| 2 | Honesty floor 7/7 | ✅ **7/7** — claim-without-artifact caught, "Filed" backstop fires, malformed/outage/502 → humble fallback. Ran myself. |
| 3 | Okonkwo: ADU + kitchenette + mini-split survive persisted scope | ✅ **survive on BOTH reply brains** — `scope` carries "Garage conversion to ADU, 400 SF", "Kitchenette rough plumbing", "Mini-split HVAC" (5/6 kw). The FIX2 clarifier change (hvac/conversion) is what saved them. |
| 4 | GOLD: draft + ≤1 consequence-ranked, zero identity slot-asks | Haiku ❌ → D-064 → Sonnet ✅ (see A/B). |

## D-064 A/B — reply brain Haiku vs Sonnet (temp 0)

The card said: *if Haiku still slot-asks on GOLD, run Sonnet and report the A/B.* It does; here it is.

| | **Haiku** reply brain | **Sonnet** reply brain |
|---|---|---|
| GOLD question | "what's the budget range and timeline?" → **slot-ask, FAIL** | "does the 1,000 SF flooring cover the whole downstairs or is kitchen separate?" → **consequence-ranked, zero slot-asks, PASS** |
| Chen variant | slot-asks address/budget → FAIL | one consequence-ranked Q (cabinet supply method), no client re-ask → **PASS** |
| Identity in open_items | ✅ | ✅ |

**D-064 finding:** the inversion (draft + one consequence-ranked question, zero identity slot-asks) **is achievable** — Sonnet does it cleanly. The slot-ask is a *cheap-model limit*, not a prompt/architecture defect. Resolution per D-064: **route GOLD/intake-class reply calls to the frontier tier.** (Note: production reply brain is `llama-3.3-70b`; this A/B says the prompt is sound and the tier is the lever.)

## Residual (required fast-follow — does NOT block)

The fabrication floor still strips faithful operator scope when the model's paraphrase token isn't in the hardcoded clarifier whitelist. Observed on **both** reply brains, live:
- Okonkwo: `unsupported_scope:Curbless shower installation` ("installation" ∉ whitelist; only "install"/"installed" are) and `unsupported_scope:Hall bath demo to studs` ("demo"/"demolition", "bathroom" vs "bath"). → curbless shower dropped from scope.
- GOLD: `unsupported_scope:Quartzite countertops (budget-grade…)` ("grade") and `…glue-down wood (demo tile/carpet first)` ("demo").

**Why the 4/4 probe is green anyway:** FIX2 added the exact tokens my Case B used (`hvac`, `conversion`) to the whitelist. A hardcoded clarifier list is whack-a-mole — real models reach for "installation / demolition / grade / tear-out" the next turn. **Fix:** replace the whitelist with a stemmed/lemmatized corpus match (so "installation"~"install", "demolition"~"demo", "bathroom"~"bath") or an anchor-coverage threshold on distinctive nouns+numbers. Then add live-paraphrase cases (curbless shower installation, demo to studs, budget-grade quartzite) to `inversion_fabrication_floor_probe.mts` so the probe stops being tunable to one token.

**Why it doesn't block:** fails safe (under-claims, never fabricates — honesty seam preserved in the dangerous direction); dropped items are surfaced via `draft_fabrication_flags`, not silently lost, and remain in `rawText`/conversation; and the card's decisive Okonkwo bar (the three ADU items) is met. Secondary wart: the flags mislabel real scope as "unsupported" — refine the label alongside the fix so operators don't learn to distrust the flag.

## What passes cleanly
- Deterministic floors 4/4 + 7/7 (independently run).
- `claims_durable_action` correctly false in every live turn; no false "filed/saved".
- Client-name re-ask suppressed on both reply brains (Chen never re-asked).
- Identity/logistics correctly parked in `open_items` throughout.
- Inversion behavior proven achievable on frontier tier (D-064).

## Harness (this dispatch)
- `inversion_floor_probe.mts` — Lane A honesty (EVAL05), 7/7.
- `inversion_fabrication_floor_probe.mts` — Lane A EVAL12 over-strip, 4/4 (needs paraphrase cases added — see residual).
- `inversion_live_eval.mts` — Lane B live; `REPLY_BRAIN` env selects reply brain (default haiku) for the D-064 A/B.
