/**
 * Mobile validation harness — dev utility for integration lead visual review.
 * Not linked from V1.5 operator nav.
 */

import {
  MOBILE_PROBE_QUERY_PARAM,
  MOBILE_PROBE_MESSAGE_TYPE,
  MOBILE_VALIDATION_ROUTES,
  type MobileValidationRoute,
} from './m-dom-probe.js';

export { MOBILE_VALIDATION_ROUTES, type MobileValidationRoute };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function routeTabsMarkup(active: MobileValidationRoute): string {
  return MOBILE_VALIDATION_ROUTES.map((route) => {
    const label = route.replace(/^\//, '') || 'dashboard';
    const activeClass = route === active ? ' is-active' : '';
    return `<button type="button" class="m-harness-tab${activeClass}" data-route="${escapeHtml(route)}">${escapeHtml(label)}</button>`;
  }).join('\n');
}

function iframeSrc(route: MobileValidationRoute): string {
  return `${route}?${MOBILE_PROBE_QUERY_PARAM}=1`;
}

export function buildMobileValidationHarnessHtml(
  activeRoute: MobileValidationRoute = '/dashboard',
): string {
  const src375 = escapeHtml(iframeSrc(activeRoute));
  const tabs = routeTabsMarkup(activeRoute);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kerf V1.5 — mobile validation harness</title>
  <style>
    :root {
      --m-bg: #0f1419;
      --m-panel: #1a2332;
      --m-border: #2d3a4d;
      --m-text: #e8edf4;
      --m-muted: #8b9cb3;
      --m-accent: #3d8bfd;
      --m-warn: #f0a020;
      --m-bad: #e85d5d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      background: var(--m-bg);
      color: var(--m-text);
      line-height: 1.45;
    }
    .m-harness-header {
      padding: 1rem 1.25rem 0.75rem;
      border-bottom: 1px solid var(--m-border);
    }
    .m-harness-header h1 {
      margin: 0 0 0.35rem;
      font-size: 1.15rem;
      font-weight: 600;
    }
    .m-harness-header p {
      margin: 0;
      font-size: 0.85rem;
      color: var(--m-muted);
    }
    .m-harness-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--m-border);
    }
    .m-harness-tab {
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--m-border);
      border-radius: 6px;
      background: var(--m-panel);
      color: var(--m-text);
      font-size: 0.8rem;
      cursor: pointer;
    }
    .m-harness-tab.is-active {
      border-color: var(--m-accent);
      background: #243044;
    }
    .m-harness-frames {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      padding: 1.25rem;
      align-items: flex-start;
    }
    .m-harness-col {
      flex: 0 0 auto;
    }
    .m-harness-col h2 {
      margin: 0 0 0.5rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--m-muted);
    }
    .m-harness-frame-wrap {
      border: 2px solid var(--m-border);
      border-radius: 12px;
      overflow: hidden;
      background: #fff;
    }
    .m-harness-frame-wrap--375 { width: 375px; }
    .m-harness-frame-wrap--414 { width: 414px; }
    .m-harness-frame {
      display: block;
      width: 100%;
      height: 720px;
      border: 0;
    }
    .m-harness-results {
      margin: 0 1.25rem 1.5rem;
      padding: 1rem;
      background: var(--m-panel);
      border: 1px solid var(--m-border);
      border-radius: 8px;
    }
    .m-harness-results h2 {
      margin: 0 0 0.75rem;
      font-size: 0.95rem;
    }
    .m-harness-results-empty {
      color: var(--m-muted);
      font-size: 0.85rem;
    }
    .m-harness-report {
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--m-border);
      font-size: 0.8rem;
    }
    .m-harness-report:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: 0;
    }
    .m-harness-report h3 {
      margin: 0 0 0.35rem;
      font-size: 0.85rem;
    }
    .m-harness-report ul {
      margin: 0.25rem 0 0;
      padding-left: 1.1rem;
    }
    .m-harness-report--warn h3 { color: var(--m-warn); }
    .m-harness-report--ok h3 { color: #5cb85c; }
    .m-harness-report li { margin: 0.15rem 0; color: var(--m-muted); }
  </style>
</head>
<body>
  <header class="m-harness-header">
    <h1>V1.5 mobile validation harness</h1>
    <p>Dev utility — side-by-side 375px / 414px iframes with DOM-probe overflow + touch-target audit. Not an operator surface.</p>
  </header>
  <nav class="m-harness-tabs" aria-label="V1.5 routes">${tabs}</nav>
  <div class="m-harness-frames">
    <div class="m-harness-col">
      <h2>375px (iPhone SE narrow)</h2>
      <div class="m-harness-frame-wrap m-harness-frame-wrap--375">
        <iframe class="m-harness-frame" id="m-frame-375" title="375px preview" src="${src375}"></iframe>
      </div>
    </div>
    <div class="m-harness-col">
      <h2>414px (iPhone Pro Max)</h2>
      <div class="m-harness-frame-wrap m-harness-frame-wrap--414">
        <iframe class="m-harness-frame" id="m-frame-414" title="414px preview" src="${src375}"></iframe>
      </div>
    </div>
  </div>
  <section class="m-harness-results" aria-live="polite">
    <h2>DOM probe results</h2>
    <div id="m-harness-results-body" class="m-harness-results-empty">Waiting for iframe probes…</div>
  </section>
  <script>
(function () {
  var PROBE_TYPE = ${JSON.stringify(MOBILE_PROBE_MESSAGE_TYPE)};
  var activeRoute = ${JSON.stringify(activeRoute)};
  var reports = {};

  function frameLabel(viewportWidth) {
    return viewportWidth + 'px — ' + activeRoute;
  }

  function renderResults() {
    var body = document.getElementById('m-harness-results-body');
    if (!body) return;
    var keys = Object.keys(reports).sort();
    if (keys.length === 0) {
      body.className = 'm-harness-results-empty';
      body.textContent = 'Waiting for iframe probes…';
      return;
    }
    body.className = '';
    body.innerHTML = keys.map(function (key) {
      var r = reports[key];
      var issues = (r.horizontalOverflow && r.horizontalOverflow.length) ||
        (r.smallTouchTargets && r.smallTouchTargets.length) ||
        (r.documentScrollLeft > 0) ||
        (r.maxDocumentScrollLeft > 0 && r.documentScrollLeft < r.maxDocumentScrollLeft);
      var cls = issues ? 'm-harness-report m-harness-report--warn' : 'm-harness-report m-harness-report--ok';
      var overflowList = (r.horizontalOverflow || []).map(function (o) {
        return '<li>' + o.descriptor + ' — scroll ' + o.scrollWidth + ' / client ' + o.clientWidth + '</li>';
      }).join('');
      var touchList = (r.smallTouchTargets || []).map(function (t) {
        return '<li>' + t.descriptor + ' — ' + t.width + '×' + t.height + 'px</li>';
      }).join('');
      return '<article class="' + cls + '">' +
        '<h3>' + key + (issues ? ' — issues detected' : ' — no issues detected') + '</h3>' +
        '<p>route: ' + r.route + ' · viewport: ' + r.viewportWidth + 'px · scrollLeft: ' + r.documentScrollLeft +
        ' · max scrollLeft: ' + r.maxDocumentScrollLeft + '</p>' +
        (overflowList ? '<p>Horizontal overflow:</p><ul>' + overflowList + '</ul>' : '') +
        (touchList ? '<p>Touch targets &lt; 44×44px:</p><ul>' + touchList + '</ul>' : '') +
        '</article>';
    }).join('');
  }

  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== PROBE_TYPE) return;
    var label = frameLabel(ev.data.viewportWidth);
    reports[label] = ev.data;
    renderResults();
  });

  document.querySelector('.m-harness-tabs').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-route]');
    if (!btn) return;
    activeRoute = btn.getAttribute('data-route');
    var src = activeRoute + '?${MOBILE_PROBE_QUERY_PARAM}=1';
    document.getElementById('m-frame-375').src = src;
    document.getElementById('m-frame-414').src = src;
    reports = {};
    renderResults();
    document.querySelectorAll('.m-harness-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-route') === activeRoute);
    });
  });
})();
  </script>
</body>
</html>`;
}
