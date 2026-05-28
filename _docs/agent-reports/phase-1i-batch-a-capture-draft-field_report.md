# Phase 1I · Batch A — Capture → Draft Field Loop

**Agent:** A (Phase 1I)  
**Branch:** `phase-1i-batch-a-capture-draft-field`  
**Repo:** `GGRValle/kerf-app`  
**Status:** Stacked on Batch D · pushed · **not merged**

---

## Branch lineage

| Field | Value |
|-------|-------|
| **Branch type** | **Stacked** on `origin/phase-1i-batch-d-schedule-reports-settings-shell` |
| **Stack base SHA** | `578769cec5ffc854aebf5c366af73a724aa7cc61` |
| **Head SHA** | `16e7630c2e26ee86e329c77b1cc3e33601f96b54f` |
| **Original main base** | `d06815a1263eb21dddcb50d6a61c7500520af0d4` |

Rebased with `git rebase --onto 578769c d06815a`. i18n conflicts resolved **union-both**: all Batch D/B shell/project/relay keys + all Batch A capture/draft/review keys (506 total · 506 en · 506 es).

---

## Scope

F-E1 Field Capture · Field Detail · Room Capture · Transcript Review · Draft Review · capture-origin panels on proposal preview.

**Hard boundary respected:** no edits to global nav, `Layout.astro`, API router shell, or project tab components.

---

## Files changed (vs stack base `578769c`)

| File | Purpose |
|------|---------|
| `src/api/routes/review.ts` | Draft accept/reject + field-detail override APIs |
| `src/app/components/PhaseStrip.astro` | Optional `href` on phase chips |
| `src/app/lib/lane23Fixtures.ts` | `LANE23_FIXTURE_DRAFT_ID` |
| `src/app/lib/lane6Fixtures.ts` | `prop_lane23_wegrzyn` for preview route |
| `src/app/pages/draft-review.astro` | Redirect → `/draft-review/:draft_id` |
| `src/app/pages/draft-review/[draft_id].astro` | Draft review UI + accept/reject |
| `src/app/pages/field-capture.astro` | Post-submit loop links + submit chain |
| `src/app/pages/field-detail.astro` | Override API + transcript deeplink |
| `src/app/pages/room-capture.astro` | Preview labels on stub actions |
| `src/app/pages/transcript-review.astro` | Corrections + continue-to-draft |
| `src/app/pages/proposals/[id]/preview.astro` | Send-gate CTA + capture-origin |
| `src/app/styles/lane23.css` | Loop action styles |
| `src/i18n/en.ts` · `es.ts` · `keys.ts` | Union D + A keys (506) |
| `tests/phase1i-capture-draft-loop.test.ts` | Loop + API + copy-pattern guards |
| `_docs/agent-reports/phase-1i-batch-a-capture-draft-field_report.md` | This report |

---

## Shared files touched

| Shared file | Change |
|-------------|--------|
| `PhaseStrip.astro` | Loop `href` only |
| `src/i18n/en.ts` · `es.ts` · `keys.ts` | Union Batch D + Batch A (required) |
| `src/api/routes/review.ts` | New review routes |

**Not touched:** `Layout.astro`, `nav.ts`, router shell, project tab Astro pages.

---

## Surface readiness

| Surface | Route | Dead primary buttons | Loop wired |
|---------|-------|----------------------|------------|
| Field capture | `/field-capture` | **0** | Post-submit transcript · draft (Preview) · field detail |
| Field detail | `/field-detail` | **0** | Transcript deeplink · audit |
| Room capture | `/room-capture` | **0** | Project link; Re-scan/Save = Preview stubs (non-primary) |
| Transcript review | `/transcript-review` | **0** | PhaseStrip + fixture draft href |
| Draft review | `/draft-review` → `/draft-review/:id` | **0** | Accept/reject/preview + resolved status copy |
| Proposal preview | `/proposals/:id/preview` | **0** | Capture-origin · send-gate CTA |

**Dead primary buttons (Batch A scope): 0**

---

## Clean-worktree verification

Fresh detached checkout at pushed tip (not agent dirty workspace):

```bash
git worktree add --detach /tmp/kerf-batch-a-stacked origin/phase-1i-batch-a-capture-draft-field
cd /tmp/kerf-batch-a-stacked
npm ci --ignore-scripts
npm run typecheck          # PASS
npm run build:astro        # PASS
node --import tsx --test tests/phase1i-capture-draft-loop.test.ts  # 9/9 PASS
```

| Check | Result |
|-------|--------|
| Verified SHA | `16e7630c2e26ee86e329c77b1cc3e33601f96b54f` |
| Stack base | `578769c` (Batch D) |
| `npm run typecheck` | **PASS** |
| `npm run build:astro` | **PASS** |
| `tests/phase1i-capture-draft-loop.test.ts` | **9/9 PASS** |
| i18n parity | **506/506/506** keys · en · es |

---

## Deferred

- Model-led `proposal.drafted` from capture (Preview until backend)
- **Merge** — not performed

---

## PR

https://github.com/GGRValle/kerf-app/compare/phase-1i-batch-d-schedule-reports-settings-shell...phase-1i-batch-a-capture-draft-field
