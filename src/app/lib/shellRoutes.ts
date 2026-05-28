import type { I18nKey } from '../../i18n/keys.js';
export interface ShellNavLink { readonly href: string; readonly labelKey: I18nKey; }
export interface HomeOperatorLoop { readonly href: string; readonly titleKey: I18nKey; readonly detailKey: I18nKey; }
export const HOME_OPERATOR_LOOPS = [
  { href: '/field-capture', titleKey: 'home.loop.capture.title', detailKey: 'home.loop.capture.detail' },
  { href: '/relay', titleKey: 'home.loop.relay.title', detailKey: 'home.loop.relay.detail' },
  { href: '/projects', titleKey: 'home.loop.projects.title', detailKey: 'home.loop.projects.detail' },
  { href: '/draft-review', titleKey: 'home.loop.draft_review.title', detailKey: 'home.loop.draft_review.detail' },
] as const;
export const MOBILE_BOTTOM_NAV = [
  { href: '/', labelKey: 'shell.nav.home' },
  { href: '/field-capture', labelKey: 'shell.nav.capture' },
  { href: '/relay', labelKey: 'shell.nav.relay' },
  { href: '/projects', labelKey: 'shell.nav.projects' },
  { href: '/more', labelKey: 'shell.nav.more' },
] as const;
export const MORE_NAV_LINKS = [
  { href: '/schedule', labelKey: 'nav.schedule' },
  { href: '/reports', labelKey: 'nav.reports' },
  { href: '/settings', labelKey: 'nav.settings' },
  { href: '/transcript-review', labelKey: 'nav.transcript_review' },
  { href: '/decisions', labelKey: 'nav.decisions' },
  { href: '/blackboard', labelKey: 'nav.blackboard' },
  { href: '/kb-ingestion', labelKey: 'nav.cost_kb' },
  { href: '/clients', labelKey: 'nav.clients' },
  { href: '/role-routing', labelKey: 'nav.role_routing' },
] as const;
