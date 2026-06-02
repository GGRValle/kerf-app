/** Phase 1I Batch B smoke */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createApiRouter } from "../src/api/router.js";
import { resetApiDepsForTests } from "../src/api/lib/deps.js";
import { createPersistenceEventStore } from "../src/persistence/eventStore.js";
import { validatePersistenceEvent } from "../src/persistence/events.js";
import { auditEntryLink } from "../src/app/lib/projectAuditLinks.js";

test("relay list links cards", async () => {
  const s = await readFile("src/app/pages/relay/index.astro", "utf8");
  assert.match(s, /attentionFromRelayCard/);
  assert.match(s, /card\.href = artifact\.href/);
});

test("relay pages build API URLs from origin so basic-auth URLs do not poison fetch", async () => {
  const list = await readFile("src/app/pages/relay/index.astro", "utf8");
  const detail = await readFile("src/app/pages/relay/[id].astro", "utf8");
  for (const source of [list, detail]) {
    assert.match(source, /new URL\(path, window\.location\.origin\)\.toString\(\)/);
    assert.doesNotMatch(source, /fetch\(`?\/api\/v1\/field-daily\/relay-feed/);
  }
});

test("relay review API", async () => {
  resetApiDepsForTests();
  const dir = await mkdtemp(path.join(tmpdir(), "1ib-"));
  process.env.PERSISTENCE_DIR = dir;
  const store = createPersistenceEventStore({ filepath: path.join(dir, "events.jsonl") });
  const ev = { event_id:"e1", type:"relay_card.surfaced", tenant_id:"tenant_ggr", correlation_id:"proj_wegrzyn_kitchen", actor:{id:"s",role:"owner"}, at:"2026-05-20T12:00:00.000Z", source_refs:[{kind:"voice",uri:"k",excerpt:"k"}], relay_card_id:"rcs1", entry_id:"dle1", surfaced_to:"office" };
  const v = validatePersistenceEvent(ev);
  if (v.ok) await store.append(v.event);
  const app = createApiRouter();
  const res = await app.request("/relay-cards/rcs1/review", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ tenant_id:"tenant_ggr", reviewer:"op", outcome:"acknowledged" }) });
  assert.equal(res.status, 200);
  resetApiDepsForTests();
  delete process.env.PERSISTENCE_DIR;
  await rm(dir, { recursive: true, force: true });
});

test("auditEntryLink", () => {
  const link = auditEntryLink({ kind:"relay_card.surfaced", event_id:"e", at:"t", actor_id:"a", relay_card_id:"r", entry_id:"dle", surfaced_to:"o" });
  assert.equal(link?.href, "/relay/dle");
});
