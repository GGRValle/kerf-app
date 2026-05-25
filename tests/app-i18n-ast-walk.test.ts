import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_ROOT = join(process.cwd(), 'src/app');
const LANE_C_AST_PATHS = ['layouts/Layout.astro', 'pages/role-routing.astro'];
const INLINE_LITERAL = />([^<{][^<{}]{2,}?)</g;

function stripFrontmatter(s: string): string {
  if (!s.startsWith('---')) return s;
  const end = s.indexOf('---', 3);
  return end === -1 ? s : s.slice(end + 3);
}

function collectViolations(filePath: string): string[] {
  const rel = relative(APP_ROOT, filePath);
  const body = stripFrontmatter(readFileSync(filePath, 'utf8')).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const violations: string[] = [];
  for (const match of body.matchAll(INLINE_LITERAL)) {
    const text = match[1].trim();
    if (!text || !/[a-zA-Z]{2,}/.test(text)) continue;
    if (/^[\d\s:.,\-–—/()]+$/.test(text)) continue;
    violations.push(`${rel}: "${text}"`);
  }
  return violations;
}

test('app i18n AST walk · Lane C Astro surfaces have no inline user-facing literals', () => {
  const violations = LANE_C_AST_PATHS.flatMap((rel) => collectViolations(join(APP_ROOT, rel)));
  assert.deepEqual(violations, []);
});

test('app i18n AST walk · registry lists Lane C Astro paths under src/app', () => {
  for (const rel of LANE_C_AST_PATHS) assert.ok(statSync(join(APP_ROOT, rel)).isFile());
});
