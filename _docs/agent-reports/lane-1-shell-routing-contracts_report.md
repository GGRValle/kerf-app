# Lane 1 · Shell · Routing · Contracts — Day 1 report

**Branch:** `lane-1-shell-routing-contracts`  
**Worktree:** `/Users/christianasdal/code/kerf-app-lane-1` (dedicated — not the shared checkout)  
**Contract version:** `2026-06-02.1` (conformance patch — markup rule, `library_ref`, `ATTENTION_STATE_VISUAL`, sidebar derivation doc)

## Day-1 deliverable (dependency root)

Committed the **7 shared contracts as typed interfaces** under `src/contracts/lane1/` and re-exported from `src/contracts/index.js` (`@kerf/core` after build). Lanes 2–8 can import immediately; do not wait on shell implementation.

| # | Contract | Module |
|---|----------|--------|
| 1 | App shell (top-bar · sidebar · content · conversation · D-059 mobile bar) | `shell.ts` |
| 2 | `registerSurface({ domain, route, roleScope, component, backTo })` | `registerSurface.ts` |
| 3 | Attention Artifact + `<AttentionCard/>` props | `attentionArtifact.ts` |
| 4 | Work artifact / JobNote + two-artifact pair | `workArtifact.ts` · `twoArtifact.ts` |
| 5 | Selection (library ↔ instance · lifecycle · line_type · cents) | `selection.ts` |
| 6 | Locality envelope (tenant · bu · client · project · tier) | `locality.ts` |
| 7 | Consequence gate (reversible vs durable · no autonomous money/send) | `consequenceGate.ts` |

Reference registry: `createInMemorySurfaceRegistry()` in `src/shell/inMemorySurfaceRegistry.ts`.

## Build stamp (`/health`)

`src/shell/buildStamp.ts` — top-level `commit` + boolean `dirty` (report-back gate). Wired to `/api/v1/health` and `scripts/serve-kerf-shell.ts` `/health`.

## Not started yet (Lane 1 implementation track)

- F-LND1 login → role home routing
- Seven desktop homes (F-A2/P2/AO2/TO2/SU2/ES2/SH2)
- F-ON1 On-Me · F-AA1 AttentionCard component
- Right-docked conversation panel + role chip/switcher in Layout
- Sidebar drill-down + honest stubs for dead nav items

## Verification

```bash
cd /Users/christianasdal/code/kerf-app-lane-1
npm run typecheck
node --import tsx --test tests/contracts-lane1-shell-freeze.test.ts
```

## Served sha (after push)

Run `/health` in a clean worktree checkout of the pushed commit; expect `dirty: false`.

## Hygiene

No other lane's files touched. Shared checkout at `kerf-app` left on `main`.
