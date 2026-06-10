import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SERVER = 'scripts/serve-kerf-shell.ts';

test('Kerf shell caches hashed Astro bundles but not HTML documents', () => {
  const src = readFileSync(path.join(ROOT, SERVER), 'utf8');
  assert.match(src, /tryServeAstroClientAsset/);
  assert.match(src, /Cache-Control', 'public, max-age=31536000, immutable'/);
  assert.match(src, /function setHtmlDocumentCacheHeaders/);
  assert.match(src, /Cache-Control', 'no-store, max-age=0'/);
  assert.match(src, /Pragma', 'no-cache'/);

  const assetBranch = src.indexOf('if (tryServeAstroClientAsset(pathname, res))');
  const htmlHeaders = src.indexOf('setHtmlDocumentCacheHeaders(res);');
  const astroHandler = src.indexOf('void astroHandler(req, res');
  assert.ok(assetBranch > 0, 'asset branch must exist');
  assert.ok(htmlHeaders > assetBranch, 'HTML cache headers must be after immutable asset branch');
  assert.ok(astroHandler > htmlHeaders, 'HTML cache headers must be set before Astro renders documents');
});
