# Lane E Build Packet · Role-Home Content Projections (bar deferred) · 2026-06-01

**Concurrent lane** (runs alongside Lane A · Camera/Codex, Lane B · job-note, Lane C · builders, Lane D · CI). See `RightHand_Build_Orientation_2026-06-01.md`.
**For:** one Cursor agent. **Owns:** the role-home content projections on the existing A1b home shell. **Does NOT own:** the bottom bar (deferred), the camera, the builders.
**Build targets:** `F-FH1` (Field) · `F-SA1` (Sales) · `F-PS1` (PM/Super) · `F-AD3` (Admin) · `F-SUB1` (Sub) — read the Annotated panels.
**Canon:** `kerf_three_layer_operating_model` (role roots are projections of one 9-domain graph, not separate products) · `feedback_translate_canon_vocabulary_at_surface` · `feedback_adoption_first_dont_surveil_crew` (Field/Sub) · the A1b home shell.
**Gate:** Proportional Above The Floor (D-058).
**Step 0 (D-057):** vendor the five role-home wireframes (`F-FH1` · `F-SA1` · `F-PS1` · `F-AD3` · `F-SUB1`) into kerf-app first and build from their **Annotated** panels. `F-PS1` is already vendored. Wireframe wins on layout/behavior; brief wins on floor/safety/acceptance. **Note:** all five now carry the fixed D-059 bar — make sure you vendor the current versions (updated 2026-06-01), not stale copies.

---

## What this lane does (and the hard deferral)

Build each role's **home content** as a **role-scoped projection of the same business graph** — reusing the A1b shell. Two grammars:

- **Command grammar** (Sales · PM/Super · Admin): One Thing → On Deck → Pulse, role-specific content.
- **Execution grammar** (Field · Sub): Clock/Accept → Work Order → Checklist → Capture → Daily/Submit.

**✅ The bottom bar is now SETTLED — one fixed bar for every role (D-059, locked 2026-06-01):** `Home · Create · Speak · Camera · More`. Apply it uniformly to all five role homes. **No role-variant bars.** Role-specific actions (Field's Clock, Admin's Money/Sentry, Sub's Submit) live in **More + the home content**, not the bar — e.g., Field's Clock is the big primary action on the home surface itself, not a bar slot. **Create** is role-filtered in its *sheet* (field hand → daily-log/photo; owner → estimate/CO) but the slot label never changes. F-BC1 bottom-bar customization is deprecated.

These are **projections, not new domains** — no new Layer-A domains, no separate databases (architectural protection #1 + #2). Content is filtered by the **permission lattice** per role.

---

## Per role (content only)

- **F-FH1 Field Hand** — execution grammar, field-green. Three clock states: clocked-out (big "Clock into <job>") · clocked-in (work order + checklist + capture grid) · wrap-up (daily-as-clock-out gate, warm, with graceful escape). Bilingual (Inicio/Reloj/Foto/Más). **Adoption-first** (`feedback_adoption_first_dont_surveil_crew`): no surveillance framing; location is manager-side.
- **F-SA1 Sales** — command grammar, coral. One Thing (proposal to send) → On Deck (pipeline) → Pulse (pipeline by stage · win rate · aging).
- **F-PS1 PM/Super** — command grammar, two lenses (PM blue / Super cyan). One Thing → On Deck → Pulse with role content. *(F-PS1 is already the one wireframe vendored in-app — align to it.)*
- **F-AD3 Admin** — command grammar, magenta, **Sentry-forward** (compliance watch above the fold). One Thing = a risk/deadline → On Deck (open stacks: AR/AP · sub docs · POs · rebates · scheduling) → Pulse status board. Audit stays owner-private.
- **F-SUB1 Sub** — execution + company wrapper, muted gold. Accept WO/PO → schedule → required docs → capture → completion → payment → messages.

---

## Floor (Bar 2) — Sub isolation is the sharp edge

- **F-SUB1 is the tightest wall in the system.** An external party sees **only their own WO/PO/docs/payment/messages with this one tenant** — never margin, client comms, internal notes, other subs, project financials, or other tenants. Enforce via the tenant-scoped reader + permission lattice at its strictest. (This is exactly what Lane D's CI suite tests — coordinate: Lane D writes the adversarial test, Lane E must pass it.)
- All role content is **permission-lattice filtered** and **tenant-scoped**; no cross-role or cross-tenant leak.
- Operator vocabulary is plainspoken at the surface (translate canon terms).

## Bar 3

Each role home renders its correct content on a phone viewport with the generic bar; Field shows the right clock state for the clocked-in job; Sub shows only its own work with GGR and nothing else.

## Acceptance

- [ ] Five role homes render role-scoped content on the A1b shell; no new Layer-A domains introduced.
- [ ] Bottom bar is the fixed `Home · Create · Speak · Camera · More` on every role (D-059); role-specific actions live in More + home content.
- [ ] Permission-lattice filtering visible by absence (e.g., Field sees no pricing; Sub sees only its own tenant relationship).
- [ ] **F-SUB1 passes Lane D's isolation tests** — no margin / other-sub / cross-tenant leakage.
- [ ] Field home is adoption-first (no surveillance framing).
- [ ] `npm run typecheck` · `build:astro` · role-projection + isolation tests pass.

## Not this lane

- NOT role-variant bottom bars (deferred to D-046).
- NOT new domains or databases (projections only).
- NOT the camera, builders, daily-log, or overlay.

---

## Bar decision (settled)

**D-059 (locked 2026-06-01): one fixed bar — `Home · Create · Speak · Camera · More` — for all roles.** No variant bars, no customization. Apply uniformly; put role-specific actions in More + home content.

---

*Lane E · 2026-06-01. Same graph, role-scoped projections. Build the content now; the bars wait on D-046. Sub is the isolation test.*
