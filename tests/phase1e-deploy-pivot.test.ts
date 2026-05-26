import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('Phase 1E Dockerfile deploys the Astro + Hono shell, not the v15 demo server', async () => {
  const dockerfile = await readFile(path.join(process.cwd(), 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /npm run build:astro/);
  assert.match(dockerfile, /COPY --from=build \/app\/dist \.\/dist/);
  assert.match(dockerfile, /scripts\/serve-kerf-shell\.ts/);
  assert.doesNotMatch(dockerfile, /CMD \["node", "--import", "tsx", "scripts\/serve-v15-vertical-slice\.ts"\]/);
});

test('Phase 1E shell server enforces basic auth before Astro pages when configured', async () => {
  const source = await readFile(path.join(process.cwd(), 'scripts/serve-kerf-shell.ts'), 'utf8');
  assert.match(source, /BASIC_AUTH_ENABLED/);
  assert.match(source, /WWW-Authenticate/);
  assert.match(source, /pathname !== '\/health'/);
});
