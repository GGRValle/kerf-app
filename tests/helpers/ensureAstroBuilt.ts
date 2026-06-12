import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ASTRO_ENTRY = 'dist/astro/server/entry.mjs';
const BUILD_LOCK = '.tmp-astro-build.lock';

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeClearStaleLock(lockDir: string): Promise<void> {
  try {
    const info = await stat(lockDir);
    if (Date.now() - info.mtimeMs > 120_000) {
      await rm(lockDir, { recursive: true, force: true });
    }
  } catch {
    // No lock to clear.
  }
}

export async function ensureAstroBuilt(repoRoot: string): Promise<void> {
  const astroEntry = path.join(repoRoot, ASTRO_ENTRY);
  if (await exists(astroEntry)) return;

  const lockDir = path.join(repoRoot, BUILD_LOCK);
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    if (await exists(astroEntry)) return;
    await maybeClearStaleLock(lockDir);

    try {
      await mkdir(lockDir);
    } catch {
      await sleep(250);
      continue;
    }

    try {
      if (await exists(astroEntry)) return;
      const build = spawn('npm', ['run', 'build:astro'], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, KERF_DISABLE_LIVE_MODELS: '1' },
      });
      await new Promise<void>((resolve, reject) => {
        build.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`build:astro exited ${code}`)),
        );
        build.on('error', reject);
      });
      return;
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  throw new Error(`Astro build did not become ready at ${astroEntry}`);
}
