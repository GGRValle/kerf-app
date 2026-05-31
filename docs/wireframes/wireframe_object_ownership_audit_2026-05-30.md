# Wireframe Object Ownership Audit

- **Date:** 2026-05-30
- **Scope:** 109 app-vendored canon files at `docs/wireframes/canon/F-*.html`
- **Matrix:** `docs/wireframes/wireframe_object_ownership_matrix_2026-05-30.csv`
- **Status:** First-pass architecture audit. This is an ownership map, not a visual-fidelity review.

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

That does **not** mean the wireframes are wrong. It means most existing surfaces are specialized views of durable business reality: projects, clients, money, schedule, people, procurement, sales, reports.

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

## 3. Core Primitive Set

The wireframe set should be evaluated against these primitives:

1. **Turn**
2. **Resolution Packet**
3. **Work Artifact**
4. **Attention Artifact**
5. **Decision**
6. **Business Graph Node**
7. **Agent**
8. **Source / Evidence**
9. **Role View**
10. **System Policy**

The matrix maps each existing surface to its primary and secondary owner object.

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
- `notes`: product interpretation

This is a first-pass taxonomy, not a final schema. Its job is to reveal where the canon is Right Hand-native and where it is conventional business graph projection.

## 9. Bottom Line

The 109 wireframes are useful, but they are not the architecture.

The architecture is the object model that makes them coherent:

> Turn -> Resolution Packet -> Work Artifact -> Business Graph Node -> Attention Artifact -> Role View.

That is the center of gravity for Right Hand.
