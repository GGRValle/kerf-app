# Car-1 Conversation Inversion — gate eval harness

*The independent gate's runnable instrument for the Conversation Inversion brief. When Codex's PR lands, the gate runs these **verbatim** instead of inventing the check on the spot. Built by the gate (Claude Code), not the builder — testing the build, not building it.*

Corpus: `inversion_evals.jsonl` · 15 entries (Step 0 + GOLD reference + EVAL01–13).

## Two lanes (this is the whole design)
The eval set splits cleanly by *how* it's scored — and that determines what runs when:

**Lane A — deterministic floor probes (offline, no model, no judge).** Stubbed model output through the resolver/parser, exactly like the honesty-floor + flag×artifact probes that gated #302. These run the moment the relevant contract exists; some run against the *current* resolver today.
- `EVAL05` floor tests — claims_durable_action / malformed-JSON / model-down are runnable **now** (baseline); `proposed_action` tenant-validation runs once the new contract lands.
- `EVAL12` draft-fabrication floor — runs once `updated_working_draft` is a model output (stub an invented client/$ → assert floor strips/flags).
- `EVAL13` entity-bleed — assert no foreign entity in reply/draft + context-assembly scoping.
- `EVAL07` side-speech hold + the repetition-guard half of `EVAL06` — deterministic.
- **Verdict type: PASS/FAIL, exact.** A floor failure is a hard BLOCK.

**Lane B — conversational / behavioral (PR + live model + frontier judge).** The gold transcript is a *shape, not a string* — scored by a frontier judge + human spot-check, **never string-match**. Run at **temp 0** (or multi-sample); the live reply path is ~0.45 and not reproducible single-shot.
- `EVAL01, 03, 04, 06` (conversational), `EVAL02, 09` (behavioral), and Step 0.
- `EVAL09` and `EVAL11` are **behavioral_ui** — they need the rendered surface (device / Claude_Preview), pixels over probes, like the bloom gate.

## Dispatch mapping (gate only what's in the PR)
| Dispatch | Evals the gate runs |
|---|---|
| **1 — core inversion + F4** (this PR) | Step 0 logged · EVAL 01, 02, 03, 04, 05, 06, 07, 09, 12, 13 |
| **2 — placeholder-first filing** | EVAL 08, 10 |
| **3 — assembly handoff** | EVAL 11 |

## How the gate runs it when the PR lands
1. Add the PR branch as a worktree (or check it out into this one) so the harness imports the PR's resolver.
2. **Lane A first** — `node --import tsx bakeoff/inversion_floor_probe.mts`. Any FAIL → BLOCK, no further. (Deterministic, fast, no key.)
3. **Step 0** — run the assembled §3 prompt raw vs the current prompt on the GOLD paragraph; log both in the PR.
4. **Lane B** — drive the conversational/behavioral evals against the PR + a model at temp 0; frontier-judge each output against its `pass`/`fail`; human spot-check the conversational ones; render EVAL09 behaviorally.
5. Scorecard: per-eval PASS/FAIL + the failure gallery (verbatim breaks, no cherry-picking) + the gold-vs-actual diff. This doubles as the **first altitude-eval dataset**.

## Status
- ✅ Corpus encoded (Step 0 + GOLD + 13 evals, tagged by dispatch / type / offline-runnable).
- ✅ Lane-A floor probe wired (`inversion_floor_probe.mts`) — baselines the *current* resolver's floor; extends to EVAL12/13 when the contract lands.
- ⏳ Lane B needs the PR + a model (GROQ key parked) + the verbatim walk-2 script for EVAL02.
- The gate does **not** gate its own work: this harness is the gate's instrument; Codex builds Car 1; Christian merges.

*Canon: the Conversation Inversion brief (evals 1–13, Step 0, gold transcript verbatim) · D-061 eval/replay lane · conversational_altitude_spec.md (the rung rubric this extends) · "done = the rendered surface matches the picture" for the behavioral_ui evals.*
