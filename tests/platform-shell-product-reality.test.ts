/**
 * Product-reality drive fixes · 2026-06-03 (Lane 1 Platform cleanup).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WIREFRAME_SPINE_MAP } from '../src/app/lib/wireframeSpineMap.js';
import { connectionStatusLabel } from '../src/app/lib/connectionsRegistry.js';

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
  assert.match(src, /operation-home/);
  assert.doesNotMatch(src, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(src, />\{wireframe\} · \{t\(ROLE_LABEL_KEYS/);
  assert.doesNotMatch(src, /platform\.home\.stub_title|platform\.home\.stub_body|role-home__stub/);
});

test('More page uses the job spine instead of the old client/module domain list', () => {
  const src = read('src/app/pages/more.astro');

  for (const label of ['Start', 'Design', 'Sales', 'Project', 'Schedule & Crew', 'Money', 'Success']) {
    assert.match(src, new RegExp(`title: '${label}'`));
  }
  assert.match(src, /Job spine work areas/);
  assert.doesNotMatch(src, /moreDomainLinksForRole/);
  assert.doesNotMatch(src, /MORE_NAV_LINKS/);
  assert.doesNotMatch(src, /title: 'Clients'/);
  assert.doesNotMatch(src, /shell\.domain\.clients/);
});

test('connection setup state stays in contractor language', () => {
  assert.equal(connectionStatusLabel('not_wired'), 'Needs setup');
});

test('Connections is source control with proof, not an old app catalog', () => {
  const src = read('src/app/pages/connections.astro');

  assert.match(src, /What Right Hand can use\./);
  assert.match(src, /Ready inside Right Hand/);
  assert.match(src, /Setup queue/);
  assert.match(src, /Nothing sends without you\./);
  assert.match(src, /No credentials are stored from this page\./);
  assert.match(src, /Saved first\. Synced when ready\./);
  assert.match(src, /surface: 'connections'/);
  assert.doesNotMatch(src, /One card per integration|connections-connect|RhSummary|<Card/i);
});

test('owner More nav keeps built work areas within one tap', () => {
  const src = read('src/app/pages/more.astro');
  assert.match(src, /href: '\/projects'/);
  assert.match(src, /href: '\/sales'/);
  assert.match(src, /href: '\/design\/proj_wegrzyn_kitchen'/);
});

test('wireframe build map and change-order builder are live routes', () => {
  const catalog = read('src/shell/surfaceCatalog.ts');
  const buildMap = read('src/app/pages/wireframes.astro');
  const spineMap = read('src/app/lib/wireframeSpineMap.ts');
  const start = read('src/app/pages/start.astro');
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
  assert.match(start, /\/change-orders\/new\?src=start/);
  assert.match(start, /\/projects\/proj_wegrzyn_kitchen\/money\/invoices\?src=start/);
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
    'src/app/pages/start.astro',
    'src/app/pages/create.astro',
    'src/app/pages/more.astro',
    'src/app/pages/sales/index.astro',
    'src/app/pages/design/[projectId].astro',
    'src/app/pages/field.astro',
    'src/app/pages/money/index.astro',
    'src/app/pages/projects/index.astro',
    'src/app/pages/right-hand.astro',
    'src/app/pages/room-capture.astro',
    'src/app/pages/settings/me.astro',
    'src/app/pages/connections.astro',
    'src/app/pages/kb-ingestion/index.astro',
    'src/app/pages/kb-ingestion/[id].astro',
    'src/app/pages/library.astro',
    'src/app/pages/decisions/[id].astro',
    'src/app/pages/change-orders/new.astro',
    'src/app/pages/projects/[id]/money/invoices.astro',
    'src/app/pages/money/invoices/[invoiceId].astro',
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /BuildTruthStrip/);
    assert.doesNotMatch(src, /wireframes=\{/);
    assert.doesNotMatch(src, /Being wired|Build target/);
    assert.doesNotMatch(src, /not wired|Not built yet|placeholder — no fake controls|future queue|coming in a later pass/i);
  }
});

test('attached app routes are marked built in the live wireframe spine', () => {
  const stillPending = WIREFRAME_SPINE_MAP
    .filter((entry) => entry.appFile)
    .filter((entry) => entry.status === 'mapped_pending_rebuild')
    .map((entry) => entry.route);

  assert.deepEqual(stillPending, []);
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
  const catalog = read('src/shell/surfaceCatalog.ts');
  const layout = read('src/app/layouts/Layout.astro');
  const login = read('src/app/pages/login.astro');
  const fieldLogin = read('src/app/pages/login/field.astro');
  const loginSurface = read('src/app/components/LoginSurface.astro');
  const card = read('src/app/components/Card.astro');
  const peopleSettings = read('src/app/pages/settings/people.astro');

  assert.match(en, /'login\.title': 'Sign in to Right Hand'/);
  assert.match(read('src/i18n/en.ts'), /'layout\.brand': 'Right Hand'/);
  assert.match(login, /mode="right-hand"/);
  assert.match(fieldLogin, /mode="field-hand"/);
  assert.match(loginSurface, /Field Hand sign-in/);
  assert.match(loginSurface, /Owner \/ office sign-in/);
  assert.match(loginSurface, /role and permissions come from the company account/);
  assert.match(loginSurface, /name="username"/);
  assert.doesNotMatch(loginSurface, /type="hidden"\s+name="username"\s+value="field"/);
  assert.doesNotMatch(loginSurface, /Field password/);
  assert.doesNotMatch(loginSurface, /type="radio"/);
  assert.doesNotMatch(loginSurface, /Project manager/);
  assert.doesNotMatch(loginSurface, /Admin \/ ops/);
  assert.doesNotMatch(layout, /id="kerf-role-switcher"/);
  assert.doesNotMatch(layout, /document\.cookie = `\$\{cookieName\}=/);
  assert.match(layout, /kerf-role-chip--static/);
  assert.doesNotMatch(login, /data-wireframe="F-LND1"/);
  assert.match(settings, /\/settings\/people/);
  assert.match(catalog, /\/settings\/people/);
  assert.match(peopleSettings, /Company setup assigns type, permissions, employee profile, and pay rules/);
  assert.match(peopleSettings, /Add users, assign type and permissions|Add user/);
  assert.match(peopleSettings, /Pay profile/);
  assert.match(peopleSettings, /people-access__table-wrap/);
  assert.match(card, /\.card\s*\{[\s\S]*?min-width: 0/);
  assert.match(card, /\.card-body\s*\{[\s\S]*?min-width: 0/);
  assert.doesNotMatch(en, /Wall 1|tenant settings|tenant and role/);
  assert.doesNotMatch(es, /Wall 1|tenant settings|inquilino y rol/);
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

  // Decision-first ORDER: the ask/route bar leads, then the one thing, then handled work summarized behind it.
  // Loop-first migration (PR #424): the old fixture-snapshot assertions (Ortiz fixture, /proj_ramirez_bath,
  // evidence-strip) and the forbid-rh-brain rules were the PRE-redesign home and are now superseded by
  // right-hand-loop-shell.test.ts, which owns the route-anywhere structure and blocks the duplicate chip row.
  // This test keeps the decision-first guard that survives the redesign; it does not assert the old markup.
  assert.match(src, /Find a job, invoice, crew, or log/);
  assert.match(src, /The one thing/);
  assert.match(src, /Right Hand handled/);
  assert.ok(src.indexOf('The one thing') < src.indexOf('Right Hand handled'));
  assert.ok(src.indexOf('Find a job, invoice, crew, or log') < src.indexOf('The one thing'));
  // Still no fake backdrop art or fixture work-artifact state on the live home path.
  assert.doesNotMatch(src, /jobsite-capture|decision-evidence|url\('/);
  assert.doesNotMatch(src, /truthStates/);
});

test('More is domain navigation, not a second Right Hand ask loop', () => {
  const src = read('src/app/pages/more.astro');

  assert.match(src, /more-page__sidebar/);
  assert.match(src, /Work areas/);
  assert.match(src, /title: 'Design'/);
  assert.match(src, /title: 'Project'/);
  assert.match(src, /title: 'Success'/);
  assert.match(src, /title: 'Schedule & Crew'/);
  assert.doesNotMatch(src, /Common paths/);
  assert.doesNotMatch(src, /title: 'Clients'/);
  assert.doesNotMatch(src, /shell\.domain\.clients/);
  assert.doesNotMatch(src, /Ask Right Hand to route you/);
  assert.doesNotMatch(src, /action="\/right-hand"/);
});

test('top bar exposes sign out without hiding account settings', () => {
  const layout = read('src/app/layouts/Layout.astro');
  const styles = read('src/app/styles/shell.css');

  assert.match(layout, /href="\/logout">\{t\('layout\.sign_out'\)\}<\/a>/);
  assert.match(layout, /href="\/settings\/me"/);
  assert.match(styles, /\.kerf-signout/);
});

test('Field Hand is sun-readable and camera scan means ID or document', () => {
  const src = read('src/app/components/FieldHandHomeSurface.astro');

  assert.match(src, /Mano de Campo/);
  assert.match(src, /Scan ID/);
  assert.match(src, /scan an ID\/document/);
  assert.match(src, /--fh-sun: #d7f64a/);
  assert.doesNotMatch(src, /scan the room/);
});

test('decision records are learning inspection, not the generic job decision route', () => {
  const decisions = read('src/app/pages/decisions/index.astro');
  const detail = read('src/app/pages/decisions/[id].astro');

  assert.match(decisions, /Decision records/);
  assert.match(decisions, /Inspection and learning live here/);
  assert.match(decisions, /Knowledge shelf/);
  assert.doesNotMatch(decisions, /What can be inspected now/);
  assert.match(detail, /Good \/ Fix trains the next draft/);
});

test('mobile bottom nav uses the Right Hand dock design', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');
  const routes = read('src/app/lib/shellRoutes.ts');
  const topNav = read('src/app/lib/nav.ts');

  assert.match(nav, /left: 12px/);
  assert.match(nav, /right: 12px/);
  assert.match(nav, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(nav, /border-radius: 8px/);
  assert.match(nav, /backdrop-filter: blur\(18px\)/);
  assert.match(nav, /\.mbn-speak\s*\{[\s\S]*?background: var\(--kerf-amber\)/);
  assert.match(nav, /\.mbn-speak-label\s*\{[\s\S]*?display: block/);
  assert.match(routes, /href: '\/start', labelKey: 'shell\.nav\.create'/);
  assert.doesNotMatch(routes, /href: '\/create', labelKey: 'shell\.nav\.create'/);
  assert.match(nav, /data-role-root='field_hand'[\s\S]*?\.mbn-speak/);
  assert.match(nav, /background: var\(--field-green\)/);
  assert.doesNotMatch(nav, /border-radius: 50%/);
  assert.doesNotMatch(nav, /visibility:\s*hidden/);
  assert.doesNotMatch(topNav, /href: '\/decisions'/);
  assert.doesNotMatch(topNav, /href: '\/blackboard'/);
  assert.doesNotMatch(topNav, /href: '\/clients'/);
});
