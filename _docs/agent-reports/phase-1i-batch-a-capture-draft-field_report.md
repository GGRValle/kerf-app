# Phase 1I · Batch A — Capture → Draft Field Loop

**Agent:** A (Phase 1I)  
**Branch:** `phase-1i-batch-a-capture-draft-field`  
**Repo:** `GGRValle/kerf-app`  
**Status:** Pre-merge fix applied · pushed · **not merged**

---

## Pre-merge fix (2026-05-28)

### 1. Status copy — raw i18n keys → resolved strings

Client scripts on review surfaces previously passed i18n **key strings** through `define:vars` (`savedKey: 'review.draft.saved'`), so status elements showed literal keys.

**Fix:** resolve in Astro frontmatter via `t()`, pass a `copy` object through `define:vars`, reference `copy.saved` / `copy.error` in scripts.

| Surface | File |
|---------|------|
| Draft review | `src/app/pages/draft-review/[draft_id].astro` |
| Transcript review | `src/app/pages/transcript-review.astro` |
| Field detail override | `src/app/pages/field-detail.astro` |

Added `f_fd.override.reason_required` for empty-reason validation (distinct from API error).

### 2. Phase 1H draft route alignment

Phase 1H `POST …/synthesize-draft` returns `redirect_to: /draft-review/:draft_id`.

| Route | Behavior |
|-------|----------|
| `/draft-review` | Redirects to `/draft-review/prop_lane23_wegrzyn` (fixture Preview) |
| `/draft-review/:draft_id` | Dynamic route · fixture draft for `prop_lane23_wegrzyn` · not-found card + link to fixture Preview for unknown ids |
| F-E1 post-submit loop | `Draft review (Preview) →` → `/draft-review/prop_lane23_wegrzyn` |
| Transcript continue CTA | `/draft-review/prop_lane23_wegrzyn` |

`LANE23_FIXTURE_DRAFT_ID` exported from `lane23Fixtures.ts`.

---

## Loop wiring (unchanged from e1dd52f)

Capture → transcript → draft → preview → send gate (Preview labels · no autonomous send).

---

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | (see commit) |
| `npm run build:astro` | (see commit) |
| `tests/phase1i-capture-draft-loop.test.ts` | 9 tests |
| Full `npm test` | (see commit) |

---

## Out of scope

- Merge / deploy — not performed.
- Model-led `proposal.drafted` endpoint — still Preview until backend ships.

---

## PR

https://github.com/GGRValle/kerf-app/compare/main...phase-1i-batch-a-capture-draft-field
