#!/usr/bin/env node
/**
 * CI guard — missing bindings in Astro client `<script>` blocks.
 *
 * Why this exists
 * ---------------
 * #386 used `selectedProjectClient` in six places inside camera.astro's client
 * `<script>` but never declared it. That shipped GREEN because:
 *   - esbuild/Vite bundling does NOT resolve identifiers — an undeclared name
 *     is assumed to be a runtime global, so the bundle builds fine;
 *   - `tsc --noEmit` (the verify job's `typecheck` step) never parses `.astro`
 *     files at all, so it never saw the script;
 *   - the camera conformance tests only `readFileSync` the `.astro` source and
 *     string-match — they never execute the bundled client JS.
 * In the browser the bundled ES module runs in strict mode, so reading the
 * undeclared name threw `ReferenceError: selectedProjectClient is not defined`
 * at init, blanking the live camera until #389 declared the variable.
 *
 * What this guard does
 * --------------------
 * Runs `astro check`, which DOES type-check `.astro` `<script>` bodies, and an
 * undeclared variable surfaces there as a TypeScript diagnostic. The repo
 * currently carries ~139 pre-existing `astro check` diagnostics that are style
 * noise rather than runtime bugs (implicit-any on the plain-JS client scripts:
 * ts7005/7006/7034), so we do NOT fail on the whole result. Instead we fail
 * ONLY on the small, high-signal set of codes that mean "this identifier will
 * not exist at runtime" — the ReferenceError class. These codes are not
 * governed by `strict`/`noImplicitAny`, so they stay pure signal.
 *
 * Scope: `.astro` files only. `tsc --noEmit` already covers `.ts`/`.tsx` in the
 * verify job; this guard closes the `.astro` blind spot it cannot see.
 *
 * Exit codes: 0 = clean · 1 = missing-binding diagnostic found (block merge) ·
 * 2 = `astro check` failed to run to completion (tooling problem, not a pass).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// "This binding will not exist at runtime" — the ReferenceError class.
const RUNTIME_BINDING_CODES = new Set([
  2304,  // Cannot find name 'X'.
  2552,  // Cannot find name 'X'. Did you mean 'Y'?
  2448,  // Block-scoped variable 'X' used before its declaration.
  2454,  // Variable 'X' is used before being assigned.
  18004, // No value exists in scope for the shorthand property 'X'.
]);

const res = spawnSync(
  process.execPath,
  [path.join('node_modules', 'astro', 'astro.js'), 'check'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    // NO_COLOR/FORCE_COLOR keep the output plain so the diagnostic lines parse
    // deterministically across local (TTY) and CI (non-TTY) runs.
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    maxBuffer: 128 * 1024 * 1024,
  },
);

if (res.error) {
  console.error('[astro-script-guard] could not run `astro check`:', res.error.message);
  process.exit(2);
}

// Strip any residual ANSI, then require the completion summary so a crash that
// emits no diagnostics can never read as a false PASS.
const out = `${res.stdout || ''}\n${res.stderr || ''}`.replace(/\x1B\[[0-9;]*m/g, '');
if (!/Result \(\d+ files\)/.test(out)) {
  console.error('[astro-script-guard] `astro check` did not complete (no result summary). Tail of output:\n');
  console.error(out.split('\n').slice(-30).join('\n'));
  process.exit(2);
}

// e.g. "src/app/pages/camera.astro:216:9 - error ts(2304): Cannot find name 'x'."
const LINE_RE = /^(\S.*?\.astro):(\d+):(\d+)\s+-\s+error\s+ts\((\d+)\):\s+(.*)$/;
const offenders = [];
for (const line of out.split('\n')) {
  const m = LINE_RE.exec(line.trim());
  if (!m) continue;
  const [, file, ln, col, code, message] = m;
  if (!RUNTIME_BINDING_CODES.has(Number(code))) continue;
  offenders.push(`  ${file}:${ln}:${col}  ts(${code})  ${message}`);
}

if (offenders.length === 0) {
  console.log('[astro-script-guard] OK — no missing-binding diagnostics in .astro client scripts.');
  process.exit(0);
}

console.error(
  `[astro-script-guard] FAIL — ${offenders.length} missing-binding diagnostic(s) in Astro client scripts.\n\n` +
    'These bundle clean and pass `tsc --noEmit` (tsc never parses .astro), then throw\n' +
    '`ReferenceError: <name> is not defined` in the browser at runtime — the #386 class:\n',
);
console.error(offenders.join('\n'));
console.error('\nFix: declare the binding in scope (see #389 for the selectedProjectClient fix) or remove the reference.');
process.exit(1);
