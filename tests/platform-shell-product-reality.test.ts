/**
 * Product-reality drive fixes · 2026-06-03 (Lane 1 Platform cleanup).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { moreDomainLinksForRole } from '../src/shell/moreDomainNav.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

test('apiRouter export does not inject a default platform session', () => {
  const src = read('src/api/router.ts');
  assert.doesNotMatch(src, /withDefaultPlatformSession/);
  assert.match(src, /export const apiRouter = createApiRouter\(\)/);
});

test('RoleHomeSurface hides F-xx wireframe codes outside dev/debug', () => {
  const src = read('src/app/components/RoleHomeSurface.astro');
  assert.match(src, /showWireframeRef/);
  assert.match(src, /Astro\.url\.searchParams\.get\('debug'\) === '1'/);
  assert.doesNotMatch(src, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(src, />\{wireframe\} · \{t\(ROLE_LABEL_KEYS/);
});

test('More page is driven from surfaceCatalog roleScope', () => {
  const src = read('src/app/pages/more.astro');
  assert.match(src, /moreDomainLinksForRole/);
  assert.doesNotMatch(src, /MORE_NAV_LINKS/);
});

test('owner More nav includes Projects in ≤2 taps from any screen', () => {
  const links = moreDomainLinksForRole('owner');
  const projects = links.find((l) => l.domain === 'projects');
  assert.ok(projects);
  assert.equal(projects.href, '/projects');
});

test('owner More nav lands on built Sales instead of the old decisions placeholder', () => {
  const links = moreDomainLinksForRole('owner');
  const sales = links.find((l) => l.domain === 'sales');
  assert.ok(sales);
  assert.equal(sales.href, '/sales');
});

test('wireframe build map and change-order builder are live routes', () => {
  const catalog = read('src/shell/surfaceCatalog.ts');
  const buildMap = read('src/app/pages/wireframes.astro');
  const spineMap = read('src/app/lib/wireframeSpineMap.ts');
  const start = read('src/app/pages/create.astro');
  const changeOrder = read('src/app/pages/change-orders/new.astro');
  const projectInvoices = read('src/app/pages/projects/[id]/money/invoices.astro');
  const invoiceDetail = read('src/app/pages/money/invoices/[invoiceId].astro');
  const moneyFixtures = read('src/app/lib/moneyFixtures.ts');

  assert.match(catalog, /\/wireframes/);
  assert.match(catalog, /\/projects\/\[id\]\/money\/invoices/);
  assert.match(catalog, /\/money\/invoices\/\[invoiceId\]/);
  assert.match(buildMap, /WIREFRAME_SPINE_MAP/);
  assert.match(buildMap, /\/change-orders\/new/);
  assert.match(buildMap, /\/projects\/:id\/money\/invoices/);
  assert.match(buildMap, /\/money\/invoices\/:invoiceId/);
  assert.match(spineMap, /F-S1_mobile_start_action_sheet\.html/);
  assert.match(spineMap, /F-CHG1_mobile_change_order_builder\.html/);
  assert.match(spineMap, /F-B1_mobile_decision_card\.html/);
  assert.match(spineMap, /F-INV1a_mobile_per_job_invoice_list\.html/);
  assert.match(spineMap, /F-INV2a_mobile_per_job_invoice_detail\.html/);
  assert.match(start, /\/change-orders\/new\?src=create/);
  assert.match(start, /\/projects\/proj_wegrzyn_kitchen\/money\/invoices\?src=create/);
  assert.match(changeOrder, /Create decision card/);
  assert.match(changeOrder, /disabled/);
  assert.match(projectInvoices, /Project money/);
  assert.match(projectInvoices, /\/money\/invoices\/\$\{invoice\.id\}/);
  assert.match(invoiceDetail, /Money guard/);
  assert.match(invoiceDetail, /Issue invoice/);
  assert.match(invoiceDetail, /disabled/);
  assert.match(moneyFixtures, /href: '\/money\/invoices\/inv-weg-02'/);
});

test('working surfaces keep wireframe/build language out of operator screens', () => {
  for (const file of [
    'src/app/pages/create.astro',
    'src/app/pages/more.astro',
    'src/app/pages/sales/index.astro',
    'src/app/pages/design/[projectId].astro',
    'src/app/pages/field.astro',
    'src/app/pages/money/index.astro',
    'src/app/pages/projects/index.astro',
    'src/app/pages/right-hand.astro',
    'src/app/pages/room-capture.astro',
    'src/app/pages/change-orders/new.astro',
    'src/app/pages/projects/[id]/money/invoices.astro',
    'src/app/pages/money/invoices/[invoiceId].astro',
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /BuildTruthStrip/);
    assert.doesNotMatch(src, /wireframes=\{/);
    assert.doesNotMatch(src, /Being wired|Build target/);
  }
});

test('camera Done files through Lane 3 daily-log endpoint before claiming attachment', () => {
  const src = read('src/app/pages/camera.astro');
  assert.doesNotMatch(src, /TODO\(lane-3\)/);
  assert.doesNotMatch(src, /preview_only_not_filed/);
  assert.doesNotMatch(src, /Not filed yet/);
  assert.match(src, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(src, /video\.srcObject = cameraStream/);
  assert.match(src, /canvas\.toDataURL\('image\/jpeg'/);
  assert.match(src, /source: 'getUserMedia_canvas_frame'/);
  assert.match(src, /source: 'file_input_fallback'/);
  assert.match(src, /Camera unavailable here — using fallback file picker/);
  assert.match(src, /\/api\/v1\/projects\/\$\{selectedProjectId\}\/camera-capture/);
  assert.match(src, /status: 'filed_to_daily_log'/);
  assert.match(src, /Confirm and file/);
  assert.match(src, /id="cam-last-shot"/);
  // Failure is always surfaced (never a silent no-op), now with the exact class
  // in operator-safe copy rather than one generic line.
  assert.match(src, /Nothing was attached/);
  assert.match(src, /session expired|could not record that|isn't available|could not reach the server/i);
  assert.match(src, /\.f-cam1\.has-capture \.cam-viewfinder__copy/);
});

test('login and layout brand use Right Hand in user-facing copy', () => {
  const en = read('src/i18n/en.ts');
  const es = read('src/i18n/es.ts');
  const settings = read('src/app/pages/settings.astro');

  assert.match(en, /'login\.title': 'Sign in to Right Hand'/);
  assert.match(read('src/i18n/en.ts'), /'layout\.brand': 'Right Hand'/);
  assert.doesNotMatch(en, /Wall 1|tenant settings|tenant and role/);
  assert.doesNotMatch(es, /Wall 1|tenant settings|inquilino y rol/);
  assert.doesNotMatch(settings, /tenant/i);
});

test('app shell uses Right Hand contractor skin with explicit dark mode', () => {
  const shell = read('src/app/styles/shell.css');
  const layout = read('src/app/layouts/Layout.astro');

  assert.match(shell, /--kerf-bg: #f7f6f1/);
  assert.match(shell, /:root\[data-theme='dark'\]/);
  assert.match(shell, /linear-gradient\(rgba\(24, 23, 19, 0\.035\) 1px, transparent 1px\)/);
  assert.match(shell, /background-size: 22px 22px/);
  assert.match(layout, /kerf-brand-tagline/);
  assert.match(layout, /From capture to completion\./);
});

test('owner home is decision-first with agent work summarized behind it', () => {
  const src = read('src/app/components/RightHandHomeSurface.astro');

  assert.match(src, /<h2>The one thing<\/h2>/);
  assert.match(src, /Right Hand handled/);
  assert.match(src, /Route anywhere/);
  assert.match(src, /Filed underneath/);
  assert.ok(src.indexOf('<h2>The one thing</h2>') < src.indexOf('Right Hand handled'));
  assert.ok(src.indexOf('Right Hand handled') < src.indexOf('Route anywhere'));
  assert.ok(src.indexOf('Route anywhere') < src.indexOf('Filed underneath'));
  assert.doesNotMatch(src, /rh-brain/);
  assert.doesNotMatch(src, /truthStates/);
});

test('mobile bottom nav uses the Right Hand dock design', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');

  assert.match(nav, /left: 12px/);
  assert.match(nav, /right: 12px/);
  assert.match(nav, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(nav, /border-radius: 8px/);
  assert.match(nav, /backdrop-filter: blur\(18px\)/);
  assert.match(nav, /\.mbn-speak\s*\{[\s\S]*?background: var\(--kerf-amber\)/);
  assert.match(nav, /\.mbn-speak-label\s*\{[\s\S]*?display: block/);
  assert.match(nav, /data-role-root='field_hand'[\s\S]*?\.mbn-speak/);
  assert.match(nav, /background: var\(--field-green\)/);
  assert.doesNotMatch(nav, /border-radius: 50%/);
  assert.doesNotMatch(nav, /visibility:\s*hidden/);
});
