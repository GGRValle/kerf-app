# Right Hand Voice — Global Overlay Spec

- **Date:** 2026-05-29
- **Author:** Christian (product directive) + Claude (engineering grounding)
- **Status:** Active directive. Supersedes the role of the `/right-hand` page as the Speak *destination*. `/right-hand` remains as a no-JS fallback surface only.
- **Supersedes/extends:** `right_hand_home_module_drawer_2026-05-15.md` (§3.5 voice button = tap-to-record), F-E1 canon State 2 (active recording + live transcript), `dogfood_finding_clarification_prompt_voice_2026-05-13.md` (mic → Whisper turbo pipeline).

---

## 0. V1 LOCK — Option B (live realtime caption) · 2026-05-29 (Cowork dispatch)

**The §8 open decision is RESOLVED. Option B — bounded realtime transcription with live
word-by-word caption — is the V1 voice lane, not a stopgap.** This supersedes the earlier
"Option A is the recommended V1 default" framing in §3 and §7 of this document; those
paragraphs are retained below for lineage but are no longer the operative decision.

Rationale (per `RightHand_Voice_Overlay_RealtimeCaption_2026-05-29.md`): live caption while
speaking is the front-door feel Christian specified ("show live transcript", "do not require
the user to type first"). The realtime session is bounded hard (§4) and consequence-gated
(§9), so the cost and safety concerns that made Option A the conservative default are
contained by construction rather than by deferral.

**Scope boundary — this lane is the FRONT DOOR only.** It produces the transcript that feeds
the Phase 1H multimodal draft path (`/field-capture` → synthesis → `/draft-review` →
validators). It does **not** change anything downstream of the committed transcript. The rest
of Phase 1H (multimodal draft, `/draft-review`, synthesis validators) stays exactly as
dispatched.

**Model:** `gpt-4o-transcribe` (full) for V1, via an OpenAI **realtime transcription-only**
session. **Groq Whisper turbo (`/api/v1/transcribe`, record-then-send) remains the fallback
transcript path** for tenants without synthesis consent and for any realtime-unavailable
condition (no key, route rejected, unsupported client). Verify the exact OpenAI realtime
per-minute rate + any session minimum on the live dashboard before paid-scale rollout
(internal-scale cost is trivial regardless).

---

## 1. Product directive (Christian, verbatim)

> Right Hand Speak is an overlay, not a destination page.
>
> Tap center Speak:
> - Open Right Hand listening overlay immediately.
> - Start mic capture immediately.
> - Show live transcript/status.
> - Do not require the user to type first.
>
> Timeouts:
> - Commit turn after 2-3s silence.
> - Close session after 10-15s idle.
> - Hard stop after 60-90s unless user taps Continue.
>
> Routing:
> - "Take a job note" → /field-capture
> - "Open LiDAR / scan this room" → /room-capture
> - "What's the status on this job?" → project status
> - "Work on this change order" → draft/change-order flow
> - "Show me what needs review" → /relay
>
> Cost posture:
> - Default: transcription-only + intent routing.
> - Escalate to realtime conversation only when Right Hand needs dialogue.
> - Never leave a realtime session open after idle timeout.

The deployed `/right-hand` page was a useful hotfix, not the final interaction. The final interaction is a **global Right Hand voice overlay that starts listening the moment you tap the mic.**

---

## 2. Engineering grounding (what is real today)

| Piece | State today | Implication |
|---|---|---|
| Speak triggers (center mic, top-right RH, desktop FAB) | Plain `<a href="/right-hand">` in `SpeakFAB.astro`, `Layout.astro`, `MobileBottomNav.astro` | Convert to overlay openers; keep `href` as no-JS fallback. |
| Voice pipeline | `mic → MediaRecorder → POST /api/v1/transcribe → Groq Whisper turbo` (record-then-send, per `field-capture.astro`) | Reusable. Discrete clip transcription, not streaming. 503 if `GROQ_API_KEY` absent. |
| Intent classifier | Right Hand orchestrator skeleton (`src/agents/right-hand/orchestrator.ts`), runs **deterministic-fallback** in prod until Groq LLM is wired | V1 routing can be deterministic + honest; LLM intent is an upgrade, not a blocker. |
| LiDAR / room scan | `/room-capture` (F-RC1) **already built**, Apple-wrap: native iOS scan, Kerf renders post-scan value only | "Open LiDAR" routes to a real surface. No fake scan. |
| Live word-by-word caption | **Not built.** No Web Speech usage in repo. | See §3 — the one hard constraint. |

## 3. The one hard constraint: live caption on iPhone

Christian's "show live transcript" is trivial on desktop Chrome (free Web Speech API) but **`SpeechRecognition` is unsupported on iOS Safari / PWAs** — the actual target device. So on iPhone, live word-by-word text is **not free**. Two honest options:

- **Option A — Per-turn transcript (cheapest, no stream).** While listening: show an "active" state (animated mic + live audio-level meter + "Listening…"), no words mid-speech. On each 2–3s-silence commit, POST the turn clip to `/transcribe` and render the returned text. Real, no streaming session, lowest cost. Slight per-turn delay (~Whisper latency).
- **Option B — Live words (paid, bounded).** Open an OpenAI **realtime transcription-only** session (WebSocket/WebRTC + server VAD) for the duration of the bounded window; stream interim words; close hard on idle/cap. True live caption, low latency, but a paid streaming session — must stay strictly inside the bounded window (§4).

Both honor the cost posture. ~~**A is the recommended V1 default; B is the V2 upgrade where latency/feel justify it.**~~ **SUPERSEDED by §0 (2026-05-29): Option B is the V1 lane. Option A's record-then-send remains the consent/availability fallback (§9), not the default.**

## 4. Bounded window (never always-on)

Client-side VAD via Web Audio `AnalyserNode` on the mic stream:
- **2–3s silence** → commit current turn (transcribe + route classify).
- **10–15s no meaningful speech** → close the Right Hand session.
- **60–90s hard cap** → auto-stop, surface "Continue?" (no silent extension).
- If routed into LiDAR/room-scan, keep a lightweight annotation window open but **still silence-timeout it**.
- No background stream. Any realtime session (Option B) is torn down on idle/cap — never left open.

## 5. Safety guardrails (non-negotiable)

- **V4 recording consent:** mic permission prompt + an unmistakable "recording / Right Hand is listening" indicator the whole time. Starting capture on tap is fine *only* with the active indicator visible.
- **No fake transcript / no fake affordance:** the caption is real (on-device or server STT) or it shows status only — never invented words. Routing lands on real surfaces only.
- **No fake LiDAR:** scan stays Apple-native (F-RC1 Apple-wrap). The overlay routes to `/room-capture`; it does not simulate a scan.
- **No PII in URLs/logs:** route handoffs carry enums/ids, not transcript text in the querystring.
- **Honest intent authority:** when routing is deterministic (LLM not wired), say so; don't imply richer understanding than exists.

## 6. Routing map (all targets real today)

| Spoken intent | Route | Status |
|---|---|---|
| Job note / "take this down" | `/field-capture` | real |
| "Open LiDAR" / "scan this room" | `/room-capture` | real (Apple-wrap) |
| "Status on <job>" | project status surface | real (project page) |
| Change order | `/draft-review` (CO draft flow) | real |
| "What needs review" | `/relay` | real |
| Unclassified / low-confidence | keep overlay open, ask one clarifying question (orchestrator voice) | real |

## 7. Phasing — UPDATED per §0 lock (2026-05-29)

- **V1 (this lane):** global overlay; tap Speak → open + mic immediately + active indicator + level meter; bounded timeouts (§4); **Option B** bounded realtime transcription (`gpt-4o-transcribe`) for live words; deterministic/orchestrator intent → route into the real surfaces (§6); consequence-gated routing (§9). Groq record-then-send is the consent/availability fallback. Keep `/right-hand` page as no-JS fallback.
- **V2:** LLM-backed intent via the wired orchestrator (intent classification upgrade — routing surfaces are unchanged).
- **V3:** full speech-to-speech dialogue — only where Right Hand needs true back-and-forth; still bounded, never idle-open.

*(Prior phasing put Option B in V2; §0 pulled it forward to V1. The Option A per-turn
transcript is not deleted — it is the §9 fallback.)*

## 8. Open decision for Christian — RESOLVED 2026-05-29
~~Live caption approach for **V1**: **Option A (per-turn, cheapest)** vs **Option B (live words, bounded realtime, paid)**.~~ **Resolved: Option B (live words, bounded realtime). See §0.**

---

## 9. Two-lane consequence-gating (D-049 applied to transcription)

D-049's canon line governs this lane: *let Kerf be wrong where correction teaches it; never
let Kerf be wrong where consequence escapes review.* Applied to a streaming transcript, that
splits into two lanes off the **same** realtime session:

- **LIVE lane — interim words.** The realtime session's interim (non-final) transcript drives
  instant UI (caption) and a first-pass intent classification. Used to fire **reversible**
  actions immediately so the overlay feels live.
- **COMMIT lane — committed transcript.** When the realtime session commits a turn (its own
  server-VAD final, or our 2–3s-silence commit), the **committed** transcript is the only
  input allowed to drive **durable** actions.

**Routing rule:**

| Action | Reversible? | Lane | When it may fire |
|---|---|---|---|
| Open LiDAR / `/room-capture` | yes (navigation) | LIVE | from interim words, instantly |
| Status question (read-only) | yes | LIVE | from interim words, instantly |
| Open `/relay` | yes (navigation) | LIVE | from interim words, instantly |
| Open `/field-capture` (carry context) | yes (navigation) | LIVE | from interim words, instantly |
| Job note (persist) | no | COMMIT | only on committed transcript |
| Change order (draft → exec) | no | COMMIT | only on committed transcript |
| Estimate update | no | COMMIT | only on committed transcript |
| Job log write | no | COMMIT | only on committed transcript |
| Memory write | no | COMMIT | only on committed transcript |

**Never persist or synthesize from interim words.** Interim text may *navigate* (all targets
reversible, no state mutation), never *commit*.

**"Cleanup" = waiting for the realtime session's committed transcript. There is NO second API
call.** Do not add a speculative whole-clip transcription pass on top of the realtime final —
that double-bills. Add a second pass *only* if the realtime final proves inaccurate in
dogfood (then it becomes an explicit, measured decision, not a default).

## 10. Consent gating (which tenants get realtime)

Per D-049 §6, tenant captures may flow into a hosted model **only** when the tenant has
`tenant_synthesis_consent: true`. The realtime transcription session sends live mic audio to
OpenAI, so it is gated the same way:

- **Consenting tenant (GGR for V1):** realtime `gpt-4o-transcribe` session via the ephemeral-
  token endpoint (§11).
- **Non-consenting tenant:** **no realtime session is minted.** The overlay falls back to
  Groq record-then-send (`/api/v1/transcribe`, Whisper turbo) — record a clip, send on
  commit. Same honest UX, no live word-by-word, no audio streamed to OpenAI.

The consent decision is server-authoritative: the ephemeral-token endpoint returns
`403 { fallback: 'groq_record_then_send' }` for non-consenting tenants. The client never
decides its own eligibility.

## 11. Realtime safety guardrails (non-negotiable · gate-blocking)

1. **Ephemeral session token minted server-side.** The standing `OPENAI_API_KEY` is used only
   on the server to mint a short-lived realtime client secret; it is **never** sent to the
   client. The client receives only the ephemeral secret + bounded session config.
2. **Transcription-only session config.** The minted session is configured for transcription
   only — no speech-to-speech, no assistant audio output modality, ever. (`gpt-4o-transcribe`
   transcription intent; no `audio` output modality requested.)
3. **Bounded window enforced (§4):** 2–3s silence → commit turn · 10–15s idle → close
   session · 60–90s hard cap → auto-stop + "Continue?" · full teardown on overlay dismiss.
   No background or unbounded stream. Any realtime session is torn down on idle/cap/dismiss.
4. **Consent gated (§10):** GGR-only via `tenant_synthesis_consent`; other tenants fall back
   to Groq record-then-send.
5. **No raw realtime payload persisted unparsed.** Only the parsed committed transcript text
   crosses into durable actions; raw event frames are not stored. **No PII in URLs or logs** —
   route handoffs carry enums/ids, never transcript text in the querystring; logs record
   invocation ids and timings, never transcript content or audio bytes.

## 12. Server endpoint — ephemeral realtime transcription session

`POST /api/v1/realtime/transcription-session`

- **503** `{ error: 'realtime_not_configured' }` when `OPENAI_API_KEY` is absent → client
  uses Groq fallback.
- **403** `{ error: 'synthesis_consent_required', fallback: 'groq_record_then_send' }` when
  the tenant lacks `tenant_synthesis_consent` → client uses Groq fallback.
- **200** `{ client_secret, expires_at, model, session: { bounded window params }, endpoint }`
  — the ephemeral secret the browser uses to open the realtime connection, plus the bounded-
  window parameters (§4) the client must enforce. The standing key never appears in the
  response.
- Routed through the D-023 hosting registry (`openai://gpt-4o-transcribe-realtime`) before
  any upstream call, same discipline as `/api/v1/transcribe`.
