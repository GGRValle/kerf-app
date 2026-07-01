/**
 * Wall 2 · RBAC coverage guard — anti-regression net.
 *
 * Fails if any SENSITIVE operator route (money / margin / pay / sales / proposal
 * send / invoice / estimate / rate library) is registered WITHOUT an
 * authorizeCapability(...) guard in its handler body. Same discovery pattern the
 * tenant wall uses: the moment someone adds a new money/estimate/proposal route
 * and forgets the gate, CI fails here instead of the reviewer's eye.
 *
 * Scans EVERY file in src/api/routes, so a sensitive route added to a new file
 * is caught too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, 'src/api/routes');

// Route paths that touch money / margin / pay / sales / proposal-send.
const SENSITIVE =
  /(\/money\b|invoice|estimate|\/proposals?\/|rate-standard|\/kb\/|\/sales\/deals|\/deals\/[^'"]*\/convert|team-ops\/compliance|draft\/accept)/;

// Intentionally ungated sensitive-looking routes (exact path → reason). Empty
// today — add here ONLY with an explicit justification, never to silence a miss.
const ALLOW_UNGATED = new Map<string, string>([]);

const REGISTRATION = /(\w+Routes)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join('src/api/routes', f));
}

test('every sensitive operator route gates on a capability (RBAC coverage guard)', () => {
  const violations: string[] = [];
  let sensitiveSeen = 0;

  for (const rel of routeFiles()) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    const marks: { method: string; route: string; index: number }[] = [];
    let m: RegExpExecArray | null;
    REGISTRATION.lastIndex = 0;
    while ((m = REGISTRATION.exec(src)) !== null) {
      marks.push({ method: m[2], route: m[3], index: m.index });
    }
    for (let i = 0; i < marks.length; i++) {
      const { method, route, index } = marks[i];
      if (!SENSITIVE.test(route)) continue;
      if (ALLOW_UNGATED.has(route)) continue;
      sensitiveSeen += 1;
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
      const body = src.slice(index, end);
      if (!body.includes('authorizeCapability')) {
        violations.push(`${rel} :: ${method.toUpperCase()} ${route}`);
      }
    }
  }

  // The guard is only meaningful if it actually saw sensitive routes.
  assert.ok(sensitiveSeen >= 20, `expected to scan >=20 sensitive routes, saw ${sensitiveSeen}`);
  assert.deepEqual(
    violations,
    [],
    `Sensitive routes missing an authorizeCapability guard:\n  ${violations.join('\n  ')}`,
  );
});
