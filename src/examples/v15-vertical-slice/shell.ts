import { DEMO_PACKET_ID } from './mock.js';
import { buildPage } from './pages.js';
import { renderProgressStrip } from './progress.js';
import { matchRoute, phaseForRoute } from './router.js';

const NAV_ITEMS: readonly { label: string; path: string; matchPrefix?: string }[] = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Field Capture', path: '/field-capture' },
  { label: 'Transcript Review', path: '/transcript-review' },
  { label: 'Draft Review', path: '/draft-review' },
  { label: 'Decisions', path: '/decisions', matchPrefix: '/decisions' },
  { label: 'Audit', path: `/audit/${DEMO_PACKET_ID}`, matchPrefix: '/audit' },
  { label: 'Blackboard', path: '/blackboard' },
];

function navClass(pathname: string, item: (typeof NAV_ITEMS)[number]): string {
  const base = 'kerf-v15-nav__link';
  if (item.matchPrefix !== undefined) {
    return pathname === item.path ||
      pathname.startsWith(`${item.matchPrefix}/`) ||
      pathname === item.matchPrefix
      ? `${base} ${base}--current`
      : base;
  }
  return pathname === item.path ? `${base} ${base}--current` : base;
}

function navAria(pathname: string, item: (typeof NAV_ITEMS)[number]): string {
  const isCurrent =
    item.matchPrefix !== undefined
      ? pathname === item.path ||
        pathname.startsWith(`${item.matchPrefix}/`) ||
        pathname === item.matchPrefix
      : pathname === item.path;
  return isCurrent ? ' aria-current="page"' : '';
}

export function renderShell(pathname: string): string {
  const route = matchRoute(pathname);
  const phase = phaseForRoute(route);
  const page = buildPage(route);

  const navLinks = NAV_ITEMS.map(
    (item) =>
      `<a class="${navClass(pathname, item)}" href="${item.path}" data-kerf-v15-nav="true"${navAria(pathname, item)}>${item.label}</a>`,
  ).join('');

  const rail = page.railHtml !== undefined
    ? `<div class="kerf-v15-frame__split"><div class="kerf-v15-frame__main">${page.bodyHtml}</div><div class="kerf-v15-frame__rail">${page.railHtml}</div></div>`
    : `<div class="kerf-v15-frame__body">${page.bodyHtml}</div>`;

  return `<div class="kerf-v15-shell">
  <header class="kerf-v15-topbar">
    <div class="kerf-v15-brand">
      <span class="kerf-v15-brand__mark" aria-hidden="true">KERF</span>
      <div class="kerf-v15-brand__text">
        <span class="kerf-v15-brand__title">Kerf · Vertical slice</span>
        <span class="kerf-v15-brand__tag">V1.5 shell demo</span>
      </div>
    </div>
    <button type="button" class="kerf-v15-nav-toggle" aria-expanded="false" aria-controls="kerf-v15-nav" data-kerf-v15-nav-toggle>
      Menu
    </button>
    <nav id="kerf-v15-nav" class="kerf-v15-nav" aria-label="Primary">
      ${navLinks}
    </nav>
  </header>
  ${renderProgressStrip(phase)}
  <main class="kerf-v15-main">
    <section class="kerf-v15-frame" aria-labelledby="kerf-v15-frame-title">
      <header class="kerf-v15-frame__head">
        <h1 id="kerf-v15-frame-title" class="kerf-v15-frame__title">${page.title}</h1>
        <p class="kerf-v15-frame__subtitle">${page.subtitle}</p>
        <p class="kerf-v15-frame__notice" role="status">${page.notice}</p>
      </header>
      ${rail}
    </section>
  </main>
  <footer class="kerf-v15-legal" role="contentinfo">
    <p class="kerf-v15-legal__text">Vertical slice demo. No external sends, pricing commitments, or money actions occur from this UI.</p>
  </footer>
</div>`;
}
