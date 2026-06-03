# Lane 2 · Sales · Design · Knowledge Base — Report

**Branch:** `lane-2-sales-design-kb`
**Base:** `lane-1-shell-routing-contracts @ 363be88` (Lane 1's frozen seven contracts — the dependency root), which is `origin/main @ 8202355` + 1.
**Code head (served + verified):** `39a8423` · `/health` → `dirty:false`.
**Owns:** Sales pipeline (F-SL*) · Design workspace (F-DS1) · Knowledge Base / Libraries (F-LIB1) · Estimate builder (F-EST1) · Selections **Library** (catalog side).
**Goal driven:** a lead becomes a priced, proposable job — `lead → Design (pull Selections from the KB) → estimate → proposal draft`.

---

## Integration note (read first)

I based this lane on **Lane 1's contract commit `363be88`, not bare `origin/main`.** Lane 1 froze the seven shared contracts (`src/contracts/lane1/*`, `src/shell/*`) but has **not yet merged them to `main`**. The whole lane is built against those typed interfaces (Selection, locality, consequence gate, two-artifact, registerSurface, shell, work/attention artifacts). When Lane 1 merges to `main`, this branch fast-forwards cleanly (linear: `main → 363be88 → 39a8423`).

---

## 1 · The exact path I drove (device + route)

Driven live against `serve:shell` (Astro SSR + Hono API at `/api/v1`, `node scripts/serve-kerf-shell.ts`), tenant `tenant_ggr`:

| Step | Surface route | API (durable, confirm-gated) | Result |
|------|---------------|------------------------------|--------|
| Open pipeline | `/sales` | `GET /sales/deals` | 4 deals across stages |
| Open deal | `/sales/deal_wegrzyn` | `GET /sales/deals/:id` | Wegrzyn · Kitchen + bath |
| Enter Design | button → | `POST /sales/deals/:id/enter-design` | `project=proj_deal_wegrzyn` |
| Pull from Library | `/design/proj_deal_wegrzyn` (Selections tab) | `POST /design/:p/pull` | `psel_1` Quartz · **proposed** · 8 900¢ |
| Approve Selection | → | `POST /design/:p/selections/:id/approve` | **approved** (→ Project Selection instance, Lane 4) |
| Build estimate | `/estimate/proj_deal_wegrzyn` | `POST /estimate/:p/seed-from-selections` | totals **reconcile** |
| Generate proposal | button → | `POST /estimate/:p/generate-proposal` | `prop_1` · `status:draft` · two-artifact · **no send** |

Live reconcile proof: `cost 8 900 + markup 3 560 = operator_total 12 460 = client_total 12 460 · reconciles:true`. The markup (3 560¢) is in the operator breakdown only — the client total equals it, markup is never itemized.

`/health` → `{commit: 39a8423…, dirty:false, source:git}`.

The KB at `/library` shows the **Item → Assembly → Template** ladder (Template *Kitchen remodel* → assemblies *Kitchen core* / *Backsplash* → leaf items) with a working **import** entry.

## 2 · What I self-healed

- **No surfaces existed for this lane.** Sales / Design / KB / Estimate were not present (only `proposals/`, `estimator/`, `kb-ingestion/` logic). Built the five surfaces from scratch on Lane 1's contracts.
- **Design's five tabs** (Mood · 3D · Selections · Design tools · Integrations): wired **Selections** (Pull-from-Library + approve + lifecycle); the other four are **honest stubs** — a labelled "not built yet" card with no fake controls, not an inert button.
- **KB's five collections** (Cost · Selections · Vendors · Assemblies · Templates): **Selections / Assemblies / Templates** functional (catalog list, import, ladder); **Cost / Vendors** render real row counts but their dedicated editors are honest stubs.
- **Money reconcile** modeled so `clientTotal === operatorTotal` is an *invariant by construction* with a runtime guard (`reconciles`), and markup is folded per-line, never a client line.
- **Vertical-readiness guardrail** held: `CatalogItem` carries a flat-rate price-book shape (`pricing_mode:'flat_rate'` + `flat_rate_cents`) and a rebate-catalog shape (`rebate`), modeled — **no vertical UI**.

## 3 · Residual risk / fix queue (stated honestly)

- **Persistence is in-memory** (`src/sales/store.ts`, seeded per tenant). Durable writes mutate the process store and survive within a server run, not across restarts. Real persistence (Blackboard events) is the follow-up. The honesty is intact — nothing claims to be saved that isn't, within the run.
- **Save-back-to-Library** is implemented as a pure projection (`saveBackToLibrary`) + tested, but not yet surfaced as a button on `/design`.
- **Cost / Vendors** KB editors and **Mood / 3D / Design tools / Integrations** Design tabs are honest stubs (intentional, breadth-first).
- Pages reflect writes via `location.reload()` (rough but usable); no optimistic client render yet.
- Proposal draft is a slim `ProposalDraftSummary`; mapping it into the full `ProposalArtifact` (CSI divisions, §7159 schedule) is a Lane 7 / proposal-stack join.
- Surfaces are registered against Lane 1's `registerSurface` contract (`src/sales/surfaces.ts`) but the **global sidebar does not yet list them** — that's Lane 1's registry-consumption in the rendered shell. Reachable by route today.

## 4 · What needs human judgment

- **Markup model fork:** I folded markup into per-line client price (operator sees cost+markup; client sees one price). If GGR wants a single blended-margin line or a published markup schedule, that's a design call.
- **Lane seams to confirm:** Project Selection instance shape (→ Lane 4), proposal-draft → delivery (→ Lane 7), estimate → Money lines (→ Lane 5). I produce against Lane 1's contracts; the consuming lanes should confirm the field shapes match their readers.
- **`enter-design` project-id minting** (`proj_<dealId>`) is a placeholder; the real project/job creation likely belongs to the Projects lane.

## 5 · Served SHA

`/health` → `commit: 39a8423`, `dirty: false`, `source: git` (verified on `serve:shell`, port 8099). Branch head after this report is one commit later (report only; no runtime change).

---

## Verification

```
npm run typecheck    → tsc --noEmit · clean
npm run build:astro  → ✓ all five surfaces build (SSR)
node --import tsx --test tests/lane-2-sales-design-kb.test.ts → 19/19 pass
  (cents/reconcile/markup-hidden · lifecycle · consequence-gate · two-artifact/no-send ·
   tenant isolation · registerSurface backTo+no-query · API seam UI→route→data→back)
live drive on serve:shell → full path green; /health dirty:false
```

**Pre-existing failures on the Lane-1 base (NOT introduced by Lane 2):** 4 tests fail on a fresh checkout — three v15 demo tests need a built `app.bundle.js` + live `:8010` server (environmental), and `phase-1i-batch-d-shell`'s "served shell exposes build stamp" is a stale source-assertion that Lane 1's build-stamp refactor (moved into `src/shell/buildStamp.ts`) broke. None of those files are touched by Lane 2. Flagging the build-stamp one for Lane 1 to reconcile.

## Files (all new except the one-line router mount)

- `src/sales/{types,catalog,pipeline,projectSelection,estimate,proposalDraft,store,surfaces,index}.ts` — the engine
- `src/api/routes/salesDesignKb.ts` — API; mounted via a one-line add in `src/api/router.ts`
- `src/app/pages/sales/index.astro`, `sales/[id].astro`, `design/[projectId].astro`, `library.astro`, `estimate/[projectId].astro`
- `tests/lane-2-sales-design-kb.test.ts`

---

*Lane 2 · 2026-06-02. Price it, propose it. Built on Lane 1's frozen contracts; in-memory for the drivable slice; not merged — pushed for review.*
