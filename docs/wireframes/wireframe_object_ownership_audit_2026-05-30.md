# Wireframe Object Ownership Audit

- **Date:** 2026-05-30
- **Scope:** 111 app-vendored canon files at `docs/wireframes/canon/F-*.html` (F-RH1 + F-FU1 vendored via #258 and added to the matrix)
- **Matrix:** `docs/wireframes/wireframe_object_ownership_matrix_2026-05-30.csv`
- **Status:** Architecture audit — revised pass. Adds the read/write-graph edge, intended write-gate, and verdict columns plus the 8-primitive model. This is an ownership map of **intended design**, not a visual-fidelity review and **not** runtime guard proof.

## 0. Why This Audit Exists

The question is no longer "do we have the right screens?"

The sharper question is:

> What atomic objects generate and connect these screens?

If the 109 surfaces are just a large screen inventory, Right Hand risks becoming conventional construction SaaS with voice on top. If the 109 surfaces are projections of a small object model, Right Hand becomes an operating system.

## 1. First Finding

The existing app-vendored canon is heavily weighted toward **business graph projections**, with fewer explicit Right Hand turn primitives than the product vision now requires.

| Primary owner object | Count |
|---|---:|
| BusinessGraphNode | 52 |
| AttentionArtifact | 24 |
| WorkArtifact | 13 |
| SourceEvidence | 8 |
| Decision | 4 |
| NavigationPrimitive | 4 |
| RoleView | 2 |
| SystemPolicy | 2 |
| Turn | 2 |

> Note: `NavigationPrimitive`, `RoleView`, and `SystemPolicy` in this column are **projections / enforcement edges**, not primitives (see §3). They are tallied here only because the first pass used them as owner labels.

That does **not** mean the wireframes are wrong. It means most existing surfaces are specialized views of durable business reality: projects, clients, money, schedule, people, procurement, sales, reports.

**Business-graph views are valid, not suspicious.** Projects, Clients, Money, Schedule, People, Procurement, Sales, and Reports legitimately need screens. The audit's job is not to delete them — it is to flag which ones risk becoming *generic contractor SaaS* (`inherited-SaaS-risk`) unless they connect back to a Turn, Work Artifact, Attention Artifact, or Decision.

The newer Right Hand product spine needs explicit surfaces/contracts for the conversational layer that sits above those graph views.

## 2. The Object Model The Audit Supports

The audit supports a two-center model:

| Center | What it means | Examples |
|---|---|---|
| **Business Graph** | What exists in the business | project, client, estimate, invoice, work order, selection, employee, schedule item, document |
| **Turn / Resolution Layer** | How work happens through Right Hand | voice turn, transcript, inferred intent, work artifact, attention artifact, next surface, source refs |

Cleaner phrasing:

```text
Business Graph = what exists
Turn / Resolution Packet = how work happens
Attention Artifact = what comes back to the person
Role View = how each person sees it
```

## 3. Core Primitive Set (8)

> **Primitives are objects. Gates are enforcement edges. Screens are projections.**

The wireframe set is evaluated against eight primitives:

1. **Turn**
2. **Resolution Packet**
3. **Work Artifact**
4. **Attention Artifact**
5. **Decision**
6. **Business Graph Node**
7. **Agent**
8. **Source / Evidence**

Deliberately **not** primitives — these are projections or enforcement edges over the eight:

- **Role View** — a *projection* (how each person sees the graph + attention).
- **Navigation / intent routers** — projections/chrome that route Turns to surfaces.
- **System Policy · Policy Gate · validators · permissions · consequence tier** — **enforcement edges.** They govern *transitions* between primitives (e.g., whether a `Decision` may become consequence, or whether a write is allowed). They are not objects the product is built from. Keeping them out of the primitive set is what stops the model from bloating.

The matrix maps each existing surface to its primary and secondary owner object, plus the read/write-graph edge and two verdict axes (`structure`, `needs_rh_thread`).

## 3.1 Boundary-Case Rubric Proof (10 screens)

A spot-classification skewed toward the *hard* cases — nav/chrome, settings, a role portal, a read-only reference, money, and an export — to prove the rubric survives more than the obvious center:

| Surface | primary object | writes_graph | intended_write_gate | structure | needs_rh_thread |
|---|---|---|---|---|---|
| F-E1 Field Capture | Turn | durable | parser | RH-primitive | no |
| F-B1 Decision Card | Decision | durable | policy_gate | RH-primitive | no |
| F-H1 Audit Detail | Source / Evidence | none | none | RH-primitive | no |
| F-D1 More Sidebar (nav/chrome) | Navigation | none | none | RH-primitive¹ | no |
| F-MN1 Money Home | Business Graph Node | money | money_guard | hybrid | yes |
| F-PV1 Proposal View | Work Artifact | external_send | send_guard | hybrid | yes |
| F-RP1 Reports Center | Work Artifact | export | operator_confirm | hybrid | yes |
| F-CL3 Clients List | Business Graph Node | draft | operator_confirm | graph-view | yes |
| F-SH1 Sub Home | Role View | draft | operator_confirm | graph-view | yes |
| F-SP1 Settings | System Policy | durable | policy_gate | graph-view | maybe |
| **F-RH1 Voice Overlay** | **Turn / Resolution Packet** | durable | parser → operator_confirm | RH-primitive | no — **MISSING from canon (drift)** |

¹ *Navigation* is a projection/edge at the object level (§3), but at the **structure** level a nav router is an RH operating-layer surface (it is how Turns reach screens), not a business-graph projection — hence `RH-primitive`. The two axes answer different questions: *what RH layer is this?* vs *what object does it own?*

The split axes resolve the Clients/Subs ambiguity cleanly: a clients list is a perfectly valid `graph-view` **and** `needs_rh_thread: yes` — its structural identity is not "inherited SaaS"; the risk is the missing thread, named on its own axis.

## 3.2 Invariants (executable)

The matrix is self-checking — `tests/wireframe-matrix-invariants.test.ts` enforces these on every CI run, so the taxonomy can't silently rot into prose:

```text
writes_graph != none         -> intended_write_gate != none
writes_graph = money         -> intended_write_gate = money_guard
writes_graph = external_send  -> intended_write_gate = send_guard
writes_graph = export        -> intended_write_gate in { operator_confirm, egress_guard }
writes_graph = durable       -> intended_write_gate in { parser, operator_confirm, policy_gate }
structure   = RH-primitive   -> needs_rh_thread = no
```

> **Caveat — design intent, not runtime proof.** `writes_graph` and `intended_write_gate` are the *intended* consequence class and the wall that *should* protect it, read from the wireframes. **Whether the running code enforces that gate is a separate code audit** (the tenant-isolation / guard CI lane), tracked per-row in `runtime_write_gate_verified` (every row `pending` or `n/a` today). `egress_guard` is a reserved future gate for data egress; today `export` rows use `operator_confirm`.

## 4. What The 111 Screens Are Doing

### Right Hand-native primitives already present

- Decision cards (`F-B1`, `F-B1b`, `F-B1c`, `F-B2`)
- Field Capture (`F-E1`)
- Transcript Review (`F-F1`)
- Draft Review (`F-G1`)
- Audit Detail / Audit Portfolio (`F-H1`, `F-AV1a/b`)
- Role-root home surfaces (`F-A1`, `F-C1`, `F-AO1`, etc.)
- Navigation/intent surfaces (`F-D1`, `F-S1`, `F-RR1`, `F-BC1`)

These are closest to the Right Hand operating layer: turn, decision, source evidence, attention, and role projection.

### Conventional-but-needed business graph projections

Most of the catalog is durable business graph:

- Projects: `F-PR*`, `F-PS1`, `F-PA*`
- Clients: `F-CL*`, `F-CA*`, `F-CS*`
- Money: `F-MN*`, `F-BK*`, `F-VC1`
- Sales/Marketing: `F-SL*`, `F-LD*`, `F-MK*`
- Team/Ops/People: `F-CR*`, `F-HR*`, `F-SB*`, `F-TO*`
- Procurement/Schedule/Reports/Warranty: `F-PU*`, `F-SC*`, `F-RP*`, `F-WW*`

These should not disappear. They become Right Hand-native when they are reached from a Turn, populated by Work Artifacts, ranked by Attention Artifacts, and protected by role/consequence gates.

## 5. Gap (RESOLVED): Newer Right Hand Surfaces Now Vendored

Two recent surfaces were built Canon-side but were missing from the app-vendored set. Both are **now vendored (#258) and added to the matrix** — the first enforcement of the drift rule below, applied one commit after it was created:

| Surface | Status | Why it matters |
|---|---|---|
| `F-RH1_mobile_right_hand_voice_overlay.html` | ✅ vendored (#258) | The live Right Hand voice overlay / conversation turn surface; central to the phone dogfood loop. |
| `F-FU1_mobile_field_updates_review.html` | ✅ vendored (#258) | Field Updates review for inbound crew/SMS evidence and filing disposition — the D-052 review surface. |

The catalog is now 111 surfaces, so the build team evaluates the phone loop against the same surfaces Christian reviews.

**This is drift, not cleanup.** A surface live in production but absent from app-vendored canon means the audit already trails production. Standing rule going forward:

> **No new production surface lands without a canon source or a vendored canon mirror.**

This parallels "no new screen without an owner object" (§7) and the repo's existing canon-drift-audit posture. It covers `F-RH1` (voice overlay, live on Fly v26) and `F-FU1` (field-updates / D-052 review surface).

## 6. Interpretation

The outside critique was mostly right:

> The 109 screens are secondary. The object model matters more.

But the atomic object is not only `Turn`. Right Hand has a durable business graph and a conversational resolution layer:

```text
Front Door
  -> Turn
  -> Resolution Packet
  -> Work Artifact
  -> Business Graph Node
  -> Attention Artifact
  -> Role View
```

The danger is not "too many wireframes." The danger is building wireframes as isolated SaaS screens instead of projections of those primitives.

## 7. Recommended Next Moves

1. **Lock the Turn Resolution Packet contract.**
   - This is the missing object that connects voice, agents, work artifacts, attention artifacts, and next surfaces.

2. **Mirror F-RH1 and F-FU1 into app-vendored canon.**
   - The phone loop should be audited against the live Right Hand surfaces, not only the older 109.

3. **Run this same ownership matrix during every new wireframe addition.**
   - No new screen should land without an owner object.

4. **Use the matrix to prune or merge future surfaces.**
   - If two screens share the same owner object, role, consequence tier, and attention behavior, they may be variants rather than separate product surfaces.

5. **Prioritize Right Hand-native primitives before broad surface expansion.**
   - Turn -> Resolution Packet -> Work Artifact -> Attention Artifact -> Decision is the phone spine.

6. **Do not remove business graph views.**
   - Projects, Clients, Money, Schedule, and People are still necessary. The change is that they should no longer be the product center of gravity.

## 8. How To Read The Matrix

Columns:

- `surface_id`: canonical wireframe ID
- `filename`: source HTML file
- `surface_name`: readable file-derived name
- `role_root`: likely role owner
- `primary_object`: object that owns the surface
- `secondary_object`: supporting object
- `screen_type`: projection family
- `turn_led`: whether the surface is directly part of a Right Hand turn
- `can_exist_without_projects`: whether the surface survives without projects
- `can_exist_without_turns`: whether the surface survives without the conversational layer
- `produces_work_artifact`: whether the surface creates or edits durable work
- `displays_attention_artifact`: whether the surface presents "what needs you"
- `decision_or_gate`: whether the surface includes a human decision/consequence gate
- `consequence_tier`: rough consequence class
- `reads_graph`: does the surface read from the business graph — `yes` / `no`
- `writes_graph`: strongest write the surface *intends* — `none` / `draft` / `durable` / `external_send` / `export` / `money`
- `intended_write_gate`: the wall that *should* protect that write — `none` / `parser` / `operator_confirm` / `policy_gate` / `money_guard` / `send_guard` / `egress_guard` (reserved, future). **Design intent; runtime enforcement is a separate code audit (§3.2).**
- `structure`: the screen's place in the RH model — `RH-primitive` / `graph-view` / `hybrid`
- `needs_rh_thread`: does it need a Right Hand thread to avoid going generic — `yes` / `no` / `maybe`
- `runtime_write_gate_verified`: has a code audit confirmed the gate is actually enforced — `pending` / `verified` / `n/a` (every row `pending` or `n/a` today)
- `notes`: product interpretation

This is a first-pass taxonomy, not a final schema. Its job is to reveal where the canon is Right Hand-native and where it is conventional business graph projection.

## 9. Bottom Line

The 109 wireframes are useful, but they are not the architecture.

The architecture is the object model that makes them coherent:

> Turn -> Resolution Packet -> Work Artifact -> Business Graph Node -> Attention Artifact -> Role View.

That is the center of gravity for Right Hand.
