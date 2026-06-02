# D-059 · Bottom-Bar Slot Population — role-root defaults vs. global default

**Status:** **LOCKED** — founder-decided 2026-06-01 · **Option A (fixed bar) chosen**, moving away from the role-variant direction
**Date:** 2026-06-01
**Amends:** D-046 §C2 (Mobile Bottom Bar Canon) — fixes all five slots; removes the "user-defined" + "context-aware" variability for the bottom bar
**Decision owner:** Christian

---

## DECISION (ratified 2026-06-01)

**One fixed bottom bar for every role:**

```
[ Home ]   [ Create ]   [ Speak / mic FAB ]   [ Camera ]   [ More ]
```

- **All five slots are fixed.** No role-variant bars, no per-user bottom-bar customization.
- **Create** (slot 2) and **Camera** (slot 4) are constant across all roles. Create is role-filtered in its *sheet* (a field hand's Create shows daily-log/photo; an owner's shows estimate/CO) — but the bar slot itself never changes.
- **Everything role-specific lives in More** (and on the home surface itself). A field hand's Clock is the primary action on his *home* (the big "Clock into <job>"), not a bar slot; Admin's Money/Sentry, Sub's Submit, etc. live in More + home content.
- **F-BC1 (bottom-bar customization) is deprecated** by this decision — there's nothing to customize. (Recommend archiving F-BC1; "Customize navigation" in Settings, if kept, governs sidebar/More ordering only, not the bar.)

**Founder rationale (in his words):** the role-variant slots were an exploration — "trying to see what would fit in those two slots" and giving users the ability to rearrange. After using the system live, a **consistent Create + Camera five-bar** was clearly better; uniformity is more learnable, and role differences belong in More and the home content, not the bar.

**This supersedes the Option B recommendation below.** The options analysis is retained as the record of the choice.
**Unblocks:** Lane E role-home bars · the bar-consistency pass across ~39 older surfaces · F-BC1 customization defaults · F-RR1 routing matrix

---

## Why this exists

D-046 §C2 already set the bar **structure**: five slots, **3 mandatory + 2 variable**.

```
[ Home ]   [ slot 2 ]   [ Speak / mic FAB ]   [ slot 4 ]   [ More ]
 mandatory  variable      mandatory             variable    mandatory
            (user-defined)                       (context-aware)
```

What D-046 did **not** settle is **how the two variable slots get populated by default.** That's the open item we've been calling "the D-046 call." It's now load-bearing because:

- the six new role-home wireframes each ship a **different** bar (Owner `Create/Camera`, Field `Clock/Foto`, Admin `Money/Sentry`, Sub `Submit/Docs`, Sales `Create/Scan`),
- ~39 older surfaces still show the pre-D-046 fixed `Home · Speak · More + 2 swap` bar,
- Lane E (role homes) is briefed to **defer** the bar until this is decided,
- and F-BC1 (bar customization) needs to know what the *default* is before a user customizes it.

One decision squares all of it.

---

## The question

**Do the two variable slots default the same for everyone (and users customize), or do they default by role-root (and users still customize)?**

---

## Options

### Option A · Global default + user-customizes
Everyone starts with one bar — e.g. `Home · Create · Speak · Camera · More`. Any user can swap slots 2/4 via F-BC1.
- ➕ Simplest to build and reason about; one bar in the system.
- ➕ No role-detection logic in the bar.
- ➖ Forces the wrong default on most roles. A field hand's primary action is **Clock**, not Create; an admin's is **Money/Sentry**, not Camera. Every non-owner has to customize on day one to get a sane bar.
- ➖ Undercuts the three-layer thesis (role roots are projections of the same graph — the bar is part of that projection).

### Option B · Role-root default + user-customizes  ★ recommended
The two variable slots **default by role-root**; the user can still override via F-BC1.
- Owner — `Home · Create · Speak · Camera · More`
- Field Hand — `Home · Clock · Speak · Foto · More` (bilingual)
- Sales — `Home · Create · Speak · Scan · More`
- PM / Super — `Home · Schedule · Speak · Camera · More`
- Admin — `Home · Money · Speak · Sentry · More`
- Sub — `Home · Submit · Speak · Docs · More`
- ➕ The right default per role — lowest friction, matches what each role actually does first.
- ➕ Consistent with the Operating Model Canon (role roots are projections) and the six wireframes already built.
- ➕ Honors D-046 §C2: slot 2 is the user-defined override; slot 4 is the context-aware one. Role is simply the first context.
- ➕ F-BC1 already exists as the override valve, so nobody's locked in.
- ➖ More to build/maintain: a per-role `barConfig`. (Lane E already stubbed the seam, so this is incremental, not a rebuild.)

### Option C · Fully dynamic / context-aware slots
Slots change live by screen/state, not just role.
- ➖ Most complex; hard to learn (the bar moves under you). Defer to V2+. Slot 4's "context-aware" behavior can grow toward this *later* without reopening this decision.

---

## Recommendation

**Option B — role-root defaults + user customization.** It's the only option where every role gets a sane bar out of the box, it matches the wireframes and the role-projection architecture, and it keeps D-046 §C2's structure intact (mandatory Home/Speak/More; slot 2 user-overridable; slot 4 context-aware, seeded by role). F-BC1 handles the exceptions. The build cost is a per-role config table, which Lane E already left a seam for.

**Practically, if ratified:**
- Lane E wires the per-role default bars into its `barConfig` seam (no content rework).
- The ~39 older surfaces get their bar swapped to the role-appropriate default in the consistency pass.
- F-BC1's "reset to default" means *reset to the role default*, not a global one.
- F-RR1 (routing matrix) records the per-role bar as canon.

---

## What's still mandatory regardless (unchanged from D-046 §C2)

Home (slot 1) · Speak/mic FAB (slot 3) · More (slot 5) never move. Only slots 2 and 4 vary. The mic FAB stays the elevated center on every role.

---

## Open sub-questions (resolve on ratification, not blockers)

1. **PM vs. Super** — do they share one default bar, or split (PM `Schedule`, Super `Crew`)? (F-PS1 carries both lenses today.)
2. **Slot 4 "context-aware"** — for V1, does it stay a fixed role default (simplest), or already shift within a role (e.g., Owner's slot 4 = Camera normally, Scan when inside an estimate)? Recommend **fixed role default for V1**, grow contextual later (keeps Option C's door open).
3. **Sub** — slot 4 `Docs` vs `Camera` (sub portal is document-heavy). Lean `Docs`.

---

## Decision

**Ratified: Option A — one fixed bar `Home · Create · Speak · Camera · More` for all roles** (see DECISION block at top). The three sub-questions are moot (no role-variant slots to resolve).

## Propagation (on this lock)

1. **Role-home wireframes** — F-FH1, F-AD3, F-SUB1, F-PS1 update their bars to the fixed five (F-A1b and F-SA1 already conform). Role-specific actions move to home content + More.
2. **Lane E brief** — bar is no longer "deferred pending D-046"; apply the fixed bar uniformly. The `barConfig` seam becomes a constant.
3. **~39 older surfaces** — swap to the fixed bar in the consistency pass.
4. **F-BC1** — archive (bottom-bar customization deprecated).
5. **F-RR1 routing matrix** — record the bar as uniform; role differences live in sidebar/More + home content, not the bar.

---

*D-059 · 2026-06-01 · amends D-046 §C2. **LOCKED: one fixed bar — Home · Create · Speak · Camera · More — for every role.** Role differences live in More and home content, not the bar.*
