import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Served on `/health` and `/api/v1/health` for lane report-back gates. */
export interface BuildStamp {
  readonly commit: string;
  readonly dirty: boolean;
  readonly source: 'image' | 'git' | 'env' | 'fly_image' | 'unknown';
}

export interface ReadBuildStampOptions {
  readonly imageStampPath?: string;
}

function parseDirtyEnv(raw: string | undefined): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

const DEFAULT_IMAGE_STAMP_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../build-stamp.json',
);

function parseImageBuildStamp(raw: string): BuildStamp | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const commit = typeof parsed['commit'] === 'string' ? parsed['commit'].trim() : '';
    const dirty = parsed['dirty'];
    if (!commit || typeof dirty !== 'boolean') return null;
    return { commit, dirty, source: 'image' };
  } catch {
    return null;
  }
}

function readImageBuildStamp(stampPath = DEFAULT_IMAGE_STAMP_PATH): BuildStamp | null {
  if (!existsSync(stampPath)) return null;
  return parseImageBuildStamp(readFileSync(stampPath, 'utf8'));
}

export function readBuildStamp(options: ReadBuildStampOptions = {}): BuildStamp {
  const imageStamp = readImageBuildStamp(options.imageStampPath);
  if (imageStamp) return imageStamp;

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
  const flyImageRef = process.env['FLY_IMAGE_REF']?.trim();
  if (flyImageRef) {
    return { commit: flyImageRef, dirty: true, source: 'fly_image' };
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
