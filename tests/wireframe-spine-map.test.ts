import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  EXTERNAL_OR_MISSING_CANON_FACES,
  WIREFRAME_REFERENCE_MAP,
  WIREFRAME_SPINE_MAP,
} from '../src/app/lib/wireframeSpineMap.js';

const ROOT = process.cwd();

function normalizeRegisteredRoute(route: string): string {
  return route.replace(/\[([^\]]+)\]/g, ':$1');
}

function astroPageRoute(rel: string): string {
  const noExt = rel.replace(/\.astro$/, '');
  const parts = noExt.split('/');
  if (parts[parts.length - 1] === 'index') parts.pop();
  const route = `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/\[([^\]]+)\]/g, ':$1');
  return route === '/' ? '/' : route.replace(/\/$/, '');
}

function appPageFiles(): string[] {
  const dir = path.join(ROOT, 'src/app/pages');
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f))
    .filter((rel) => rel.endsWith('.astro'))
    .filter((rel) => !rel.startsWith('_kit/'))
    .sort();
}

function registeredRoutesFromSource(): string[] {
  const files = ['src/shell/surfaceCatalog.ts', 'src/sales/surfaces.ts'];
  const routes = new Set<string>();
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(/route:\s*['"]([^'"]+)['"]/g)) {
      routes.add(normalizeRegisteredRoute(match[1]));
    }
    for (const match of source.matchAll(/reg\([^,]+,\s*['"]([^'"]+)['"]/g)) {
      routes.add(normalizeRegisteredRoute(match[1]));
    }
  }
  return [...routes].sort();
}

test('wireframe spine map entries are unique and app files exist', () => {
  const routes = WIREFRAME_SPINE_MAP.map((entry) => entry.route);
  assert.equal(new Set(routes).size, routes.length, 'wireframe spine route entries must be unique');

  const missingFiles = WIREFRAME_SPINE_MAP
    .filter((entry) => entry.appFile)
    .filter((entry) => !existsSync(path.join(ROOT, entry.appFile ?? '')))
    .map((entry) => `${entry.route} -> ${entry.appFile}`);
  assert.deepEqual(missingFiles, [], `mapped app files must exist:\n${missingFiles.join('\n')}`);
});

test('every Astro operator/client page route is represented in the wireframe spine map', () => {
  const mapped = new Set(WIREFRAME_SPINE_MAP.map((entry) => entry.route));
  const missing = appPageFiles()
    .map((rel) => ({ rel, route: astroPageRoute(rel) }))
    .filter(({ route }) => !mapped.has(route))
    .map(({ rel, route }) => `${route} (${rel})`);

  assert.deepEqual(missing, [], `page routes missing from WIREFRAME_SPINE_MAP:\n${missing.join('\n')}`);
});

test('every registered shell route is represented in the wireframe spine map', () => {
  const mapped = new Set(WIREFRAME_SPINE_MAP.map((entry) => entry.route));
  const missing = registeredRoutesFromSource()
    .filter((route) => !mapped.has(route))
    .map((route) => route);

  assert.deepEqual(missing, [], `registered routes missing from WIREFRAME_SPINE_MAP:\n${missing.join('\n')}`);
});

test('every canon F-* wireframe file is accounted for by the spine map or reference map', () => {
  const canonDir = path.join(ROOT, 'docs/wireframes/canon');
  const canonFiles = readdirSync(canonDir)
    .filter((name) => /^F-.*\.html$/.test(name))
    .sort();
  const accounted = new Set<string>();
  for (const entry of WIREFRAME_SPINE_MAP) {
    for (const face of entry.wireframes) accounted.add(face);
  }
  for (const entry of WIREFRAME_REFERENCE_MAP) accounted.add(entry.wireframe);

  const missing = canonFiles.filter((file) => !accounted.has(file));
  assert.deepEqual(missing, [], `canon wireframes missing from spine/reference map:\n${missing.join('\n')}`);
});

test('external conductor/user canon references stay explicit until imported', () => {
  assert.ok(
    EXTERNAL_OR_MISSING_CANON_FACES.some((entry) => entry.wireframe === 'F-RH7_bubble_transitions.html'),
    'F-RH7 must stay named as an external/missing canon face until imported',
  );
  assert.ok(
    EXTERNAL_OR_MISSING_CANON_FACES.some((entry) => entry.wireframe === 'F-EST1_mobile_estimate_builder.html'),
    'F-EST1 must stay named as an external/missing canon face until imported',
  );
});

