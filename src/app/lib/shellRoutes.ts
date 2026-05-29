import type { I18nKey } from '../../i18n/keys.js';
import type { RoleRoot } from './layout-props.js';
export interface ShellNavLink { readonly href: string; readonly labelKey: I18nKey; }
export interface HomeOperatorLoop { readonly href: string; readonly titleKey: I18nKey; readonly detailKey: I18nKey; }
export const HOME_OPERATOR_LOOPS = [
  { href: '/field-capture', titleKey: 'home.loop.capture.title', detailKey: 'home.loop.capture.detail' },
  { href: '/relay', titleKey: 'home.loop.relay.title', detailKey: 'home.loop.relay.detail' },
  { href: '/projects', titleKey: 'home.loop.projects.title', detailKey: 'home.loop.projects.detail' },
  { href: '/draft-review', titleKey: 'home.loop.draft_review.title', detailKey: 'home.loop.draft_review.detail' },
] as const;

/**
 * Legacy flat mobile nav (pre-1J-C). Retained for back-compat and the
 * `shell.nav.capture` canon reference. The live shell now renders the
 * role-aware {@link bottomNavForRole} 5-slot bar with a center Speak FAB.
 */
export const MOBILE_BOTTOM_NAV = [
  { href: '/', labelKey: 'shell.nav.home' },
  { href: '/field-capture', labelKey: 'shell.nav.capture' },
  { href: '/relay', labelKey: 'shell.nav.relay' },
  { href: '/projects', labelKey: 'shell.nav.projects' },
  { href: '/more', labelKey: 'shell.nav.more' },
] as const;

export type ShellNavIcon = 'home' | 'projects' | 'clients' | 'log' | 'clock' | 'speak' | 'more';

/** A single slot in the canon 5-slot phone tab bar. `speak` marks the center mic FAB. */
export interface ShellBottomNavSlot {
  readonly href: string;
  readonly labelKey: I18nKey;
  readonly icon: ShellNavIcon;
  readonly speak?: boolean;
}

/**
 * Canon F-A1 owner phone tab bar — Home · Projects · Speak · Clients · More.
 * The center slot is the global Right Hand intake, not field capture.
 */
export const OWNER_BOTTOM_NAV: readonly ShellBottomNavSlot[] = [
  { href: '/', labelKey: 'shell.nav.home', icon: 'home' },
  { href: '/projects', labelKey: 'shell.nav.projects', icon: 'projects' },
  { href: '/right-hand', labelKey: 'shell.nav.speak', icon: 'speak', speak: true },
  { href: '/clients', labelKey: 'shell.nav.clients', icon: 'clients' },
  { href: '/more', labelKey: 'shell.nav.more', icon: 'more' },
] as const;

/**
 * Canon F-C1 field-hand phone tab bar — Home · Log · Speak/Habla · Clock · More.
 * Field-default swaps: Log replaces Projects (pos 2), Clock replaces Clients (pos 4).
 * Log → field daily-log surface; Clock → time/schedule surface (nearest live route in V1).
 */
export const FIELD_BOTTOM_NAV: readonly ShellBottomNavSlot[] = [
  { href: '/', labelKey: 'shell.nav.home', icon: 'home' },
  { href: '/field', labelKey: 'shell.nav.log', icon: 'log' },
  { href: '/right-hand', labelKey: 'shell.nav.speak', icon: 'speak', speak: true },
  { href: '/schedule', labelKey: 'shell.nav.clock', icon: 'clock' },
  { href: '/more', labelKey: 'shell.nav.more', icon: 'more' },
] as const;

/** Field hands and subs get the field tab bar; everyone else gets the owner bar. */
export function bottomNavForRole(roleRoot: RoleRoot): readonly ShellBottomNavSlot[] {
  return roleRoot === 'field_hand' || roleRoot === 'sub' ? FIELD_BOTTOM_NAV : OWNER_BOTTOM_NAV;
}
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
