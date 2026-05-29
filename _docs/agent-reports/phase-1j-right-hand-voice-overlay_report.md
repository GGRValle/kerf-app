# Right Hand Voice Overlay · Realtime Caption (Option B V1) · Lane Report

**Branch:** `phase-1j-right-hand-intake-voice`
**Base:** `origin/main @ 23a8a1c` (`fix(shell): route Speak to Right Hand intake`)
**Code commit:** `348a624`
**Lane:** `RightHand_Voice_Overlay_RealtimeCaption_2026-05-29` (Cowork dispatch 2026-05-29)
**Status:** Built, verified, pushed — **not merged.** Cowork verifies on iPhone-width (Bar 2 + Bar 3); Christian merges.

---

## Mandate

> Run the Right Hand Voice Overlay lane. This SUPERSEDES the "Voice Reality
> Stopgap" framing — Option B (live realtime caption while speaking) is V1, not a
> stopgap. This lane is the FRONT DOOR that produces the transcript feeding the
> Phase 1H path; it does not change anything downstream. Two lanes,
> consequence-gated (D-049). First step before code: lock Option B in the spec
> of record.

The dispatch brief file (`RightHand_Voice_Overlay_RealtimeCaption_2026-05-29.md`)
is **not present in either repo**; I worked from the paste-ready dispatch note,
which is detailed and authoritative, plus the spec of record and D-049. Noted here
for traceability.

---

## 1. Spec of record locked (first step, before code)

`docs/architecture/right_hand_voice_overlay_spec_2026-05-29.md` reconciled:

- **§0 (new):** Option B (bounded realtime caption) **locked as the V1 voice
  lane**, not a stopgap. Model `gpt-4o-transcribe`; Groq Whisper turbo
  (`/api/v1/transcribe`, record-then-send) stays the fallback path. Front-door
  scope boundary stated: produces the transcript that feeds Phase 1H; changes
  nothing downstream of the committed transcript.
- **§8 resolved:** the open A-vs-B decision is now B. §3 recommendation and §7
  phasing updated (B pulled from V2 → V1; A retained as the §9 fallback, not
  deleted).
- **§9 (new) — two-lane consequence gating (D-049 applied):** LIVE lane (interim
  words → instant reversible navigations) vs COMMIT lane (committed transcript →
  durable actions). Full routing table. "Never persist or synthesize from interim
  words." "Cleanup = waiting for the committed transcript; NO second API call"
  (no speculative whole-clip pass — that double-bills).
- **§10 (new) — consent gating:** GGR-only via `tenant_synthesis_consent`;
  non-consenting tenants fall back to Groq record-then-send. Server-authoritative.
- **§11 (new) — realtime safety guardrails (gate-blocking):** ephemeral
  server-minted token (standing key never in client) · transcription-only config
  (no speech-to-speech, ever) · bounded window · consent gate · no raw payload
  persisted unparsed · no PII in URLs/logs.
- **§12 (new) — endpoint contract** for the ephemeral session route.

## 2. What was built

### Server — gate-blocking safety

| File | Role |
|---|---|
| `src/tenant/synthesisConsent.ts` | `tenant_synthesis_consent` registry (D-049 §6). GGR consents; **default DENY** for everyone else → Groq fallback. `hasSynthesisConsent()` is server-authoritative. |
| `src/hosting/routeCheck.ts` | Registered `openai://gpt-4o-transcribe-realtime` (model `gpt-4o-transcribe`, tier `frontier`, D-049) in the D-023 registry. |
| `src/voice/realtime/realtimeSession.ts` | `buildTranscriptionSessionConfig()` — **transcription-only** (no `modalities`/audio output, ever). `mintRealtimeTranscriptionSession()` mints the ephemeral secret via injected fetch; standing key used only to authenticate the server→OpenAI mint, **never returned to the client**. Bounded-window params travel to the client. |
| `src/api/routes/realtime.ts` | `POST /api/v1/realtime/transcription-session`: **503** (no `OPENAI_API_KEY`) · **403 + `fallback: groq_record_then_send`** (no consent) · route-check · **200** ephemeral secret + bounded window. No transcript/audio logged. |
| `src/api/router.ts` | Mounted the realtime route. |

### Two-lane gate — pure, shared by client + server

`src/voice/realtime/voiceActionGate.ts`:
- `classifyVoiceActionLane` / `canRouteFromInterim` / `requiresCommittedTranscript`
  — the §9 LIVE-vs-COMMIT split as the single source of truth.
- `assertCommittedForDurable()` throws `InterimPersistBlockedError` — makes
  "never persist from interim words" **unbypassable**.
- `classifyTranscriptIntent()` — deterministic keyword classifier (honest
  authority; LLM intent is the V2 upgrade, not faked). Imported directly into the
  overlay client so the rule is enforced identically on both sides.

### Overlay — the front door

`src/app/components/RightHandVoiceOverlay.astro` (mounted once in `Layout.astro`):
- Opens on Speak tap. The center mic (`MobileBottomNav`) and desktop FAB
  (`SpeakFAB`) carry `data-rh-speak`; their `href="/right-hand"` stays as the
  **no-JS fallback**.
- Mic + active "listening" indicator + live audio-level meter (Web Audio
  `AnalyserNode` VAD). **Bounded window enforced:** 2.5s silence → commit · 12s
  idle → close · 75s hard cap → "Continue?" · **full teardown** (tracks stopped,
  RTCPeerConnection + recorder closed, timers cleared) on dismiss/idle/cap.
- **Realtime-first:** asks the server for an ephemeral session; on 200 opens an
  OpenAI realtime transcription-only WebRTC session and streams interim +
  committed transcript. On **403/503/unavailable → Groq record-then-send
  fallback** (`/api/v1/transcribe`), honest "transcribes when you pause" status.
- **Consequence gating live:** interim words may only fire reversible LIVE
  navigations (room-capture / relay / field-capture / projects). Durable intents
  wait for the committed transcript, which is stashed in `sessionStorage`
  (`kerf.voiceCommit`) — **never placed in a URL** — and the overlay navigates to
  the capture surface with enum params only (`?src=voice`). The overlay persists
  nothing itself.
- Caption is **real STT only** — empty until words arrive; never invented.
- i18n: `rh_voice.*` keys added to `keys.ts` / `en.ts` / `es.ts` (status,
  caption label, honest-authority note, actions).

## 3. Safety bar (Bar 2 — six items) · how each is met

1. **Ephemeral token server-side; standing key never in client** — minted in
   `realtimeSession.ts`; endpoint returns only the ephemeral secret; test asserts
   the standing key string is absent from the 200 body.
2. **Transcription-only; no speech-to-speech/audio output** — config requests
   `input_audio_transcription` only; test asserts `modalities`/`voice`/output-audio
   keys are absent.
3. **Bounded window** — 2.5s/12s/75s + teardown on dismiss; no background stream.
4. **Consent gated (GGR-only); others Groq fallback** — `hasSynthesisConsent`;
   403 + fallback for non-consenting tenants.
5. **No raw realtime payload persisted unparsed; no PII in URLs/logs** — only the
   parsed committed transcript is stashed in sessionStorage; route handoffs carry
   enums/ids; the endpoint logs invocation ids/timings only.
6. **Honest authority** — deterministic keyword routing, surfaced to the operator
   ("Routing on keywords for now… it doesn't act on its own"); no fake transcript,
   no fake LiDAR (routes to the real `/room-capture`).

## 4. Verification — clean worktree

Verified from a **fresh `git worktree` at the pushed commit**, clean `npm ci`.

```
npm run typecheck   → tsc --noEmit, no errors
npm run build:astro → ✓ server + client built (overlay client script bundled)
node --import tsx --test tests/right-hand-voice-overlay.test.ts
  → tests 14 · pass 14 · fail 0
Adjacent suites (transcribe, route-shell-smoke, batch-d shell)
  → tests 20 · pass 20 · fail 0
```

(See the appended clean-worktree proof for the exact pushed SHA.)

## 5. What is NOT done here (honest scope)

- **Bar 3 (device walk)** — overlay → live caption → commit → route → draft on an
  iPhone — is **Cowork/Christian's on-device verification step** and requires
  `OPENAI_API_KEY` + a real device (iOS Safari has no Web Speech; the realtime
  WebRTC path and the Groq fallback both need a device + secret to exercise live).
  The code paths are built and unit-tested at the seams; live device behavior is
  the merge gate, not this agent's claim.
- **Downstream consumption of `kerf.voiceCommit`** by `/field-capture` is Phase 1H
  wiring — intentionally untouched (this lane "does not change anything
  downstream").
- **LLM-backed intent** (vs deterministic keywords) is the spec §7 V2 upgrade.
- **Per-minute realtime rate / session minimum** must be verified on the live
  OpenAI dashboard before paid-scale rollout (internal-scale cost is trivial).

---

---

## Appendix · clean-worktree proof

Verified tip: **`f5d32f1`** (code + tests) via a fresh `git worktree` + clean `npm ci`.
The only commit above this tip is this report appendix (docs-only).

```
HEAD: f5d32f1d1c4878784b1b997648af4fe17da92727
npm run typecheck    → OK (tsc --noEmit, no errors)
npm run build:astro  → OK (server + client built; overlay client bundled)
node --import tsx --test tests/right-hand-voice-overlay.test.ts → 14/14 pass
Full suite (excluding pre-existing, untracked-bundle v15-vertical-slice):
  tests 1474 · pass 1474 · fail 0
```

The `v15-vertical-slice-pages` suite is excluded — it fails on a fresh checkout
because it reads an untracked generated bundle (`app.bundle.js`); pre-existing and
unrelated to this lane.

---

*Lane built by Agent A · 2026-05-29 · pushed for Cowork iPhone verification + Christian merge. Not merged.*
