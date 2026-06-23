# DISPATCH → Review Routing Split · Capture Review is not one bucket

**Sprint:** Mobile Field Truth. **Depends on:** PR #414 sync-state grammar + #415/#416 durable store + upload engine. **Builds:** the Camera route sheet + the office/blocker surfaces.

## Problem
The current Camera option "Review later" is too vague. It sends captures to `/relay` / office review without enough context, which creates useless work: "here's a picture" with no reason, no owner, and no next action.

Replace "Review later" with three field-real intents:

1. Sort later
2. Send to office
3. Flag a problem

## Canon Rule
A capture can be saved without context only when it stays with the operator.
Anything sent to another person must include a reason.

## Build

### 1. Sort Later
Use when the operator wants to keep the capture but decide later.

- No reason required.
- No office/PM queue.
- Destination: operator's `Recent Proof / Unfiled`.
- State: `needs_attention` or `saved_on_phone`, depending on sync state.
- Copy: "Saved to sort later."

### 2. Send To Office
Use when office/PM should decide what to do.

- Reason required before submit.
- Reason prompt: "What should the office do with this?"
- Destination: Office Inbox.
- State: `office_review`.
- Copy: "Sent to office with context."
- Reject if reason is empty.

### 3. Flag A Problem
Use when the capture represents a blocker, issue, or urgent field condition.

- Reason required before submit.
- Reason prompt: "What's wrong or blocked?"
- Destination: attention/blocker queue.
- State: `needs_attention`.
- Copy: "Flagged for review."
- Reject if reason is empty.

## UI
On Camera Done route sheet, replace "Review later" with:

- Existing job
- New lead
- Sort later
- Send to office
- Flag a problem

For `Send to office` and `Flag a problem`, show a small required text field before Confirm:
- "Add context"
- placeholder examples:
  - "Need PM to decide where this belongs"
  - "Tile delivery is wrong"
  - "Client asked for this change"

Do not use internal labels like Relay, review queue, artifact, capture-sync, or field update.

## Server / Data
Do not mint office-review or blocker records without a reason.

Minimum payload:
- capture_session_id
- capture_item_ids
- route_intent
- reason/context
- destination kind
- tenant/user from server principal only

## Acceptance
- Sort later works with no note and lands in Recent Proof / Unfiled.
- Send to office requires a reason and lands in Office Inbox.
- Flag a problem requires a reason and lands in attention/blocker queue.
- Empty reason cannot be submitted for another person's queue.
- No capture disappears.
- No capture claims synced without server receipt.
- Operator copy uses field language only.

---

## Gate / grammar note (Claude Code · 2026-06-23)

One architectural point from the sync-state grammar seat — it keeps the badge honest after routing.

**`office_review` is a routing DISPOSITION, not a sync-safety state. Keep the two axes separate.**

The sync-state grammar (`src/app/lib/captureSyncState.ts` / `CaptureSyncBadge`) answers exactly one question: *is this capture safe?* — `captured → saved_on_phone → syncing → synced` (+ `failed`). That badge must keep answering it even after the capture is routed.

The route intent (Sort later / Existing job / New lead / Send to office / Flag a problem) is a **different axis**: *where did it go and what's its workflow status?* A capture can be `Synced` (safe on the server) **and** sitting in the Office Inbox at the same time — both are true, and the operator needs both signals.

So, implementation-wise:
- **Do NOT add `office_review` to the sync-state grammar or the sync badge.** Model the destination as a separate **disposition** value (e.g. `unfiled` / `filed_to_job` / `new_lead` / `office_inbox` / `flagged`), rendered as its own tag. The sync badge stays "is it safe?"; the disposition tag says "where it is." Conflating them would hide the safety signal behind a workflow label.
- `needs_attention` already exists in the sync grammar ("a decision is pending"). Reusing it for *Sort later* / *Flag a problem* is fine as the catch-all, but **who must act** (operator vs office) is a disposition concern — let the disposition carry it, not the sync state.
- The **context-required canon rule** is the real trust line here, and it has the same shape as the durable-store read-back gate and `authorizeCaptureUploadDestination`: the **server** refuses to mint any office/blocker record when the reason is empty — client-side validation is UX only, never the gate. I'll gate that exactly the same way (a rejected-empty-reason request must create no office/blocker record).

Net: build the three intents + the context gate as specced; just keep `office_review` off the *sync* axis and on its own disposition axis. Everything else in the dispatch stands.

— Gate/grammar seat, over the founder's dispatch.
