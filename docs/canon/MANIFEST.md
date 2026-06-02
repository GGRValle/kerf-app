# kerf-app canon bundle · 2026-06-01

Everything the active build lanes reference, vendored for kerf-app so agents read from the repo they build in (per D-057 / Step 0). **Source of truth stays kerf-cos** `_docs/`; this is a working copy.

## How to use

Drop this whole folder into kerf-app and commit:

```bash
cp -R kerf-app-canon ~/code/kerf-app/docs/canon
cd ~/code/kerf-app && git add docs/canon && git commit -m "Vendor canon bundle (wireframes + briefs + contracts) for build lanes"
```

Then point each lane's agent at `docs/canon/`. Read wireframes in **Annotated** view (the spec side-rails carry the build intent). **Rule:** wireframe wins on layout/behavior; brief wins on floor/safety/acceptance.

## What each lane needs

| Lane | Agent | Brief | Wireframe(s) | Contract(s) |
|---|---|---|---|---|
| **A · Camera** | Codex | `briefs/RightHand_CAM1_Build_Packet` | `wireframes/F-CAM1`, `F-RC1` (LiDAR, separate) | — |
| **B · Job-note** | Cursor (done) | `briefs/RightHand_LaneB_JobNote_Component` | rendering in `F-DL1`, `F-CAM1`, `F-RH3`, `F-FU1` | — |
| **C · Builders** | Cursor | `briefs/RightHand_LaneC_Builders` | `wireframes/F-CHG1`, `F-EST1` (+ `F-PV1` signed→contract) | `contracts/RightHand_Estimate_Contract_and_Consult_v1` (`line_type`) |
| **D · Isolation CI** | Cursor (done) | `briefs/RightHand_Tenant_Isolation_CI_Suite` | — | `contracts/RightHand_Storage_Learning_Isolation_Canon` |
| **E · Role homes** | Cursor | `briefs/RightHand_LaneE_RoleHomes` | `F-A1b`(shell), `F-FH1`, `F-SA1`, `F-PS1`, `F-AD3`, `F-SUB1` | `contracts/D-059-bottom-bar-slot-population` (fixed bar) |
| **Overlay rebuild** | Claude Code | `briefs/RightHand_v47_TestDrive_Defects_and_Fix_Directive` + `RightHand_ModelLed_Persistent_Response_and_JobNote_Artifacts` | `F-RH3` | `briefs/RightHand_Stage4_Consequence_Bubble_Spec` (stage-4), `RightHand_Overlay_One_Surface_Directive` |

## Read-first

- `briefs/RightHand_Build_Orientation_2026-06-01.md` — the one acceptance target, Step 0 (vendor + one-worktree-per-lane), reading order, fit snapshot.

## Locks baked in (don't re-litigate)

- **Bottom bar (D-059):** one fixed bar for every role — `Home · Create · Speak · Camera · More`. No variant bars, no customization. Role specifics live in More + home content.
- **Money:** integer **cents** everywhere; margin never a client-visible line.
- **Overlay:** one persistent blurred surface; Stop appends in place; confirm only at the consequence point (`F-RH3` / stage-4 spec).
- **Camera:** V1 shell (job gate · Walkthru/Photo/Scan · consistent Done · no orphans) before V1.1 cold-understanding (synthesis).

---

*Bundle 2026-06-01. Working copy for kerf-app; kerf-cos `_docs/` remains source of truth. When canon changes there, re-vendor the changed file here.*
