import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
test('shellRoutes exports home loops and mobile nav canon', () => {
  const src = read('src/app/lib/shellRoutes.ts');
  assert.match(src, /HOME_OPERATOR_LOOPS/);
  assert.match(src, /MOBILE_BOTTOM_NAV/);
  assert.match(src, /shell\.nav\.capture/);
});
test('SpeakFAB routes to Right Hand without debug handler', () => {
  const src = read('src/app/components/SpeakFAB.astro');
  assert.match(src, /href="\/right-hand"/);
  assert.doesNotMatch(src, /console\.info/);
  assert.match(src, /5\.5rem/);
});
test('center Speak nav opens Right Hand and the phone bar uses Start/Camera', () => {
  const src = read('src/app/lib/shellRoutes.ts');
  assert.match(src, /href: '\/right-hand', labelKey: 'shell\.nav\.speak'/);
  assert.match(src, /href: '\/start', labelKey: 'shell\.nav\.create'/);
  assert.doesNotMatch(src, /href: '\/create', labelKey: 'shell\.nav\.create'/);
  assert.match(src, /href: '\/camera', labelKey: 'shell\.nav\.camera'/);
  assert.doesNotMatch(src, /href: '\/field-capture', labelKey: 'shell\.nav\.speak'/);
  assert.doesNotMatch(src, /href: '\/role-routing'/);
});
test('Layout wires mobile bottom nav', () => {
  assert.match(read('src/app/layouts/Layout.astro'), /MobileBottomNav/);
});
test('served shell exposes build stamp for path-truth verification', () => {
  const layout = read('src/app/layouts/Layout.astro');
  const shell = read('scripts/serve-kerf-shell.ts');
  const api = read('src/api/routes/projects.ts');
  const buildStamp = read('src/shell/buildStamp.ts');
  const dockerfile = read('Dockerfile');
  const packageJson = read('package.json');
  const deployScript = read('scripts/fly-deploy-stamped.sh');
  assert.match(layout, /meta name="kerf-build-commit"/);
  assert.match(layout, /data-build-commit/);
  assert.match(layout, /data-build-dirty/);
  assert.match(layout, /readBuildStamp/);
  assert.doesNotMatch(shell, /stampServedBuild/);
  assert.match(shell, /readBuildStamp/);
  assert.match(shell, /buildStampPayload\(stamp\)/);
  assert.match(api, /readBuildStamp/);
  assert.match(api, /buildStampPayload\(stamp\)/);
  assert.match(buildStamp, /source: 'file'/);
  assert.match(dockerfile, /ARG GIT_COMMIT/);
  assert.match(dockerfile, /ARG GIT_DIRTY/);
  assert.match(dockerfile, /ARG BUILD_TIMESTAMP/);
  assert.match(dockerfile, /build-stamp\.json/);
  assert.match(packageJson, /scripts\/fly-deploy-stamped\.sh/);
  assert.match(deployScript, /git rev-parse HEAD/);
  assert.match(deployScript, /--build-arg "GIT_COMMIT=\$\{commit\}"/);
  assert.match(deployScript, /--build-arg "GIT_DIRTY=\$\{dirty\}"/);
  assert.match(deployScript, /--build-arg "BUILD_TIMESTAMP=\$\{timestamp\}"/);
  // Top-level commit + boolean dirty is the path-truth shape (nested build kept for legacy readers).
  assert.match(buildStamp, /commit: stamp\.commit/);
  assert.match(buildStamp, /dirty: stamp\.dirty/);
  assert.match(buildStamp, /build: \{/);
});
test('shell.css reserves space for mobile bottom nav', () => {
  assert.match(read('src/app/styles/shell.css'), /5\.5rem/);
});
test('home index uses the Right Hand home surface', () => {
  const src = read('src/app/pages/index.astro');
  assert.match(src, /RoleHomeSurface/);
  assert.match(src, /home\.title/);
});
test('desktop nav follows the job spine without old review shelves as top nav', () => {
  const src = read('src/app/lib/nav.ts');
  assert.match(src, /\/start/);
  assert.match(src, /\/design\/proj_wegrzyn_kitchen/);
  assert.match(src, /\/sales/);
  assert.match(src, /\/projects/);
  assert.match(src, /\/schedule/);
  assert.match(src, /\/money/);
  assert.match(src, /\/camera/);
  assert.match(src, /\/settings/);
  assert.match(src, /\/more/);
  assert.doesNotMatch(src, /\/transcript-review/);
  assert.doesNotMatch(src, /\/draft-review/);
  assert.doesNotMatch(src, /\/reports/);
  assert.doesNotMatch(src, /\/kb-ingestion/);
  assert.doesNotMatch(src, /domain: 'audit'/);
  assert.doesNotMatch(src, /href: '\/role-routing'/);
});
test('preview pages exist for schedule, reports, settings, more, create, camera', () => {
  for (const page of ['schedule.astro', 'reports.astro', 'settings.astro', 'more.astro', 'create.astro', 'camera.astro']) {
    assert.ok(existsSync(path.join(ROOT, 'src/app/pages', page)), page);
  }
});
test('F-CAM1 V1 camera opens capture-first and routes after capture', () => {
  const src = read('src/app/pages/camera.astro');
  assert.doesNotMatch(src, /Where should this go\?/);
  assert.doesNotMatch(src, /Pick the job first/);
  assert.doesNotMatch(src, /needs-job/);
  assert.doesNotMatch(src, /cam-job-gate/);
  assert.match(src, /surface: 'field_capture'/);
  assert.match(src, /id="cam-route-panel"/);
  assert.match(src, /Active job ·/);
  assert.match(src, /Confirm and file/);
  assert.match(src, /Capture first\. Choose where it goes before filing\./);
  assert.match(src, /route_pending/);
  assert.match(src, /capture_store_session_id/);
  assert.match(src, /Saved on phone/);
  assert.match(src, /showRoutePanel/);
  assert.match(src, /data-route-confirmed/);
  assert.match(src, /Walkthru/);
  assert.match(src, /Photo/);
  assert.match(src, /Scan/);
  assert.match(src, /Right Hand listening · REC/);
  assert.match(src, /id="cam-video"/);
  assert.match(src, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(src, /video\.srcObject = cameraStream/);
  assert.match(src, /sessionStorage\.setItem\('kerf\.cameraCapture'/);
  assert.match(src, /\/api\/v1\/projects\/\$\{selectedProjectId\}\/camera-capture/);
  assert.match(src, /filed_to_daily_log/);
  // Superseded by the capture-first redesign (#420): room capture is a SEPARATE surface, and
  // bubble-camera-polish enforces it is NOT inside the camera ("room capture is not inside the
  // camera surface"). That assertion and the old room-capture-in-camera one are mutually exclusive.
  assert.doesNotMatch(src, /href="\/field-capture"/);
});
test('Room scan reached from Camera starts honestly instead of showing post-scan fixture results', () => {
  const src = read('src/app/pages/room-capture.astro');
  assert.match(src, /const freshScan/);
  assert.match(src, /mode'\) === 'start'/);
  assert.match(src, /Start room scan/);
  assert.match(src, /Use the native app for live LiDAR capture/);
  assert.match(src, /href="\/room-capture\?scan_id=demo_last"/);
});
test('ActionsStrip delegates to ExportPrintBar', () => {
  assert.match(read('src/app/components/ActionsStrip.astro'), /ExportPrintBar/);
});
test('project detail uses wired export bar without inline export script', () => {
  const index = read('src/app/pages/projects/[id]/index.astro');
  assert.match(index, /wired/);
  assert.doesNotMatch(index, /define:vars/);
});
test('i18n includes Batch D shell keys and speak fab title', () => {
  assert.match(read('src/i18n/keys.ts'), /'home\.title'/);
  assert.match(read('src/i18n/en.ts'), /Talk to Right Hand/);
});
