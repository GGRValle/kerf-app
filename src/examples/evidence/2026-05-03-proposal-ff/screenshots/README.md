# Proposal F&F screenshots — capture target directory

This directory holds the operator-captured PNGs referenced as placeholders in
[`../PROOF_PACKET.md`](../PROOF_PACKET.md) §8. It is committed (with this README)
so the path resolves before any image lands; the markdown placeholders in
PROOF_PACKET.md §8 will continue to render as "broken image" links until the
matching files exist here.

**Do not edit PROOF_PACKET.md when capturing.** Just drop the PNGs into this
directory under the exact filenames below; PROOF_PACKET.md §8 already links to
them.

## Capture conventions

- **Zoom:** capture at **100%** browser zoom (not Retina-scaled UI zoom that
  shrinks or enlarges page content).
- **Viewport:** window (or devtools responsive) width **at least 1280px** so
  the Standard UI shell lays out as intended: main column with **queue + proposal
  detail** side by side, plus the **action log** right rail — confirm all three
  are visible before you capture.
- **Format:** PNG (lossless; matches the W1 packet under
  [`../../2026-05-02-w1/screenshots/`](../../2026-05-02-w1/screenshots/)).
- **Browser:** the same desktop browser the demo runbook recommends (Safari, or
  any modern desktop browser pointed at `npm run demo:w1-queue:serve`).
- **Window scope:** capture the demo browser window or the relevant region of
  it — full-screen captures with unrelated chrome (other tabs, dock, mail
  badges) are noise.
- **No annotations:** no arrows, no boxes, no overlays. The PROOF_PACKET text
  carries the narrative.
- **No personal data:** seeded fixtures only. The demo is local and uses
  generated client names; nothing real should appear.

## Filename → intent (mirrors PROOF_PACKET.md §8.1)

| File | Intent |
|---|---|
| `01-proposal-filter.png` | Proposal filter active; queue shows only the four seeded proposal cards. |
| `02-proposal-detail-panel.png` | Proposal detail / review panel open with drafted follow-up visible. |
| `03-proposal-approve.png` | Right after **Approve** click; action log shows the new `approve` line for that `packet_id`. |
| `04-proposal-edit.png` | Right after **Edit** click on a different proposal; action log shows the new `edit` line. |
| `05-proposal-reject.png` | After **Reject** + reason form **Submit**; action log shows the new `reject` line. |
| `06-proposal-action-log.png` | Action log rail showing approve / reject / edit lines together (one continuous session preferred). |

## After capture

1. Drop the six PNGs into this directory under the exact filenames above.
2. `git status` should show six new untracked image files plus this README.
3. Commit on a docs/* branch and open a PR; PROOF_PACKET.md §8 placeholders
   will render the images automatically.
