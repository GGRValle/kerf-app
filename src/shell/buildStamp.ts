import { execSync } from 'node:child_process';

/** Served on `/health` and `/api/v1/health` for lane report-back gates. */
export interface BuildStamp {
  readonly commit: string;
  readonly dirty: boolean;
  readonly source: 'git' | 'env' | 'unknown';
}

function parseDirtyEnv(raw: string | undefined): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

export function readBuildStamp(): BuildStamp {
  const envCommit = process.env['KERF_BUILD_COMMIT']?.trim();
  const envDirty = parseDirtyEnv(process.env['KERF_BUILD_DIRTY']);
  if (envCommit) {
    const sourceRaw = process.env['KERF_BUILD_SOURCE'];
    const source =
      sourceRaw === 'git' || sourceRaw === 'env' ? sourceRaw : 'env';
    return {
      commit: envCommit,
      dirty: envDirty ?? true,
      source,
    };
  }
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const dirty =
      execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty, source: 'git' };
  } catch {
    return { commit: 'unknown', dirty: true, source: 'unknown' };
  }
}

export function buildStampPayload(stamp: BuildStamp): Record<string, unknown> {
  return {
    ok: true,
    service: 'kerf-shell',
    commit: stamp.commit,
    dirty: stamp.dirty,
    build: {
      commit: stamp.commit,
      dirty: stamp.dirty,
      source: stamp.source,
    },
  };
}
