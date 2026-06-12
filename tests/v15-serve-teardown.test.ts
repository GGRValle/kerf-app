import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnServeV15Process } from './helpers/serveV15.ts';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      })
      .on('error', reject);
  });
}

async function waitForReady(port: number, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await httpGet(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`server never ready on ${port}`);
}

test('serve-v15 exits when the parent-owned stdin pipe closes', async () => {
  const port = 18_900 + Math.floor(Math.random() * 600);
  const child = spawnServeV15Process({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      KERF_DISABLE_LIVE_MODELS: '1',
    },
  });

  try {
    await waitForReady(port);
    const exited = once(child, 'exit');
    child.stdin.end();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('serve-v15 stayed alive after stdin close')), 5_000).unref();
    });
    const [code, signal] = await Promise.race([exited, timeout]) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, null);
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
});

test('serve-v15 orphan guard includes ppid reparent fallback', () => {
  const src = readFileSync(
    new URL('../scripts/serve-v15-vertical-slice.ts', import.meta.url),
    'utf8',
  );
  assert.match(src, /KERF_PARENT_STDIN_WATCH/);
  assert.match(src, /process\.ppid !== 1/);
  assert.match(src, /process\.ppid === 1/);
});

test('serveV15 helper SIGKILL-reaps still-live children on process exit (skipped-teardown path)', () => {
  const src = readFileSync(new URL('./helpers/serveV15.ts', import.meta.url), 'utf8');
  assert.match(src, /liveChildren\.add\(child\)/);
  assert.match(src, /process\.once\('exit'/);
  assert.match(src, /killLiveChildren\('SIGKILL'\)/);
});

test('integration tests spawn serve-v15 only through tests/helpers/serveV15.ts', () => {
  const testsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
  const directSpawn = /spawn\s*\(\s*['"]node['"][\s\S]*serve-v15-vertical-slice\.ts/;
  for (const name of readdirSync(testsDir)) {
    if (!name.endsWith('.test.ts') || name === 'v15-serve-teardown.test.ts') {
      continue;
    }
    const filePath = path.join(testsDir, name);
    const src = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      src,
      directSpawn,
      `${name} must use spawnServeV15Process from tests/helpers/serveV15.ts`,
    );
  }
});
