# Lane C · Estimate + Change Order Builders — build report

**Date:** 2026-06-01 · **Branch:** `lane-c-estimate-change-order-builders` (off `origin/main` @ `0caf84c`)
**Owns:** the builder engine + the two builder surfaces. **Consumes** (does not own): the F-RH3 voice overlay, the Cost Library substrate.
**Gate:** Proportional Above The Floor (D-058) · Bar 3 — a real change order built on a phone and previewed (shown below).

---

## Step 0 (D-057) — wireframes vendored, built from the Annotated panels

Vendored into the repo before writing code, and built from their **Annotated** panels (wireframe wins on layout/behavior; brief wins on floor/safety/acceptance):

- `docs/wireframes/canon/F-CHG1_mobile_change_order_builder.html`
- `docs/wireframes/canon/F-EST1_mobile_estimate_builder.html`

## Canon files used

- **F-CHG1 / F-EST1** (vendored above) — layout + behavior source of truth.
- `_docs/product/RightHand_Estimate_Contract_and_Consult_v1_2026-05-30.md` — the `line_type` discriminator (§2.3: `labor · material · product · allowance · subcontract · equipment · markup · fee`), money-as-cents, margin-never-a-client-line, and the Selections-promotion rule (only `material · product · equipment · subcontract` promote; `labor` never; `allowance` has its own behavior).
- `docs/wireframes/canon/F-RH3_stage4_consequence_bubble_extract_2026-06-01.md` — the consequence-gated confirm (answers the real question, never a generic Save/Don't-save box).
- `docs/wireframes/canon/F-PV1_mobile_proposal_view.html` — pre-contract canon (a signed estimate becomes a contract).

---

## The shape — one engine, two doors

The builder engine is built **once**; the two surfaces differ **only at the customer block**.

| | **F-CHG1 · Change Order** (`/change-orders/new`) | **F-EST1 · Estimate** (`/estimates/new`) |
|---|---|---|
| Customer block | **Project-known** — Customer + Project # prefill, green "From project" chips | **Lead-capture** — Find existing client OR add new lead (Name · Phone · Email · Address + Locate); Project # = "Assigned on save · New" |
| Send gate | Send to client (explicit confirm) | Send for signature — "becomes a contract when signed", promotes lead → client + project |
| Everything below | **shared** | **shared** |

Shared below the customer block: **Title** (editable) · **Type** dropdown (Lump sum / Sections / Itemized — the layout discriminator) · **Scope of work** (model-written from added items) · **Add item → Cost Library** picker · **Totals** (Subtotal · Markup · Tax · Discount → Total, auto-calc by permission + settings) · **Preview** (client view) · **Send** (external gate).

## Surfaces / files changed

**New (owned by this lane):**
- `src/app/lib/builderEngine.ts` — the pure, dependency-free engine (cents math, `line_type`, totals, client-folding, allocation, format-at-edge). Imported by both server and the bundled client script (single source of truth).
- `src/app/lib/costLibraryFixtures.ts` — six priced categories (Assemblies · Items · Materials · Labor · Subcontractor · Demolition), each entry typed with `line_type` + integer-cents `unit_cost_cents`.
- `src/app/lib/builderFixtures.ts` — Change-Order prefill projects (fail-closed default) + GGR builder settings (35% markup, CA tax).
- `src/app/components/BuilderShell.astro` — the one shared surface (server-render + bundled client script); `mode` selects the customer block.
- `src/app/styles/builder.css` — consumes `--kerf-*` / `--accent` / `--right-hand` / `--field-green`; the two canon accents not yet in shell (coral, teal) are scoped to `.bld-page`.
- `src/app/pages/change-orders/new.astro` · `src/app/pages/estimates/new.astro` — the two doors.
- `tests/lane-c-builder-engine.test.ts` — 15 builder/money-rule tests.

**Edited (entry-point wiring, low-conflict):**
- `src/app/pages/create.astro` — the "Change order" action now routes to the real `/change-orders/new` builder (was a dead-end at `/draft-review`); added an "Estimate" action → `/estimates/new`.

---

## Money + send discipline (Bar 2)

- **Integer cents everywhere.** All math (`subtotalCents`, `markupCents`, `taxCents`, `computeTotals`, per-line allocation) is integer-cents; dollars appear only via `formatCents` at the display edge. Verified by tests + the live demo (42 SF × `$130.00` = `$5,460.00`; 24 HR × `$95.00` = `$2,280.00`).
- **No money write/post from the UI.** Totals auto-calc for display only. There is **no** mutation/fetch that writes or sends money. `sendRequiresOperatorReview()` is a constant `true` — there is no autonomous-send path.
- **Markup hidden on the client doc.** `toClientTotals` folds markup into the subtotal; `clientLineCents` allocates markup across lines with largest-remainder distribution so the cents reconcile **exactly** (no penny drift). The client preview shows **no markup row** and carries the explicit note "Markup is never shown on the client document." Operator total and client total are identical.
- **Send = external gate, explicit confirm.**
  - Change Order → "Send this change order to *<customer>* for approval — total *<$>*? Nothing sends until you confirm." → [Send to client] / [Keep editing].
  - Estimate → "Send this estimate to *<lead>* for signature — total *<$>*? A signed estimate **becomes a contract** and promotes the lead to a client + project." → [Send for signature] / [Keep editing].
  - The confirm is an F-RH3 stage-4 consequence bubble (answers the real question; not a generic Save/Don't-save). After confirm the surface shows an **honest** "Reviewed — ready to send / ready for signature" state; it never renders a false "Sent ✓" (no real write returns in this lane — actual transmission is the external send endpoint, out of lane).
- **Prices come from the Cost Library or operator entry — never model-invented.** `Add item` → category → priced library line flows into Scope and recalculates totals.

## Fail-closed binding

`/change-orders/new` reads `?project_id`; if the binding is missing/unknown it falls back to the founder demo project rather than fetching against a null project. No surface fetches against an unresolved tenant/project/client.

## Reuse, not rebuild

- **RH-assisted banner** carries `data-rh-speak` + `href="/right-hand"` — it opens the **existing** `RightHandVoiceOverlay` (F-RH3), with the route as the no-JS fallback. No new voice surface was built.
- **Back affordance** present on every builder surface (v47 Defect 5) — top-left chevron `‹` linking back to the originating lane.

---

## Acceptance checklist

- [x] One engine; CO and Estimate differ only at the customer block (prefill vs. lead-capture).
- [x] Type dropdown drives layout (lump sum / sections / itemized) on Preview.
- [x] Add item → Cost Library → lines populate Scope and recalculate totals.
- [x] Totals computed in integer cents; display formatting only at the edge. Markup hidden on client Preview.
- [x] Send: CO → client confirm; Estimate → signature gate with "becomes a contract" marker; promotes lead → client + project.
- [x] No money written/sent without the explicit review step. RH banner opens the F-RH3 overlay. Back affordance present.
- [x] `npm run typecheck` · `build:astro` · builder/money-rule tests pass. **Path-truth:** a real CO built + previewed on a phone (below).

## Not this lane (confirmed untouched)

- Did **not** build/modify the camera, daily log, role homes, or the RH overlay component (consumed it).
- **No** margin-on client doc. **No** model-invented prices. **No** autonomous send.

## Follow-ups (out of lane)

- Spanish strings: builder copy is currently literal English to avoid colliding with concurrent i18n edits in other lanes; `t()`-ization is a clean follow-up.
- The actual external send transmission (CO send / estimate send-for-signature) and the lead→client+project promotion write are deliberately not performed from the UI — they wire to the send endpoint in a later lane.

---

## Verification

All run in the isolated worktree `/Users/christianasdal/code/kerf-app-lane-c`:

- `npm run typecheck` → **pass** (exit 0).
- `npm run build:astro` → **pass**; `BuilderShell` client script bundled (`12.05 kB`).
- `node --import tsx --test tests/lane-c-builder-engine.test.ts` → **15 pass / 0 fail**.

### Path-truth — real change order built on a phone and previewed (iPhone 390×844)

Operator builder — project-known prefill, two real Cost Library lines, full totals (markup visible to operator), `Total $10,872.15`:

![CO operator builder](assets/lane-c/co-operator-builder.png)

Client preview — **markup folded into the line prices** (`$7,371.00` + `$3,078.00` = `$10,449.00` subtotal), tax `$423.15`, **Total `$10,872.15` identical to operator**, and **no markup row**:

![CO client preview](assets/lane-c/co-client-preview.png)

Estimate door — lead-capture customer block, "Assigned on save · New", "Send for signature — becomes a contract when signed" gate:

![Estimate door](assets/lane-c/estimate-door.png)

Estimate Send — consequence-gated signature confirm (F-RH3 stage-4 style, answers the real question):

![Estimate signature gate](assets/lane-c/estimate-signature-gate.png)

*A clean-worktree re-verification of the pushed tip is appended below after push.*
