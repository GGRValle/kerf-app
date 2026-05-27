# Phase 1G-C · Mobile Chrome + Plain Language · Agent Report

**Branch:** `phase-1g-c-mobile-chrome-language`  
**Repo:** `GGRValle/kerf-app`  
**Base:** `origin/main` @ `af80203` (post-PR #235 F-E1 capture clarity hotfix)  
**Head:** `15f31a1`  
**Date:** 2026-05-27  
**Agent:** Cursor Composer 2.5 (Lane C)  
**PR:** Not opened (awaiting Christian)

---

## Summary

UI/copy/chrome-only pass: cleaner mobile top-nav behavior, plain-English operator strings on active surfaces, relay list copy aligned with Right Hand positioning. No API, persistence, event contract, or send-gate logic changes. **`field-capture.astro` not modified** (1G-A transcribe/media lane constraint).

---

## Surfaces touched

| Area | Files |
|------|--------|
| Shell / nav | `src/app/layouts/Layout.astro`, `src/app/styles/shell.css`, `src/app/components/SpeakFAB.astro` |
| i18n | `src/i18n/en.ts`, `src/i18n/es.ts`, `src/i18n/keys.ts` |
| Relay | `src/app/pages/relay/index.astro` |
| Route placeholders | `src/app/components/RouteShellPage.astro`, `src/app/pages/index.astro` |
| Projects / audit display | `src/app/pages/projects/[id]/index.astro`, `src/app/components/ProjectAuditPanel.astro` |
| Proposal send (copy only) | `src/app/pages/proposals/[id]/send.astro` |
| Field-adjacent | `src/app/pages/room-capture.astro`, `src/app/pages/field-detail.astro`, `src/app/pages/role-routing.astro` |
| Utilities | `src/app/lib/formatOperatorLabel.ts` |
| Tests | `tests/phase1g-c-plain-language.test.ts`, `tests/v15-relay-surface.test.ts`, `tests/phase1d-audit-projection.test.ts` |

---

## Before / after copy (representative)

| Location | Before | After |
|----------|--------|-------|
| Transcript review notice | `Corrections emit transcript.reviewed + correction.classified…` | `Your correction is saved before Kerf treats it as final.` |
| Draft review notice | `…Edits emit proposal.edited + correction.classified.` | `…Your edit is recorded as a correction.` |
| Nav | `Transcript Review` / `Cost KB` | `Transcripts` / `Cost library` |
| Scope chips | `plumbing_fixtures` | `Plumbing fixtures` (raw id in `title` tooltip) |
| Audit event labels | `Send gate` / `Classification` | `Send check` / `Learning recorded` |
| F-PV2 | `Validator wall · explicit operator tap` | `Review checks before the client receives this version` |
| Relay | Duplicate eyebrow + generic inbox tone | Single title + lead; card body deduped |
| Route shell | `shell port` / `routeName` in UI | Preview shell copy via i18n |

---

## Mobile chrome

- Active nav link: `aria-current="page"`, stronger pill, scroll-snap row, **scroll active item into view** on load.
- Main + FAB: safe-area padding; bottom clearance for fixed voice button.

---

## Verification

```bash
npm run typecheck                    # PASS
npm run build:astro                  # PASS
node --import tsx --test \
  tests/route-shell-smoke.test.ts \
  tests/app-i18n-ast-walk.test.ts \
  tests/phase1g-c-plain-language.test.ts  # PASS
npm test                             # 1445/1445 PASS
```

---

## Intentionally retained technical labels

| Where | What | Why |
|-------|------|-----|
| Chip / pill `title` | Raw `plumbing_fixtures`, domain ids | Audit/debug backstage |
| Role routing home line | `F-C1`, `F-A1 / F-A2` | Internal matrix reference |
| `field.notice.entry_kind` | `tenant_ggr` | Pre-existing demo string; not in 1G-C scope |
| Send-gate substrate | Unchanged checks / API | Brief lock |

---

## Out of scope (confirmed)

- `src/app/pages/field-capture.astro`
- Event contracts, APIs, persistence
- Send-gate weakening

---

## Push

```bash
git push -u origin phase-1g-c-mobile-chrome-language
```
