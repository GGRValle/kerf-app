/**
 * Phase 1D L0.4 harden · AST-walker tests for SurfaceIrreversibilityWrap
 * actionContext copy.
 *
 * Companion to `tests/surface-irreversibility-wrap.test.ts` (regex-based,
 * call-site shape only). This test resolves each actionContext expression
 * to a concrete string (literal · t() call · identifier binding) and
 * rejects boilerplate copy regardless of call-site form.
 *
 * Both checks stay live. The regex check enforces call-site i18n compatibility
 * (rule #10); the AST walker enforces semantic-correctness of the resolved
 * copy (Codex-banked discipline: "semantic vs syntactic validator gap").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOILERPLATE_PATTERNS,
  MIN_SUBSTANTIVE_LENGTH,
  loadI18nKeysFromEnFile,
  resolveActionContextsInDir,
  validateActionContextCopy,
  walkAstroFiles,
} from '../src/app/lib/actionContextResolver.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PAGES_ROOT = path.resolve(__dirname, '../src/app/pages');
const I18N_EN_PATH = path.resolve(__dirname, '../src/i18n/en.ts');
const BAD_FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/bad-actioncontext');

// ============================================================================
// validator unit tests · zero I/O
// ============================================================================

test('validator · rejects empty string', () => {
  const result = validateActionContextCopy('');
  assert.equal(result.ok, false);
});

test('validator · rejects whitespace-only string', () => {
  const result = validateActionContextCopy('   \n  ');
  assert.equal(result.ok, false);
});

test('validator · rejects boilerplate "Are you sure?"', () => {
  const result = validateActionContextCopy('Are you sure?');
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /boilerplate/);
});

test('validator · rejects boilerplate "This action cannot be undone."', () => {
  const result = validateActionContextCopy('This action cannot be undone.');
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /boilerplate/);
});

test('validator · rejects bare "Confirm?"', () => {
  const result = validateActionContextCopy('Confirm?');
  assert.equal(result.ok, false);
});

test('validator · rejects bare "Continue?"', () => {
  const result = validateActionContextCopy('Continue?');
  assert.equal(result.ok, false);
});

test('validator · rejects too-short substantive copy', () => {
  const result = validateActionContextCopy('Send now.');
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /too short/);
});

test('validator · rejects copy missing an action verb', () => {
  // 30+ chars · has artifact noun (proposal) · no action verb in the lists
  const result = validateActionContextCopy(
    'The proposal · the client · downstream context',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /action verb/);
});

test('validator · rejects copy missing an artifact noun', () => {
  // 30+ chars · has action verb (sending) · no artifact noun in the lists
  const result = validateActionContextCopy(
    'Sending and locking and finalizing across the system',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /artifact noun/);
});

test('validator · accepts substantive copy with verb + noun', () => {
  const result = validateActionContextCopy(
    'Sending locks this proposal version · the client sees it · downstream invoices reference this draft.',
  );
  assert.equal(result.ok, true);
});

test('validator · BOILERPLATE_PATTERNS list is non-empty', () => {
  assert.ok(BOILERPLATE_PATTERNS.length > 0);
});

test('validator · MIN_SUBSTANTIVE_LENGTH is sane (≥ 20)', () => {
  assert.ok(MIN_SUBSTANTIVE_LENGTH >= 20);
});

// ============================================================================
// walker · file discovery
// ============================================================================

test('walker · skips Astro-private directories (leading underscore) by default', async () => {
  const files = await walkAstroFiles(APP_PAGES_ROOT);
  for (const file of files) {
    const rel = path.relative(APP_PAGES_ROOT, file);
    assert.ok(
      !rel.split(path.sep).some((seg) => seg.startsWith('_')),
      `walker should skip Astro-private dirs but included: ${rel}`,
    );
  }
});

test('walker · finds at least one .astro file under src/app/pages/', async () => {
  const files = await walkAstroFiles(APP_PAGES_ROOT);
  assert.ok(files.length > 0, 'expected at least one .astro file in src/app/pages/');
});

// ============================================================================
// i18n key loader
// ============================================================================

test('i18n loader · extracts Lane 1 key f_e1.state3.irreversibility.action_context', async () => {
  const keys = await loadI18nKeysFromEnFile(I18N_EN_PATH);
  const value = keys.get('f_e1.state3.irreversibility.action_context');
  assert.ok(value, 'key should be present in en.ts');
  assert.match(value ?? '', /Daily Log/);
});

test('i18n loader · extracts Lane 1 key f_rc1.release.action_context', async () => {
  const keys = await loadI18nKeysFromEnFile(I18N_EN_PATH);
  const value = keys.get('f_rc1.release.action_context');
  assert.ok(value, 'key should be present in en.ts');
  assert.match(value ?? '', /fab/);
});

// ============================================================================
// end-to-end · live surfaces pass validation
// ============================================================================

test('AST walker · all irreversibility wraps in src/app/pages/ resolve to concrete strings', async () => {
  const i18nKeys = await loadI18nKeysFromEnFile(I18N_EN_PATH);
  const resolved = await resolveActionContextsInDir(APP_PAGES_ROOT, { i18nKeys });
  assert.ok(resolved.length > 0, 'expected at least one irreversibility wrap on live surfaces');
  for (const r of resolved) {
    assert.equal(
      r.status,
      'resolved',
      `${path.relative(APP_PAGES_ROOT, r.file)}:${r.line} ${r.expression} · ${r.reason ?? ''}`,
    );
    assert.ok(r.resolved, 'resolved entry must carry concrete string');
  }
});

test('AST walker · every resolved actionContext passes validation (no boilerplate, substantive)', async () => {
  const i18nKeys = await loadI18nKeysFromEnFile(I18N_EN_PATH);
  const resolved = await resolveActionContextsInDir(APP_PAGES_ROOT, { i18nKeys });
  for (const r of resolved) {
    if (r.status !== 'resolved' || !r.resolved) continue;
    const validation = validateActionContextCopy(r.resolved);
    assert.equal(
      validation.ok,
      true,
      `${path.relative(APP_PAGES_ROOT, r.file)}:${r.line} validation failed: ${validation.reason}\n  resolved: "${r.resolved}"`,
    );
  }
});

// ============================================================================
// end-to-end · bad fixture is rejected (red→green proves the check fires)
// ============================================================================

test('AST walker · bad fixture surfaces wraps and validator rejects every one', async () => {
  const resolved = await resolveActionContextsInDir(BAD_FIXTURE_ROOT);
  assert.ok(
    resolved.length >= 3,
    `expected ≥ 3 wraps in bad fixture, got ${resolved.length}`,
  );

  // Every resolved entry must FAIL validation (or be missing/unresolved).
  for (const r of resolved) {
    if (r.status === 'missing' || r.status === 'unresolved') {
      // Walker-level rejection — counts as the check firing.
      continue;
    }
    const validation = validateActionContextCopy(r.resolved ?? '');
    assert.equal(
      validation.ok,
      false,
      `bad fixture line ${r.line} should fail validation but passed: "${r.resolved}"`,
    );
  }
});

test('AST walker · bad fixture contains a "missing" entry (empty braces case)', async () => {
  const resolved = await resolveActionContextsInDir(BAD_FIXTURE_ROOT);
  const missing = resolved.filter((r) => r.status === 'missing');
  assert.ok(
    missing.length >= 1,
    'expected at least one missing entry (actionContext={}) in bad fixture',
  );
});

test('AST walker · bad fixture contains a boilerplate-rejection entry', async () => {
  const resolved = await resolveActionContextsInDir(BAD_FIXTURE_ROOT);
  const boilerplate = resolved
    .filter((r) => r.status === 'resolved' && r.resolved)
    .map((r) => ({ r, v: validateActionContextCopy(r.resolved ?? '') }))
    .filter(({ v }) => !v.ok && (v.reason ?? '').includes('boilerplate'));
  assert.ok(
    boilerplate.length >= 1,
    'expected at least one boilerplate-rejection in bad fixture',
  );
});

test('AST walker · bad fixture contains a too-short-rejection entry', async () => {
  const resolved = await resolveActionContextsInDir(BAD_FIXTURE_ROOT);
  const tooShort = resolved
    .filter((r) => r.status === 'resolved' && r.resolved)
    .map((r) => ({ r, v: validateActionContextCopy(r.resolved ?? '') }))
    .filter(({ v }) => !v.ok && (v.reason ?? '').includes('too short'));
  assert.ok(
    tooShort.length >= 1,
    'expected at least one too-short-rejection in bad fixture',
  );
});
