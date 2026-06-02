# Lane C Build Packet · Estimate + Change Order Builders · 2026-06-01

**Concurrent lane** (runs alongside Lane A · Camera/Codex, Lane B · job-note, Lane D · CI, Lane E · role homes). See `RightHand_Build_Orientation_2026-06-01.md`.
**For:** one Cursor agent. **Owns:** the builder engine + the two builder surfaces. **Does NOT own:** the camera, daily log, or the RH overlay (it *consumes* the overlay).
**Build targets:** `_docs/wireframes/F-CHG1_mobile_change_order_builder.html` · `F-EST1_mobile_estimate_builder.html` (read the Annotated panels).
**Canon:** the estimate contract (`RightHand_Estimate_Contract_and_Consult_v1`, `line_type` discriminator) · money = integer cents · six guardrails (no money write from UI without review) · F-PV1 pre-contract (signed estimate becomes a contract) · F-RH3 overlay contract.
**Gate:** Proportional Above The Floor (D-058). Bar 3: Christian builds a real change order on his iPhone and previews it.
**Step 0 (D-057):** vendor `F-CHG1_mobile_change_order_builder.html` + `F-EST1_mobile_estimate_builder.html` into kerf-app first and build from their **Annotated** panels — not from this brief's prose. Wireframe wins on layout/behavior; brief wins on floor/safety/acceptance.

---

## The shape (one engine, two doors)

Build the **builder engine once**; the two surfaces differ **only at the customer block**:

- **F-CHG1 Change Order** — project-known. Customer + Project # **prefill** (from project, or GPS), green "From project" chips.
- **F-EST1 Estimate** — lead-capture. "Who's this for?" — find existing client OR add new lead (Name · Phone · Email · Address+geo); Project # = "Assigned on save."

Everything below the customer block is **shared**:

1. **Title** (editable).
2. **Type** = the layout discriminator — dropdown `Lump sum · Sections · Itemized`. Controls how scope/items render on the client doc.
3. **Scope of work** (model-written from added items / dictation).
4. **Add item** → template categories (Assemblies · Items · Materials · Labor · Subcontractor · Demolition) → **Cost Library** picker → returned lines flow into Scope.
5. **Totals** — Subtotal · Markup · Tax · Discount → **Total**, **auto-calculated by permission + settings**.
6. **Preview** (client view) · **Send** (the external gate).

---

## Money + send discipline (Bar 2 — non-negotiable)

- **Money is integer cents in storage.** Never floats, never dollars. All math in cents; format for display only.
- **No money posts from the UI without review.** Totals auto-calc, but writing/sending is an explicit operator step gated by permission + settings.
- **Markup**: visible on the operator builder; **collapses into the price on the client Preview** by default (margin-off). Don't leak margin to the client doc.
- **Send = external gate, never autonomous.** 
  - Change Order → send to client (explicit confirm).
  - Estimate → **send for signature**; a signed estimate **becomes a contract** (F-PV1), then promotes the lead → client + project (so a future change order can prefill from it). Show the "becomes a contract when signed" marker.
- **Add item → Cost Library** returns priced lines; lines drive the totals. The agent does not invent prices — they come from the library (or are operator-entered).

---

## Reuse, don't rebuild

- **RH-assisted banner** at the top → opens the **F-RH3 one-surface overlay** (consume Lane A's / the existing overlay; do not build a new voice surface). Dictation fills Title / Scope / items.
- **Back affordance** on every surface (v47 Defect 5 — builders are exactly the surfaces that were missing it).
- If Lane B's `JobNote` lands, a saved CO/estimate may surface as a job-note elsewhere — but that's the consumer's job, not this lane's.

---

## Acceptance

- [ ] One engine; CO and Estimate differ only at the customer block (prefill vs. lead-capture).
- [ ] Type dropdown drives layout (lump sum / sections / itemized) on Preview.
- [ ] Add item → Cost Library → lines populate Scope and recalculate totals.
- [ ] Totals computed in integer cents; display formatting only at the edge. Markup hidden on client Preview.
- [ ] Send: CO → client confirm; Estimate → signature gate with "becomes a contract" marker; on sign, lead promotes to client+project.
- [ ] No money written/sent without the explicit review step. RH banner opens the F-RH3 overlay. Back affordance present.
- [ ] `npm run typecheck` · `build:astro` · builder/money-rule tests pass. **Path-truth:** a real CO built + previewed on a phone, shown working.

## Not this lane

- NOT the camera, daily log, role homes, or the overlay component (consume the overlay).
- NOT a margin-on client doc. NOT model-invented prices (Cost Library / operator only).
- NOT autonomous send.

---

*Lane C · 2026-06-01. Build the builder once; the Change Order door prefills, the Estimate door captures a lead. Cents in storage, signature is the gate.*
