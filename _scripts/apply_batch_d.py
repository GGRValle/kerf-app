from pathlib import Path
import re
R = Path(__file__).resolve().parents[1]

def w(rel, text):
    p = R / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")

if not (R / "src/app/lib/shellRoutes.ts").exists():
    raise SystemExit("shellRoutes missing")

w("src/app/components/SpeakFAB.astro", """---
import { createLayoutContext } from '../lib/createLayoutContext.js';
const { t } = createLayoutContext();
---
<a href="/field-capture" class="speak-fab" aria-label={t('layout.speak_fab.label')} title={t('layout.speak_fab.title')}><span aria-hidden="true">🎙</span></a>
<style>.speak-fab{position:fixed;right:max(1rem,env(safe-area-inset-right));bottom:max(5.5rem,calc(1rem + env(safe-area-inset-bottom,0px)));width:3.25rem;height:3.25rem;border-radius:999px;background:var(--accent,#0f766e);color:#fff;z-index:20;display:flex;align-items:center;justify-content:center;text-decoration:none}@media(min-width:900px){.speak-fab{bottom:max(1rem,env(safe-area-inset-bottom))}}</style>
""")

w("src/app/components/ExportPrintBar.astro", """---
import { createLayoutContext } from '../lib/createLayoutContext.js';
export interface Props { surface?: string; projectId?: string; tenantId?: string; wired?: boolean }
const { projectId, tenantId, wired = false } = Astro.props;
const { t } = createLayoutContext();
const canWire = wired && projectId && tenantId;
---
<div class="export-print-bar">{canWire ? (<><button type="button" class="epb-btn" data-format="print">{t('action.print')}</button><button type="button" class="epb-btn" data-format="pdf">{t('action.export.menu')}</button><p id="export-print-status" role="status"></p></>) : <p>{t('shell.export.preview_notice')}</p>}</div>
{canWire ? (<script define:vars={{ projectId, tenantId, successMsg: t('project.export.success'), errorMsg: t('project.export.error') }}>
document.querySelectorAll('.epb-btn').forEach((btn) => btn.addEventListener('click', async () => {
  const status = document.getElementById('export-print-status');
  const format = btn.getAttribute('data-format') || 'pdf';
  const url = '/api/v1/projects/' + projectId + '/export?tenant_id=' + tenantId;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
    if (!res.ok) throw new Error('fail');
    if (status) status.textContent = successMsg;
  } catch (e) {
    if (status) status.textContent = errorMsg;
  }
}));
</script>) : null}
""")

w("src/app/components/ActionsStrip.astro", """---
import ExportPrintBar from './ExportPrintBar.astro';
export interface Props { surface?: string; projectId?: string; tenantId?: string; wired?: boolean }
const { surface = 'generic', projectId, tenantId, wired = false } = Astro.props;
---
<div class="actions-strip"><ExportPrintBar surface={surface} projectId={projectId} tenantId={tenantId} wired={wired} /><slot /></div>
""")

w("src/app/components/HomeLoopGrid.astro", """---
import { HOME_OPERATOR_LOOPS } from '../lib/shellRoutes.js';
import { createLayoutContext } from '../lib/createLayoutContext.js';
const { t } = createLayoutContext();
---
<section aria-label={t('home.loops.aria')}><h2>{t('home.loops.heading')}</h2><ul>{HOME_OPERATOR_LOOPS.map((loop) => (<li><a href={loop.href}>{t(loop.titleKey)} — {t(loop.detailKey)}</a></li>))}</ul></section>
""")

w("src/app/components/MobileBottomNav.astro", """---
import { MOBILE_BOTTOM_NAV } from '../lib/shellRoutes.js';
import { createLayoutContext } from '../lib/createLayoutContext.js';
export interface Props { activeHref?: string }
const { activeHref = '/' } = Astro.props;
const { t } = createLayoutContext();
const isActive = (href) => href === '/' ? activeHref === '/' : activeHref === href || activeHref.startsWith(href + '/');
---
<nav class="mobile-bottom-nav" aria-label={t('shell.mobile_nav.aria')}>{MOBILE_BOTTOM_NAV.map((item) => (<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>{t(item.labelKey)}</a>))}</nav>
<style>.mobile-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:15;display:flex;background:#fff;border-top:1px solid #ddd}@media(min-width:900px){.mobile-bottom-nav{display:none}}</style>
""")

w("src/app/pages/index.astro", """---
import Layout from '../layouts/Layout.astro';
import HomeLoopGrid from '../components/HomeLoopGrid.astro';
import RhSummary from '../components/RhSummary.astro';
import { createLayoutContext } from '../lib/createLayoutContext.js';
const { t } = createLayoutContext();
---
<Layout titleKey="home.title" activeHref="/"><RhSummary headline={t('home.title')} detail={t('home.subtitle')} /><HomeLoopGrid /></Layout>
""")

for name, key, href in [
    ("more.astro", "shell.more.title", "/more"),
    ("schedule.astro", "schedule.title", "/schedule"),
    ("reports.astro", "reports.title", "/reports"),
    ("settings.astro", "settings.title", "/settings"),
]:
    w(f"src/app/pages/{name}", f"""---
import Layout from '../layouts/Layout.astro';
import Card from '../components/Card.astro';
import {{ createLayoutContext }} from '../lib/createLayoutContext.js';
const {{ t }} = createLayoutContext();
---
<Layout titleKey="{key}" activeHref="{href}"><Card eyebrow={{t('route_shell.card_eyebrow')}} title={{t('{key}')}}><p>{{t('route_shell.body')}}</p></Card></Layout>
""")

layout = R / "src/app/layouts/Layout.astro"
text = layout.read_text(encoding="utf-8")
if "MobileBottomNav" not in text:
    text = text.replace(
        "import SpeakFAB from '../components/SpeakFAB.astro';",
        "import SpeakFAB from '../components/SpeakFAB.astro';\nimport MobileBottomNav from '../components/MobileBottomNav.astro';",
    )
    text = text.replace(
        "      <SpeakFAB />\n    </div>",
        "      <MobileBottomNav activeHref={activeHref} />\n      <SpeakFAB />\n    </div>",
    )
    layout.write_text(text, encoding="utf-8")

nav = R / "src/app/lib/nav.ts"
nt = nav.read_text(encoding="utf-8")
if "nav.schedule" not in nt:
    nt = nt.replace(
        "  { href: '/relay', labelKey: 'nav.relay', domain: 'field', roleRoots: ['owner', 'pm', 'field_hand'] },\n",
        "  { href: '/relay', labelKey: 'nav.relay', domain: 'field', roleRoots: ['owner', 'pm', 'field_hand'] },\n"
        "  { href: '/schedule', labelKey: 'nav.schedule', domain: 'schedule', roleRoots: ROLE_ROOTS_ALL },\n"
        "  { href: '/reports', labelKey: 'nav.reports', domain: 'audit', roleRoots: ['owner', 'pm', 'admin_ops'] },\n"
        "  { href: '/settings', labelKey: 'nav.settings', domain: 'settings', roleRoots: ['owner', 'admin_ops'] },\n",
    )
    nav.write_text(nt, encoding="utf-8")

css = R / "src/app/styles/shell.css"
css.write_text(css.read_text(encoding="utf-8").replace("4.75rem", "5.5rem"), encoding="utf-8")

for rel in ["src/app/pages/projects/[id]/index.astro", "src/app/pages/projects/[id]/[tab].astro"]:
    p = R / rel
    if not p.exists():
        continue
    lines = p.read_text(encoding="utf-8").splitlines(True)
    out = []
    i = 0
    while i < len(lines):
        if "<ActionsStrip" in lines[i] and "wired" not in lines[i]:
            out.append('        <ActionsStrip surface="project_detail" projectId={project.project_id} tenantId={context.tenantId} wired />\n')
            i += 1
            while i < len(lines) and "/>" not in lines[i]:
                i += 1
            i += 1
            continue
        if lines[i].strip().startswith("<script define:vars={{ projectId"):
            i += 1
            while i < len(lines) and "</script>" not in lines[i]:
                i += 1
            i += 1
            continue
        if "lane23-export-status" in lines[i]:
            i += 1
            continue
        out.append(lines[i])
        i += 1
    p.write_text("".join(out), encoding="utf-8")

print("applied")
