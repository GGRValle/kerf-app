# Wireframe Object Ownership Audit

- **Date:** 2026-05-30
- **Scope:** 109 app-vendored canon files at `docs/wireframes/canon/F-*.html`
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
| SourceEvidence | 7 |
| Decision | 4 |
| NavigationPrimitive | 4 |
| RoleView | 2 |
| SystemPolicy | 2 |
| Turn | 1 |

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

The matrix maps each existing surface to its primary and secondary owner object, plus the read/write-graph edge and a verdict.

## 3.1 Ten-Screen Rubric Proof

A spot-classification across families, to lock the column logic before reading all 109:

| Surface | primary object | reads_graph | writes_graph | intended_write_gate | verdict |
|---|---|---|---|---|---|
| F-E1 Field Capture | Turn | yes | durable | parser | RH-primitive |
| F-G1 Draft Review | Work Artifact | yes | durable | operator_confirm | RH-primitive |
| F-B1 Decision Card | Decision | yes | durable | policy_gate | RH-primitive |
| F-MN1 Money Home | Business Graph Node | yes | money | money_guard | hybrid |
| F-CL3 Clients List | Business Graph Node | yes | draft | operator_confirm | inherited-SaaS-risk |
| F-PR2 Project Detail | Business Graph Node | yes | draft | operator_confirm | graph-view |
| F-PV1 Proposal View | Work Artifact | yes | external | send_guard | hybrid |
| F-H1 Audit Detail | Source / Evidence | yes | none | none | RH-primitive |
| F-S1 Start Action Sheet | nav/intent router | no | none | none | RH-primitive |
| **F-RH1 Voice Overlay** | **Turn / Resolution Packet** | yes | durable | parser → operator_confirm | **MISSING from app-vendored canon — must be mirrored** |

`F-RH1` is the live Right Hand voice overlay (deployed on Fly v26) but is **not** in the app-vendored 109-file canon. It is the most Turn-native surface in the product and must be mirrored into canon so the build is audited against it.

> **Caveat — design classification, not runtime proof.** `reads_graph`, `writes_graph`, and especially `intended_write_gate` are the *intended* design edges read from the wireframes. They name which wall *should* protect each write (`parser`, `operator_confirm`, `policy_gate`, `money_guard`, `send_guard`). **Verifying that the running code actually enforces those gates is a separate code audit** — the tenant-isolation / guard CI lane — not this wireframe pass.

## 4. What The 109 Screens Are Doing

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

## 5. Gap: Newer Right Hand Surfaces Are Missing From App-Vendored Canon

Two recent surfaces discussed/built in the Canon-side work are not present in this app-vendored 109-file set:

| Missing surface | Why it matters |
|---|---|
| `F-RH1_mobile_right_hand_voice_overlay.html` | The live Right Hand voice overlay / conversation turn surface. This is now central to the phone dogfood loop. |
| `F-FU1_mobile_field_updates_review.html` | Field Updates review for inbound crew/SMS evidence and filing disposition. This is the D-052 review surface. |

This is not a runtime blocker, but it is a canon synchronization problem. The app's wireframe catalog should be updated so the build team evaluates the phone loop against the same surfaces Christian is reviewing.

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
- `writes_graph`: strongest write the surface *intends* — `none` / `draft` / `durable` / `external` / `money`
- `intended_write_gate`: the wall that *should* protect that write — `none` / `parser` / `operator_confirm` / `policy_gate` / `money_guard` / `send_guard`. **Design intent; runtime enforcement is a separate code audit (§3.1 caveat).**
- `verdict`: `RH-primitive` / `graph-view` / `hybrid` / `inherited-SaaS-risk`
- `notes`: product interpretation

This is a first-pass taxonomy, not a final schema. Its job is to reveal where the canon is Right Hand-native and where it is conventional business graph projection.

## 9. Bottom Line

The 109 wireframes are useful, but they are not the architecture.

The architecture is the object model that makes them coherent:

> Turn -> Resolution Packet -> Work Artifact -> Business Graph Node -> Attention Artifact -> Role View.

That is the center of gravity for Right Hand.
