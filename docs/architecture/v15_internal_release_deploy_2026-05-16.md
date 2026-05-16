# V1.5 Internal Release — Fly.io deploy runbook

- **Date:** 2026-05-16
- **Author:** Claude (orchestrator), Step C.4 pull-forward
- **Status:** First-deploy runbook for the GGR/Valle internal release demo. **Single-tenant + single-operator; no real auth — basic-auth only.** V2.0 will replace this with proper auth + database persistence.
- **Audience:** Christian (operator). Some steps require your Fly.io account + credit card; nobody else can run them for you.

---

## 1. Why Fly.io (not Vercel)

The V1.5 serve script (`scripts/serve-v15-vertical-slice.ts`) is a long-running Node process that owns:
- A JSONL event log at `<PERSISTENCE_DIR>/events.jsonl`
- A per-project projection cache at `<PERSISTENCE_DIR>/projects/<tenant>/<project>/index.json`

Both of these need to **survive container restarts**. Vercel's serverless model doesn't fit:
- No persistent local filesystem
- Cold start per request would break the JSONL append pattern
- Would require externalizing storage (S3 + Postgres) — that's V2.0 work

Fly.io runs long-running Node processes natively + supports persistent volume mounts. ~$5-10/month at V1.5 scale.

---

## 2. One-time setup (you, on your laptop)

### 2.1 Install the Fly CLI
```bash
brew install flyctl
fly auth login                # opens browser; sign in or create account
fly auth whoami               # confirms logged in
```

You'll need to add a credit card to your Fly account — billing is metered (free tier covers the V1.5 demo footprint, but they require a card on file).

### 2.2 Create the app
From the repo root:
```bash
fly launch --no-deploy --copy-config --name kerf-v15-internal --region lax
```

This reads the existing `fly.toml` (don't let it overwrite). Confirms region `lax` (Los Angeles, closest to GGR San Diego). `--no-deploy` skips the actual deploy — we have more setup to do first.

### 2.3 Create the persistent volume
```bash
fly volumes create kerf_data --region lax --size 1
```

1 GB volume in LA. Costs ~$0.15/month. Bump to `--size 3` if the event log starts hitting the cap (you'll have to make a LOT of voice captures to fill 1 GB).

### 2.4 Set required secrets

**Whisper transcription** (transcribes voice captures to text — without these, `/transcribe` returns 503 and you'd have to type transcripts in):
```bash
fly secrets set GROQ_API_KEY=<your-groq-key>
fly secrets set GROQ_BASE_URL=https://api.groq.com/openai/v1
```

**Basic auth** (gates the public URL — without these, anyone who finds the URL can see your data):
```bash
# Pick strong values you'll actually remember
fly secrets set BASIC_AUTH_USER=ggr_demo
fly secrets set BASIC_AUTH_PASS=<long-random-passphrase>
```

Verify:
```bash
fly secrets list
```
Should show all four. Values are masked.

---

## 3. First deploy

```bash
fly deploy --remote-only
```

Fly's remote builder packages the repo (filtered by `.dockerignore`), builds the multi-stage Dockerfile, pushes to the registry, and launches the VM. Takes 2-5 minutes the first time.

Output ends with:
```
Visit your newly deployed app at https://kerf-v15-internal.fly.dev
```

That's your URL. Bookmark it.

### 3.1 Health check
```bash
curl https://kerf-v15-internal.fly.dev/health
```

Returns:
```json
{"ok":true,"service":"kerf-v15-internal","auth_enabled":true}
```

`/health` is the only unauthenticated route (Fly's HTTP checker needs it). Everything else requires the basic-auth credentials you set.

### 3.2 First authenticated check
```bash
curl -u ggr_demo:<your-pass> https://kerf-v15-internal.fly.dev/api/projects
```

Returns `{"projects":[]}` on a fresh deploy. After you create a project via the office UI or curl POST, it appears here.

### 3.3 Tail logs
```bash
fly logs                      # follow logs in real time
```

Useful when something's wrong. Quit with Ctrl-C.

---

## 4. iPhone demo flow

1. On your iPhone, open Safari and navigate to `https://kerf-v15-internal.fly.dev/field`
2. Browser prompts for basic-auth credentials — enter `ggr_demo` + your passphrase
3. **Tap Share → Add to Home Screen.** iPhone creates a Kerf icon. Open it for an app-like full-screen experience (no Safari chrome).
4. Pick a project from the dropdown (create one via the office side first — see §5)
5. Tap the voice button, dictate a daily-log entry. Whisper transcribes (~2-3s).
6. Tap Submit.

What happens server-side:
- `POST /api/projects/<id>/daily-log/entries` writes `daily_log.entry_captured`
- Scheduler (PR #200) runs play + drift inline → writes `daily_log.facts_extracted` + (if drift fires) `daily_log.drift_detected`
- C.1 surfacing play (PR #206) runs inline → writes `relay_card.surfaced` if the rule table fires
- Confirmation block shows on your iPhone with the event ID

5. From a laptop, hit `https://kerf-v15-internal.fly.dev/relay` (same credentials). The card surfaces.
6. Click into the detail view, click 'Mark reviewed → actioned'. POST to B.6, `relay_card.reviewed` written. Loop closed.

---

## 5. Create your first project

The /field UI requires a project to exist before you can capture against it. Create one via curl:

```bash
curl -u ggr_demo:<your-pass> \
  -X POST https://kerf-v15-internal.fly.dev/api/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "tenant_ggr",
    "project_id": "proj_henderson_bath",
    "project_name": "Henderson bath remodel",
    "client_name": "Henderson Family"
  }'
```

Then refresh /field on your phone — the project appears in the switcher.

---

## 6. Cost expectations (V1.5 scale)

| Line item | Monthly |
|---|---|
| Shared-cpu-1x, 512MB, single instance | ~$2-3 (mostly idle; auto-stops when no traffic) |
| 1GB volume | ~$0.15 |
| HTTPS / domain (`*.fly.dev`) | $0 |
| Outbound bandwidth (V1.5 demo volume) | likely <$1 |
| **Total** | **~$5-10/month** |

Free tier may cover most or all of it. Track usage in the Fly dashboard.

---

## 7. Updating after a code merge

When you merge a PR to `main`:

```bash
git checkout main
git pull origin main
fly deploy --remote-only
```

Fly does a rolling deploy. Zero downtime. The persistent volume carries your event log across versions.

**Roll back** if a deploy breaks something:
```bash
fly releases                  # list releases
fly deploy --image registry.fly.io/kerf-v15-internal:deployment-<id>
```

---

## 8. Pulling event log data back to your laptop

The JSONL event log lives on the Fly volume at `/data/.kerf/events.jsonl`. To inspect or back up:

```bash
fly ssh console
cat /data/.kerf/events.jsonl
# or
fly ssh sftp shell             # SFTP shell to grab files
get /data/.kerf/events.jsonl ./events-backup-$(date +%Y-%m-%d).jsonl
```

For ongoing backup, set up a cron locally:
```bash
# In a local crontab — every night at 2am, pull a backup
0 2 * * *  fly ssh sftp shell <<EOF
get /data/.kerf/events.jsonl /Users/christianasdal/kerf-backups/events-$(date +\%Y-\%m-\%d).jsonl
EOF
```

---

## 9. What this deploy does NOT include (V2.0+)

- **Real auth / user accounts** — basic auth only. Anyone with the credentials gets full access.
- **Database persistence** — events stay on the Fly volume; if the volume corrupts, restore from backup
- **Multi-tenant routing** — single-tenant V1.5 (`tenant_ggr` is the only tenant the endpoints accept; `tenant_valle` is in the type system but no project flow uses it on the deployed instance)
- **Observability / alerting** — `fly logs` only
- **Custom domain** — `*.fly.dev` is fine for the internal demo; V2.0 sets up `kerf.ggrremodel.com` or similar
- **Auto-scaling** — `min_machines_running = 0`, scales to one VM on demand; bump to 1 if cold starts (3-5s) hurt
- **Backup automation** — manual SFTP pull for now (see §8)

---

## 10. Troubleshooting

### "App not responding" / 502 errors
```bash
fly status                    # is the VM up?
fly logs                      # what's it saying?
fly machines list             # any stopped machines?
fly machines start <id>       # restart a stopped one
```

### "Health checks failing"
Most likely cause: basic auth misconfigured and `/health` got accidentally gated. Verify:
```bash
curl https://kerf-v15-internal.fly.dev/health   # MUST return 200 with no auth
```

If this fails, you've got a real bug — open an issue. `/health` is supposed to bypass auth.

### "Volume full"
```bash
fly volumes list              # check size + used
fly volumes extend <id> --size 3   # extend to 3GB
```

### "Whisper transcribe returns 503"
Means `GROQ_API_KEY` or `GROQ_BASE_URL` isn't set. Re-run §2.4 secrets.

The /field UI falls back to a typed-transcript textarea labeled "TYPE TRANSCRIPT (testing only)" — so you can still demo without Whisper if needed.

### "I forgot the basic-auth password"
```bash
fly secrets set BASIC_AUTH_PASS=<new-password>
# Triggers a rolling deploy with the new secret. Old credentials stop working.
```

---

## 11. Tear down (if you want to nuke the deploy)

```bash
fly apps destroy kerf-v15-internal
# Confirms volume + secrets + DNS removal
```

Don't do this unless you mean it — the event log is gone (unless you have backups per §8).

---

## 12. The June 13 acceptance test

Acceptance for the V1.5 internal release gate:

> Christian or Kevin Cheeseman opens https://kerf-v15-internal.fly.dev/field on iPhone from the Henderson job site (cellular, not wifi). Voice-captures a `progress_update` entry. Within 5 seconds, the office side sees the card at https://kerf-v15-internal.fly.dev/relay with the correct drift severity. One click marks reviewed. Audit trail one click deep.

If that runs end-to-end without a developer in the loop, V1.5 internal release is operational.
