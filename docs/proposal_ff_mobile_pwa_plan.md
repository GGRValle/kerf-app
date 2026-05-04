# Proposal-First F&F — iPhone / Mobile / PWA Readiness Plan

**Status:** DRAFT — implementation plan
**Date:** 2026-05-04
**Owner:** Christian Asdal · GGR
**Scope:** Make the proposal-first F&F loop usable on Christian's iPhone via Safari + Add-to-Home-Screen (PWA). Local-only single-tenant first; hosted private demo second.
**Source basis:** [`docs/ff_proposal_first_roadmap.md`](./ff_proposal_first_roadmap.md) · [`docs/w1_close_note.md`](./w1_close_note.md) · [`docs/wireframes/README.md`](./wireframes/README.md) · [`docs/wireframes/kerf_views_master_v1_0.html`](./wireframes/kerf_views_master_v1_0.html) (canon mobile v2 §operator pattern, F·01 / F·02 frames) · [`docs/architecture/kerf_knowledge_graph_schema_v0_2.md`](./architecture/kerf_knowledge_graph_schema_v0_2.md) · [`src/examples/w1-decision-queue-demo.html`](../src/examples/w1-decision-queue-demo.html) · [`src/examples/w1-standard-ui-demo.css`](../src/examples/w1-standard-ui-demo.css).

---

## 1. Current F&F proposal loop state

The end-to-end proposal-first loop has all the **safety-spine** pieces and a working **desktop visual shell** matching canon. It does not yet fit on a phone.

What's already true on `main`:

- **One Policy Gate, one validator wall, one DecisionPacket contract.** Proposal follow-up flows through `proposal_followup.detected → drafted → approval_requested → operator approve/reject → proposal_followup.approved/.rejected`, with V9 learning signals captured. Verified by `npm run smoke:proposal-ff` against a tmp JSONL EventLog (durability proven across session boundary).
- **Browser-visible operator surface (W1 demo).** Canon palette (`#D4923A` amber, warm panel tones), canon type scale, canon four-zone shell (`56px module-rail · 320px Right Hand rail · 1fr main · 13.5–15rem log rail`), with workflow filter chips above the queue. Lives at `src/examples/w1-decision-queue-demo.html`. Local-only — no fetch, no backend writes, no auth.
- **Demo persistence** committed to in-memory EventLog with the typed `decision.resolved` event-template contract (`src/decisions/operatorActions.ts`, `src/decisions/proposalOperatorPersistence.ts`). Cross-restart durable JSONL adapter exists (`src/blackboard/fileEventLog.ts`).
- **Canon-aligned wireframe reference** in `docs/wireframes/` including the **mobile v2 §operator pattern** (canon for the three-tier mobile landing: *The One Thing → On Deck → The Pulse*), and `kerf_views_master_v1_0.html` F·01 / F·02 frames showing the iPhone-shaped mobile chrome (380px frame, `.mobile-statusbar`, `.mobile-topbar`, `.mobile-body`, persistent voice button in bottom bar).

What's missing for the iPhone:

- The W1 demo HTML/CSS targets a **1280–1440px desktop viewport**. At 375–428px (iPhone widths), the four-zone grid collapses but does not adapt to phone-shape patterns (no bottom bar, no swipe-friendly card tap targets, no notch / safe-area handling).
- **No PWA manifest** — Safari "Add to Home Screen" works against any HTML, but without `manifest.json`, Apple PWA meta tags, and properly-sized icons, the installed app behaves like a bookmark, not a standalone surface.
- **No hosted URL** — `npm run demo:w1-queue:serve` is `localhost`-only. F&F recipients (including Christian's own iPhone when off-LAN) need a private, signed-in URL.
- **No proposal-loop persistence across an iPhone reload.** The browser-local EventLog is in-memory only; a phone wake-from-sleep will reset state.

The plan below sequences these gaps in the order that makes proposal-first F&F demoable on an iPhone.

---

## 2. Why mobile web / PWA first, not native app first

Three reasons, in priority order:

1. **Canon explicitly says mobile-first.** From `kerf_views_master_v1_0.html` §metaphor: *"Source-or-silent. Mobile-first. Spanish-native. Decisions, not dashboards."* The desktop W1 surface is an operator console; the operator-day-to-day surface canon describes IS the phone. Building native-first inverts canon.
2. **Native app is W2+ at the earliest.** F&F success is *one operator (Christian) reviewing real proposals on his phone in real time over a weekend*. App Store review (1–7 days), TestFlight invite friction, and per-platform divergence (iOS + Android) burn the F&F window. PWA installs through Safari in <30 seconds and updates without re-publishing.
3. **The same TypeScript / HTML / CSS stack already ships the desktop demo.** A PWA pass reuses every existing artifact: `decision-card.css`, `decision-queue.css`, `w1-standard-ui-demo.css`, the `runPolicyGate` build, the JSONL durability path. Native rebuilds the operator surface from scratch in Swift / Kotlin or RN — substantial parallel codebase for unclear F&F gain.

**When native becomes worth doing:** push notifications that wake the device while Safari is closed (`F·01` notification → DQ landing in canon), camera-direct evidence capture without OS chooser, sub-100ms cold start, OS-shell integration (Shortcuts, share sheet). All W2+. None of those are F&F-blocking — F&F is *can Christian read a draft proposal, tap Approve, and see the audit chain on his iPhone*. PWA delivers that.

Trade-offs accepted by going PWA-first:
- Push notifications via Safari are limited (iOS 16.4+ supports web push but only after install, with a permission prompt). For F&F, polling-on-foreground is acceptable.
- iOS Safari sandboxes some APIs (background sync, camera-direct intent). All are W2+ asks.
- Performance is constrained by Safari's JIT. The demo bundle is 127.8kb today — well below any realistic Safari budget.

---

## 3. iPhone target surfaces

In the order the operator hits them on the F&F core path, mapped to the canon frames they correspond to.

### 3.1 Proposal queue (entry surface)

**Canon frame:** `kerf_views_master_v1_0.html` F·02 (Operator landing · 3-tier · canon mobile v2 §operator A — *The One Thing → On Deck → The Pulse*).

**iPhone shape:**
- One column, full width, 12–16px outer padding (safe-area-aware).
- Topbar height 50px (canon-locked; same as desktop).
- Single visible "Today" stack: top is *The One Thing* (the highest-altitude open proposal), below it 2–3 *On Deck* cards, below that *The Pulse* (counters: 4 proposals · 4 invoices · 4 drift).
- Each proposal card renders title + client + amount + ALTITUDE badge + primary action. No multi-column metric strip on phone — it stacks vertically as a small header inside the card.
- Tap the card → proposal detail review (§3.2).

### 3.2 Proposal detail review (primary work surface)

**Canon basis:** v4+ Right Hand surface concept; W1 demo's existing proposal detail panel pattern, reshaped for phone.

**iPhone shape:**
- Full-screen replacing the queue (not a drawer).
- Sticky top: proposal title + client + amount + back button (← chevron) on the left, audit-disclosure toggle (ⓘ) on the right.
- Body scrolls: drafted client follow-up letter (panel-2 background, sans-serif, no monospace), source basis section, "What this Decision says" block (recommendation + reason), audit details collapsed by default.
- **Bottom action bar (sticky)**: `Approve · Edit · Reject` — three equal-weight buttons, full-width split, 56px tall. Approve is amber-filled; Edit is ghost; Reject is ghost-with-alert-tone-on-press. Bottom safe-area inset respected so the bar doesn't sit under the home indicator.

### 3.3 Approve / edit / reject (action surfaces)

**Approve flow:**
- Tap Approve → confirmation sheet slides up from bottom (not a modal — a half-sheet, 50% screen).
- Sheet shows: "Send approval for this proposal follow-up?" + summary of the decided action + Confirm / Cancel.
- On Confirm: append `decision.resolved` + `proposal_followup.approved` events to the durable JSONL log → return to proposal detail with a brief inline success toast → back-to-queue auto-removes the approved card from "On Deck."

**Edit flow:**
- Tap Edit → inline body editor for the drafted follow-up text only (not for amount / client / authority — those require operator override flows, deferred).
- Submit → append `decision.resolved` event with `action: 'edit'`. No new draft generated; the edited body is the new draft text.

**Reject flow:**
- Tap Reject → inline reason form (textarea + Submit / Cancel). Required reason — empty submit blocked at the form level (operator must say *why*).
- On Submit: append `decision.resolved` (with reason) + `proposal_followup.rejected`. Same return-to-queue pattern.

### 3.4 Audit disclosure

**Canon rule (KG schema §3.4 + §3.7):** authoritative DecisionPacket fields are surfaced; AltitudePacket model-suggested fields are audit-only; full LearningSignal trail is operator-inspectable but not in first viewport.

**iPhone shape:**
- ⓘ button in proposal detail top-right opens a half-sheet from bottom.
- Sheet content: validator order (V1 → V2 → V6 → V7 → V8 → V9 → V12 → V17 → V18) with pass/fail dots; system-final altitude vs system-baseline-altitude; learning signals if V9 produced any; source refs / claim ids.
- All values copy-on-tap (long-press → copy single value).
- Closes by tap-down or swipe.

### 3.5 Voice capture (deferred to W2+; flagged)

Canon F·02 lists a persistent **▸ voice button** in the bottom bar. Mobile v2 §operator pattern reserves `[Std/Graph]·[⌘ modules]·[▸ voice]` as the standing chrome. F&F does not require voice capture. **Reserve the bottom-bar slot but do not wire it to a recorder yet.** Tapping should show a short toast: *"Voice capture coming in W2 — use Slack for now."*

---

## 4. Mobile interaction model

### 4.1 One-column queue

- Single column, full viewport width minus 12–16px gutters.
- Module rail and Right Hand rail (the desktop's left two columns) collapse into the topbar at phone widths: brand mark left, ⌘ menu icon (modules), small Right Hand status dot (brass `--rh: #C9A876`) — a 8×8 dot with optional pulse animation; tapping it surfaces the "Drafting follow-ups for N proposals" status.
- Action log right rail is **not** in first viewport on phone. Audit disclosure (§3.4) replaces it. Operators can pull up the log explicitly via a "Log" button in the ⌘ menu.

### 4.2 Tap card to detail

- Tap target: full card surface, 56px+ minimum height per Apple HIG.
- Visual press state: `background: color-mix(in srgb, var(--kerf-w1-brand) 6%, var(--kerf-w1-panel))` for 100ms.
- Transition: page-replace (not a modal). The browser back button returns to queue.

### 4.3 Back behavior

- Top-left ← chevron in proposal detail (§3.2).
- Browser back gesture (edge-swipe-from-left) also works — uses the same handler.
- Hardware back doesn't apply (iPhone has no hardware back); edge-swipe + on-screen chevron cover the case.
- Do not implement custom history stack manipulation; let the browser own history per page-replace.

### 4.4 Bottom action bar

Per §3.2:
- Sticky `position: fixed; bottom: 0`. Width 100%. Background `var(--kerf-w1-panel)` with 1px top border.
- Three buttons split equally: Approve (amber-filled, primary) · Edit (ghost) · Reject (ghost, alert tone on press).
- 56px tall (above the safe-area inset; total bar height 56 + safe-area-bottom).
- Bar stays visible while body scrolls. Body has 56 + safe-area-bottom + 8px scroll-padding-bottom so content isn't hidden behind the bar.

### 4.5 Safe-area / notch handling

- Wrap shell in `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Use `env(safe-area-inset-*)` on:
  - Topbar `padding-top: env(safe-area-inset-top)`
  - Bottom action bar `padding-bottom: env(safe-area-inset-bottom)`
  - Body `padding-left: max(12px, env(safe-area-inset-left))` for landscape with notch
- Test against iPhone 13 / 14 / 15 / 16 sizes (notch + Dynamic Island both produce the same `safe-area-inset-top`).

### 4.6 Gestures explicitly NOT used

- No swipe-to-approve / swipe-to-reject on cards. Per canon: every approve / reject is *explicit operator confirmation*. Swipes are too easy to fire accidentally.
- No pull-to-refresh in F&F. The queue updates from local fixtures only; nothing to pull.
- No long-press menus on cards (would conflict with iOS text-selection long-press patterns).

---

## 5. PWA requirements

### 5.1 manifest.json

Add `src/examples/manifest.webmanifest` (or a separate proposal-ff-specific `manifest.json` if we want to scope the PWA install just to the F&F surface). Required fields:

```json
{
  "name": "Kerf — Proposal Review",
  "short_name": "Kerf",
  "start_url": "/examples/w1-decision-queue-demo.html",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0A0D11",
  "theme_color": "#0A0D11",
  "icons": [
    { "src": "/icons/kerf-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/kerf-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/kerf-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`background_color` and `theme_color` both equal canon's body canvas `#0A0D11` so the iOS launch splash and status-bar tint match the app's dark canvas.

### 5.2 Icons

Three icons minimum:
- `kerf-192.png` (192×192) — required by spec
- `kerf-512.png` (512×512) — required for high-density displays
- `kerf-512-maskable.png` — for Android adaptive icons; iOS ignores `purpose: "maskable"` but doesn't break

Icon design constraint: amber (`#D4923A`) "K" or "KERF" wordmark on `#0A0D11` background, centered with 20% inset for maskable safe-zone. **No alpha in iOS launch splash** — Safari ignores transparent backgrounds.

iOS-specific (Apple's PWA path doesn't use the standard manifest icons reliably):
```html
<link rel="apple-touch-icon" sizes="180x180" href="/icons/kerf-180.png">
<link rel="apple-touch-icon-precomposed" sizes="180x180" href="/icons/kerf-180.png">
```

### 5.3 Theme color + status bar

```html
<meta name="theme-color" content="#0A0D11">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

`black-translucent` makes the status bar overlay the topbar with white text — combined with `viewport-fit=cover` and `safe-area-inset-top`, the iOS status bar reads white on the canon dark canvas.

### 5.4 apple-mobile-web-app-* tags

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Kerf">
<meta name="mobile-web-app-capable" content="yes">
```

Without `apple-mobile-web-app-capable: yes`, an Add-to-Home-Screen install opens in mobile Safari with the address bar — defeating the standalone-app feel.

### 5.5 Add-to-Home-Screen flow

iOS doesn't auto-prompt for PWA install (Apple deliberately omits the install prompt API). The flow is:

1. Christian opens the hosted F&F URL in Safari on his iPhone.
2. Taps the share button (⎘).
3. Scrolls to "Add to Home Screen" → Add.
4. The icon (`apple-touch-icon`) and title (`apple-mobile-web-app-title`) appear on the home screen.
5. Tapping the icon launches the demo in standalone mode (no Safari chrome).

For F&F, **add a one-screen install hint** that shows on first visit if the page detects mobile-Safari-non-standalone (`window.navigator.standalone === false`). Hint copy: *"Add Kerf to your home screen for the best experience: tap ⎘ then 'Add to Home Screen.'"* Dismissable; never reappears for the session.

### 5.6 Service worker (deferred for F&F)

A service worker enables offline caching, background sync, and push. For F&F:
- **Defer offline mode.** F&F is online-only; no service worker required for the demo.
- **Defer push notifications.** iOS web push requires install + permission prompt; F&F polls on foreground.
- **Reserve `/sw.js` path** so adding a service worker later doesn't change the manifest.

---

## 6. Hosted F&F URL requirements

The W1 demo today is `localhost`-only. For F&F dry runs, Christian needs a URL he can open from his iPhone over cellular. Required properties, in priority order:

### 6.1 Private URL

- A single fixed URL — e.g., `https://ff.kerf.example/proposal/` or path-scoped on an existing hostname.
- **Not indexed by search engines.** `<meta name="robots" content="noindex,nofollow,noarchive">` on every page + `X-Robots-Tag: noindex,nofollow` HTTP header. Add a `/robots.txt` with `Disallow: /`.
- **Not linked from public sites.** F&F recipients receive the URL out-of-band (text / email).
- HTTPS only. iOS PWA install requires HTTPS in standalone mode.

### 6.2 Basic auth or allowlist

For F&F (single tenant, single operator), the bar is "is this Christian / a friend Christian gave the link to," not "real auth." Two acceptable patterns:

- **Basic auth (HTTP Basic).** Edge nginx / Cloudflare Access configures a single shared username + password. Fast, low-stakes, but the password lives in the URL bar and in iOS Keychain. Adequate for F&F.
- **Cloudflare Access (preferred).** Email magic-link flow, cookie-based session, allowlist per email. No shared password. Cleaner audit trail.

**Do not roll custom auth.** Real auth lives W2+ when the platform side ships; until then a vendor-provided gate (Cloudflare / Vercel deploy protection / Netlify Identity) is the right scope.

### 6.3 No production sends

Already-true property of the W1 demo: no fetch, no SMTP, no Slack hook, no QBO write. **Re-verify on the hosted environment** by:
- Smoke-test on the hosted URL: open the demo, click Approve on a proposal, confirm zero outbound network requests in the iPhone Safari Web Inspector network tab.
- Hardcode `Content-Security-Policy: default-src 'self'; connect-src 'self'; ...` so any accidental future fetch is blocked at browser level.
- The hosted host should be on a domain that is **not** the production GGR / Valle domain — keeps the audit story clean.

### 6.4 No public indexing — re-statement with detail

Beyond `robots.txt`:
- Do not link the URL from any public Kerf doc, GitHub README, or social.
- If using Cloudflare Pages / Vercel, mark the deploy as **password-protected** so the preview URL itself is gated, not just the app behind it.
- Set up a 30-day URL rotation policy: if the URL ever leaks, kill it and roll a new one.

### 6.5 Hosting target candidates

In rough preference order:
- **Cloudflare Pages with Access** — single command deploy from a CI run, integrated email-magic-link gate, free tier covers F&F traffic.
- **Vercel with deploy protection** — same shape, slightly more JS-runtime overhead than Pages. Acceptable.
- **GitHub Pages + Cloudflare Access in front** — works but requires more config surface.
- **Self-hosted (mini.local exposed via Tailscale)** — works inside the GGR network but Christian's iPhone needs Tailscale running. Acceptable for a same-room demo, not for F&F-at-large.

For F&F's first demo: **Cloudflare Pages + Access**. Re-evaluate when usage patterns are clearer.

---

## 7. Acceptance checklist for iPhone Safari

A PR landing the mobile/PWA pass passes when **every** box checks on a real iPhone running current iOS Safari, in both portrait and landscape.

### 7.1 Visual / layout

- [ ] Topbar 50px tall. Status bar overlay reads white on the dark canon canvas. No double-bar with Safari's URL chrome.
- [ ] Brand mark `KERF` in amber, `Standard UI · Local only` tag below — both legible at 100% zoom.
- [ ] `Right Hand` brass status dot visible in topbar; tapping shows the status string.
- [ ] Queue scrolls smoothly, no horizontal overflow at any viewport width 320–428px.
- [ ] Cards span full viewport width minus 12–16px gutters.
- [ ] Bottom action bar visible on every detail page; doesn't overlap card content (proper scroll-padding-bottom).
- [ ] Safe-area insets respected — no content under the notch / Dynamic Island, no content under the home indicator.
- [ ] Audit disclosure half-sheet opens / closes cleanly; doesn't lock body scroll permanently if dismissed unusually.

### 7.2 Interaction

- [ ] Tapping a queue card navigates to detail (page-replace, browser history works).
- [ ] Edge-swipe-from-left returns to queue. ← chevron also returns.
- [ ] Approve / Edit / Reject all functional; events appended to the durable JSONL log; events survive a Safari reload.
- [ ] Reject form requires non-empty reason; empty submit blocked.
- [ ] Voice button shows the deferred-to-W2 toast.
- [ ] No accidental zooming on double-tap (`<meta name="viewport" content="...maximum-scale=1...">` if needed; but prefer not to disable zoom — accessibility).
- [ ] Long-press on a value (audit sheet) copies it; pasted into Notes confirms.

### 7.3 PWA install + standalone mode

- [ ] Visit URL in mobile Safari. First-visit install hint appears.
- [ ] Share → Add to Home Screen. Icon and "Kerf" title appear on home screen.
- [ ] Tapping the icon launches in standalone mode (no Safari chrome — confirmed by absence of address bar).
- [ ] Status bar tint matches `#0A0D11` (black-translucent over canon canvas).
- [ ] Splash screen shows the canon canvas color, not white.
- [ ] App survives device wake-from-sleep with state preserved (events still in JSONL log).

### 7.4 Privacy / safety

- [ ] Page source shows `<meta name="robots" content="noindex,nofollow,noarchive">`.
- [ ] `Disallow: /` in `/robots.txt`.
- [ ] HTTPS only; HTTP redirects to HTTPS.
- [ ] CSP header blocks any fetch other than `self`.
- [ ] No outbound network requests visible in Safari Web Inspector during a full proposal-loop click-through.
- [ ] Cloudflare Access (or basic auth) prompts before any page loads.

### 7.5 Capture

- [ ] Screenshot the F&F home-screen icon, the standalone-mode top viewport, the proposal detail with bottom bar, and the Approve confirmation half-sheet. File these into `src/examples/evidence/<date>-proposal-ff-mobile/screenshots/` per the existing screenshots README pattern.

---

## 8. Suggested PR sequence

Each PR is small, scoped, and gate-passable independently. Order is dependency-driven.

### PR-A · Phone-shape responsive rules in the demo CSS

**Branch:** `feature/w1-mobile-responsive-rules`
**Files:** `src/examples/w1-standard-ui-demo.css`, `src/examples/w1-decision-queue-demo.html` (limited to viewport meta + safe-area), `tests/w1-decision-queue-demo.test.ts` (source-grep tests).

- Add `viewport-fit=cover` viewport meta.
- Add `<375px` and `<428px` mobile breakpoints scoped under `.kerf-w1-standard-ui`.
- Single-column queue at phone widths; module + Right Hand rails collapse into topbar elements.
- Bottom action bar styling (sticky, safe-area-aware) — markup added but only visible at phone widths.

**Risk:** layout regression at desktop widths if breakpoints leak. Mitigated by scoping all rules under `@media (max-width: 428px) { .kerf-w1-standard-ui ... }`.

### PR-B · PWA manifest + Apple meta tags + icons

**Branch:** `feature/w1-pwa-manifest`
**Files:** `src/examples/manifest.webmanifest` (new), `src/examples/icons/` (three PNGs, new), `src/examples/w1-decision-queue-demo.html` (link/meta tags), `tests/w1-decision-queue-demo.test.ts` (source-grep that the manifest link and apple-mobile-web-app-capable tag exist).

- Manifest with the canon `#0A0D11` background and theme.
- Icons designed against canon palette.
- Apple-specific meta tags.
- First-visit install hint in `w1-decision-queue-demo.ts` (small JS check, dismissable).

**Risk:** icon design choices need a one-pass review; rest is mechanical.

### PR-C · Per-detail page-replace + back chevron

**Branch:** `feature/w1-mobile-detail-route`
**Files:** `src/examples/w1-decision-queue-demo.html`, `src/examples/w1-decision-queue-demo.ts`, `tests/w1-decision-queue-demo.test.ts`.

- Tap card → swap queue for detail in main column at phone widths (page-replace via JS, not a real router).
- ← chevron + `history.pushState` so browser back returns to queue.
- Sticky bottom action bar shows on detail; hidden on queue.

**Risk:** browser-history coupling is the highest-care part. Snapshot tests via source-grep of the new event handlers + history calls.

### PR-D · Hosted private demo deploy (Cloudflare Pages + Access)

**Branch:** `infra/ff-hosted-demo`
**Files:** `infra/cloudflare-pages.toml` (or equivalent), updates to `src/examples/README.md` (hosted URL + auth note).

- One-command Cloudflare Pages deploy from a CI run.
- Cloudflare Access policy: email allowlist (Christian + designated F&F reviewers).
- `robots.txt` + CSP header + `noindex` meta.
- Deploy URL **never linked** from the repo README.

**Risk:** infrastructure config; review that Access policy is correct before sharing the URL.

### PR-E · Mobile screenshot capture + evidence packet

**Branch:** `docs/proposal-ff-mobile-screenshots`
**Files:** `src/examples/evidence/<date>-proposal-ff-mobile/PROOF_PACKET.md`, `screenshots/` directory.

- Mirror existing W1 + proposal-ff evidence packet shape.
- Operator (Christian) captures via the §7.5 checklist.
- Locks acceptance evidence for the F&F demo.

**Risk:** screenshot capture done by operator on real iPhone; not automatable.

### Optional PR-F · Audit half-sheet polish

**Branch:** `feature/w1-mobile-audit-sheet`
**Files:** `src/examples/w1-standard-ui-demo.css`, `src/examples/w1-decision-queue-demo.html`, `tests/w1-decision-queue-demo.test.ts`.

- ⓘ button + bottom-half-sheet pattern.
- Tap-to-copy on values.

**Risk:** can defer to W2 if PR-A through PR-E land first; not F&F-blocking.

**Total effort estimate:** PR-A through PR-E is roughly 1–2 days of focused work, parallelizable across the Cursor agents. PR-F is half a day.

---

## 9. Non-goals

Each of these would expand surface without advancing the F&F core path. Calling them out so they don't get sneaked in.

- **Native iOS app.** Deferred to W2+ at earliest; canon explicitly says mobile-first means phone-web-first.
- **Push notifications.** iOS web push is install-gated and adds permission-prompt friction. F&F polls on foreground.
- **Offline mode.** Service worker work is deferred. F&F is online-only.
- **Multi-tenant install.** F&F is single-tenant (Christian / GGR). The hosted URL is gated to the operator and a small allowlist.
- **Voice capture wiring.** Bottom-bar voice button shows a "coming in W2" toast; do not wire to a recorder yet.
- **Camera-direct evidence capture.** Will require native or a Safari camera-intent flow that's W2+. F&F operates on existing seeded fixtures.
- **Spanish localization on mobile (full pass).** I18nKey scaffolding is already in place; full ES copy is W2+ — F&F is English-first.
- **Real auth.** Cloudflare Access stands in until Platform-side auth ships; do not roll custom JWT / sessions / OAuth.
- **Production sends from the F&F demo.** No SMTP, no Slack, no QBO writes. The demo's whole point is that the operator can review without anything being sent.
- **App Store presence.** No App Store listing, no TestFlight; the PWA path is the only install path.
- **Marketing chrome.** No "Get the app" hero, no oversized CTA, no marketing copy on the F&F demo. Operator console aesthetic only.

---

## 10. Acceptance / sign-off (for the parent task)

This plan is ready for review when:

- [ ] All required sections present (1–9).
- [ ] Every claim about current state is grounded in named files / PRs / canon docs.
- [ ] PR sequence (§8) is dependency-correct and each PR is independently gate-passable.
- [ ] Non-goals (§9) are explicit enough that follow-up work won't accidentally pull them in.
- [ ] iPhone acceptance checklist (§7) is concrete enough that an operator (Christian) can grade it pass/fail without ambiguity.

*— end plan —*
