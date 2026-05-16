# Two-Gate Release Structure — June 13 Internal Dogfood + July 13 Founder-Judgment

- **Date:** 2026-05-16
- **Author:** Claude (Agent 8, integration lead)
- **Status:** Canon decision. Formalizes the relationship between two release-shaped dates that were operating in parallel without a documented basis.

---

## 1. Why this doc exists

Two dates have been operating as "the milestone" in different conversations without a documented relationship:

- **July 13** — referenced in `claude_code_inventory_routing_memory_2026-05-12.md` as the "founder-judgment kill-switch" / external evaluation gate. Canon.
- **June 13** — referenced in `right_hand_home_module_drawer_2026-05-15.md` §8.1 as the "internal release" deadline. Traces to Christian's verbal "we have 1 month to get to full release 1.5" stated on 2026-05-14. **Not previously canonized.**

The 2026-05-16 amendment review flagged this. Either June 13 is a sub-milestone before July 13, or June 13 is a replacement, or one of them is wrong. This doc resolves the ambiguity.

**Resolution: two-gate structure. Both dates are canon. They serve different functions.**

---

## 2. The two gates

### 2.1 June 13, 2026 — Internal Release / Operator Dogfood Gate

**Purpose**: Kerf is operational-shape for Christian + his son to use on real GGR/Valle jobs day-to-day. No external operators, no marketing, no public launch. The system is *complete enough for the founders to live in it.*

**Scope of "complete enough":**

| Priority | Requirement for June 13 |
|---|---|
| 1. Persistence + operational memory | On `main`, working end-to-end through HTTP endpoints; events.jsonl + projection cache operational; tier-2 KB ingestion path functional |
| 2. Scope scaffolding | All 4 V1.5 archetypes (kitchen, bath, outdoor kitchen, deck) functional with inline-edit on lines |
| 3. Field Relay / Job Daily | Field Hand mobile surface (`/field` or `/m/field`) operational with HOME/JOB/LOG/ME nav; clock_event entry kind functional; relay-card surfaces on Right Hand side |
| 4. Proposal artifacts | Generate-from-decision endpoint operational; proposal list/detail surfaces functional; print-friendly render shippable; §7159 validator enforced on `accepted` |
| 5. Mobile operational usability | Mobile-validated baseline holds across all operator-facing routes; voice button persistent across all Field Hand tabs |

**Pass criteria**: Christian + son can capture daily updates from the field on a phone, route them to the office Right Hand, draft and send a proposal that passes §7159, watch the audit trail render, and close a real job through Kerf. End-to-end loop functions without operator workarounds.

**This is NOT a launch gate.** No external operators, no marketing, no pricing decisions. Just *Kerf works for its founder operators.*

---

### 2.2 July 13, 2026 — Founder-Judgment / External Evaluation Gate

**Purpose**: Christian evaluates whether Kerf is ready to invite external dogfood operators. Per `claude_code_inventory_routing_memory_2026-05-12.md`, this is the "founder-judgment kill-switch" — the operator-side decision whether the system has earned external use.

**Scope of "ready":**

| Dimension | What "ready" means at July 13 |
|---|---|
| **Substrate reliability** | 30 days of GGR/Valle internal dogfood without substrate failures, data loss, or §7159 violations slipping past the validator |
| **Trust-range demonstrated** | At minimum 2 closed projects (one full kitchen, one full bath) where Kerf's first-pass estimate landed inside the operator's trust range without frontier-model inference in the pricing path. Pulse-test methodology applied. |
| **Schema dimensions hardened** | The four dimensions surfaced by the Moorhead pulse test (`scope_inclusion`, `delivery_mode`, `markup_basis`, `business_unit_margin_pct`) implemented and tier-1 backfilled |
| **Tier-2 KB seeded** | Internal pricing v3 for at least 2 closed projects ingested as tier-2 actuals; tenant-memory rows operational |
| **Operator experience** | Field Hand mobile surface used as default daily capture tool by both founders; Right Hand surface used as default proposal-drafting tool |
| **No founder-judgment kill-switch fires** | Christian's explicit go/no-go on inviting external operators |

**Pass criteria**: Christian decides "the system has earned the right to be shown to other operators." Failure mode is *not* a hard miss — it's a discovered gap that triggers another iteration cycle before external invite.

---

## 3. The relationship between the two gates

**Sequential, not redundant.** June 13 is the gate that makes July 13 evaluable. Without operator dogfood between June 13 and July 13, there's no empirical basis for the July 13 judgment.

```
May 14 (today's anchor)
  │
  │  ~30 days
  │
  ▼
June 13 — Internal Release Gate
  │  Kerf is functional for founder operators.
  │
  │  ~30 days of real GGR/Valle dogfood
  │
  ▼
July 13 — Founder-Judgment Gate
     Christian evaluates whether external operators should be invited.
     Substrate + reliability + trust-range demonstrated against real
     project data accumulated during the 30-day internal phase.
```

The June 13 → July 13 month is **structured dogfood with diagnostic measurement**, not freeform use. Each closed project during that month runs through the pulse-test instrument. Each pulse-test run surfaces structural gaps. Each gap closure tightens the substrate. July 13's judgment is informed by ~2-4 pulse-tested projects' worth of evidence.

---

## 4. Why this structure (not a single-gate)

A single-gate model ("Kerf is ready on July 13, hand it to external operators") has a structural problem: it assumes the system is empirically validated when it's first handed to an external operator. That's the opposite of how trust gets earned.

The two-gate model:

1. **Lowers the cost of being wrong on June 13.** If Kerf isn't operational-shape on June 13, the only people affected are Christian + son. External operators aren't waiting. The team iterates against real friction without external commitment.
2. **Makes July 13 a measurement gate, not a guess gate.** By July 13, there's 30 days of internal use data, 2-4 pulse-test results, real proposals run through the validator on real jobs. The judgment is informed.
3. **Aligns with the "trust ladder" architecture.** Per the May 16 strategic discussion: persistence → knowledge → action → immutability → trust. Trust is earned through demonstrated reliability. June 13 → July 13 is the demonstration window.

---

## 5. What happens if June 13 misses

**Soft miss is fine, hard miss triggers re-plan.**

A "soft miss" on June 13 is partial operational-shape — e.g., proposal generation works but Field Hand mobile surface has rough edges. Christian + son use what works, work around what doesn't, document the friction, ship fixes through the next two weeks. July 13 still measures empirically.

A "hard miss" on June 13 is substrate failure — e.g., persistence layer dropping events, or §7159 validator slipping a violation past, or no functional Field Hand surface at all. That's a re-plan trigger. July 13's external-evaluation timeline gets pushed proportionally.

The kill-switch (rightness-over-date-pressure) applies to June 13 too. Don't ship the wrong thing because the calendar says ship.

---

## 6. What happens if July 13's judgment is no-go

The judgment is **Christian's, not the system's.** A no-go on July 13 means:

- Kerf continues internal dogfood
- Schema dimensions get hardened further
- Tier-2 KB depth increases
- The pulse-test cadence continues, surfacing remaining structural gaps
- Next external-invite candidate date is set based on the specific gap that triggered no-go

A no-go is **not failure**. It's the founder-judgment kill-switch doing its job: refusing to commit external operators to a system that hasn't earned their trust yet.

---

## 7. What this two-gate structure does NOT include

- A public launch date (post-July 13, separate decision)
- A pricing decision (Christian's 2026-05-16 note: "3-month intro rate or first-month free" direction; final pricing decided post-July 13)
- Operator-onboarding flow design (out of V1.5 scope per `field_daily_workflow_design_2026-05-15.md` §13)
- Multi-tenant support (D-025 places this 2027+)
- Investor-facing milestones (separate framing; do not derive from these gates)

---

## 8. Decision needed

This doc canonizes a decision Christian effectively made verbally on 2026-05-14 ("1 month to full release 1.5") that hadn't been documented in relation to the previously-locked July 13 founder-judgment gate. The decision being formalized:

- **June 13, 2026** = internal release / operator dogfood gate (NEW canon)
- **July 13, 2026** = founder-judgment / external evaluation gate (PREVIOUSLY locked; reaffirmed)
- The two are **sequential and complementary**, not redundant or competing

Codex review when back can ratify, refine, or push back.

---

## 9. Provenance

Authored during the 2026-05-16 working session after the amendment review flagged June 13's lack of canon basis. The flag was correct; the relationship to July 13 needed formalizing; this doc closes the gap.

Sibling doc: `slice_window_transition_2026-05-15.md` (the slice closure documentation; same canon-cleanup batch).
