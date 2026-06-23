/**
 * Field Hand mobile home — role-root surface, not a form-first dashboard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('Field Hand home renders a real capture-first mobile surface instead of the role-home stub', () => {
  const component = read('src/app/components/FieldHandHomeSurface.astro');
  const roleHome = read('src/app/components/RoleHomeSurface.astro');
  const page = read('src/app/pages/home/field.astro');

  assert.match(roleHome, /FieldHandHomeSurface/);
  assert.match(page, /wireframeOverride="F-C1"/);
  assert.doesNotMatch(page, /NavBack/);

  assert.match(component, /Field Hand/);
  assert.match(component, /Today on site/);
  assert.match(component, /Capture first/);
  assert.match(component, /\/camera/);
  assert.match(component, /Active job/);
  assert.match(component, /Daily log/);
  assert.match(component, /Waiting/);
  assert.match(component, /Recent proof/);
  assert.match(component, /data-grammar="canon"/);
});

test('Field Hand home stays field-scoped: no sales, money, or form-first copy', () => {
  const component = read('src/app/components/FieldHandHomeSurface.astro');
  assert.doesNotMatch(component, /\bmoney\b/i);
  assert.doesNotMatch(component, /\bsales\b/i);
  assert.doesNotMatch(component, /Fill out|Complete the form|Submit form/i);
  assert.match(component, /Field Hand turns the proof into the next safe step/);
  assert.doesNotMatch(component, /Right Hand turns the proof/i);
});
