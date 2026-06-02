# Build Orientation · Right Hand surface alignment · 2026-06-01

**Read this first.** It sits on top of the 13 wireframes + 2 directives and tells the build lane where to start, in what order, and what "done" means. Source of truth is kerf-cos `_docs/wireframes/` + `_docs/operations/dispatch_prompts/`; vendor what you implement into kerf-app (D-057).

---

## The one acceptance target (everything else serves this)

**Right Hand is one persistent conversational surface; approval appears only at the consequence point.**

The contract (from `F-RH3` + the One-Surface Directive):
1. Background **blurs**; the conversation lives in one growing surface. You never "leave" the screen you were on.
2. The **same mic stays available** the whole time.
3. **Stop appends the reply in place** — never a new screen, never a three-button card dialog.
4. A confirm affordance appears **only when filing / sending / money / a durable write is one tap away**, phrased as the real question (*"Save to Wegrzyn → Daily Log? · Change job · Keep talking"*) — affordances that answer where-it-goes, not a generic Save/Don't-save box.
5. **"Saved" renders only after the write returns** (no false persistence).

Read `F-RH3_mobile_right_hand_conversation_lifecycle.html` (Annotated) for the five stages. The crux to verify on the active loop: **stage 4** — Stop must produce the inline consequence bubble, not the "READY FOR CHRISTIAN" 3-button card.

---

## Reading order

1. `F-RH3` conversation lifecycle — the grammar + contract.
2. `RightHand_v47_TestDrive_Defects_and_Fix_Directive` — the 5 driven defects + acceptance.
3. `RightHand_ModelLed_Persistent_Response_and_JobNote_Artifacts` — model-led reply + job-note artifacts.
4. The 12 surface wireframes (Annotated panels carry the build intent).

Stop treating **Field Capture** as the center. The spine is **F-A1b → F-RH3 → F-CAM1 / F-DL grammar**.

---

## Standing step 0 — every lane, before you build (D-057)

**Vendor your lane's brief AND wireframe(s) into kerf-app first, then build from the Annotated panels — never from a summary.** The Cursor/Codex agents work in **kerf-app**; canon lives in **kerf-cos**. Nothing crosses that gap automatically — an agent in kerf-app cannot see a kerf-cos doc, even after it's pushed. So each lane's first commit:

1. **Push the brief + wireframe to kerf-cos** (if not already — much of this session's canon is still uncommitted/untracked; that's the #1 reason agents "don't have access").
2. **Copy this lane's brief + wireframe file(s) into `kerf-app/docs/canon/`** and commit to kerf-app — so the agent reads them locally in the repo it's building in. (This is what D-057 "vendor what you implement" means — it covers the brief, not just the wireframe.)
3. Read the **Annotated** view — the build intent lives in the spec side-rails, not the pixels.
4. Then build. If the wireframe and a brief disagree, the **wireframe's Annotated panel wins** for layout/behavior; the brief wins for floor/safety/acceptance.

**Immediate unblock if an agent is stuck without its brief:** paste the brief's markdown straight into the agent's context. The briefs are short; no repo round-trip needed.

This keeps "wired" honest — you're matching the real source, and the wiring-truth pass (section 5) can diff against it.

### Concurrency rule — one `git worktree` per lane (non-negotiable for parallel agents)

The lanes were split by **file ownership** so commits don't conflict — but that does NOT protect a **shared checkout**. Multiple agents in one working directory will switch branches under each other; a push or checkout from lane X can land on lane Y's uncommitted changes and silently clobber them. This already happened once (Lane B's push, while the checkout had been moved to `phase-1j-rh3-stage4` with uncommitted work) — recovered non-destructively, but it was a near miss.

**Each lane gets its own worktree, not a shared checkout:**

```bash
# from the kerf-app repo root, once per lane:
git worktree add ../kerf-app-laneB lane-b-job-note-artifact
git worktree add ../kerf-app-camera  cam1-v1-shell
git worktree add ../kerf-app-laneC   lane-c-builders
# ...one dir per lane, each on its own branch, all sharing one .git
```

- Each agent works, commits, and pushes **only in its own worktree** — no branch-switching collisions, no shared dirty tree.
- `node_modules` stays per-worktree (or symlinked); never commit it.
- Merge order to `main` is a deliberate human step (Christian), one lane at a time, after each lane's clean-room verify.

If an agent finds itself in a shared checkout with another lane's uncommitted work present, **stop and flag it** — do not branch-switch or push over it.

---

## Current fit snapshot (founder check vs. local deploy · 2026-06-01)

Honest state — the active patch is correctly focused on the Right Hand loop, not a full surface rebuild.

| Wireframe | Fit |
|---|---|
| F-A1b Owner Home | **Close** — header, avatar, One Thing / On Deck / Pulse, bottom bar aligned. |
| F-RH3 Conversation | **Converging** — start matches (blur, tray, mic). Verify stage-4 consequence bubble. |
| F-FH1 Field Hand | Partial — generic bar, not Clock-first. |
| F-SA1 Sales | Partial — not its own home yet. |
| F-PS1 PM/Super | Partial — lens not fully projected. |
| F-AD3 Admin | Partial — needs Money/Sentry bar logic. |
| F-SUB1 Sub | Partial — should be Submit-first. |
| F-CHG1 Change Order | Not yet a full builder. |
| F-EST1 Estimate | Partial — cleaner language, not full builder. |
| F-DL1 Daily Log | Partial — no giant mic, not yet the simple Daily Log. |
| F-DL2 Clock-out | Not yet the adoption-first field gate. |
| F-DL3 Guidance Level | Not implemented. |
| F-CAM1 Camera | Partial — actions present, not the unified Walkthru/Photo/Scan + job picker. |

---

## Ship + queue (founder-set order)

**Ship now:** the F-RH3 conversation polish as the active phone-loop fix (verify stage 4 first).

Then the surface-alignment packets, in order:

1. **F-CAM1 Camera** — unified camera (job-picker gate → Walkthru / Photo / Scan inline, consistent Done exit, universal component). Produces the job-context + friendly-job-note primitive #2 reuses.
2. **F-DL1 Daily Log** — replace the remaining capture-card feel with readable job notes + media; one mic.
3. **Role bottom bars** — Field = Clock-first · Sub = Submit-first · Admin = Money/Sentry. **⚠ Gated on D-046** (fixed bar vs. role-variant). Lock that decision before this ships — the variant bars only exist if "variant" is chosen.
4. **F-EST1 / F-CHG1 builders** — the real estimate / change-order surfaces (shared engine, differ only at the customer block).

---

## Verification notes

- `npm run typecheck` ✓ · `npm run build:astro` ✓ · focused RH/resolver/shell tests `78/78` ✓ (2026-06-01).
- **Known harness limit:** in-app browser automation can't type into the Heard box (virtual clipboard hook missing); typed-path behavior is verified via focused tests, not manual browser typing.
- **Product-reality pass:** when the loop is stable, Cowork can re-drive the live Fly deploy in-browser (as on v47) to confirm stage 4 and the surface fits on a real phone viewport — the second pass that catches "passed CI but renders wrong" (`feedback_substrate_gates_miss_product_reality`).

---

*Orientation 2026-06-01. One surface, consequence-gated approval. Ship the loop, then align surfaces Camera → Daily Log → role bars (after D-046) → builders.*
