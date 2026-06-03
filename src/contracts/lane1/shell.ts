import { KERF_LANE1_SHELL_CONTRACT_VERSION } from './version.js';
import type { ShellBusinessDomain } from './domains.js';

/**
 * Contract 1 · App shell.
 * Desktop: top-bar · role-projected sidebar · content slot · right-docked conversation.
 * Mobile (D-059): fixed bottom bar — Home · Create · Speak · Camera · More.
 */
export interface ShellTopBarContract {
  readonly brandWordmark: 'Right Hand';
  readonly commandPalette: true;
  readonly mic: true;
  readonly roleChipSwitcher: true;
  readonly avatar: true;
}

export interface ShellSidebarContract {
  readonly domains: readonly ShellBusinessDomain[];
  readonly drillDownExpand: true;
  readonly highlightCurrentSubSurface: true;
  /**
   * Sidebar domain visibility derives from route registration — no parallel
   * domain×role list. A role sees a domain iff `registerSurface()` has at least
   * one surface in that domain whose `roleScope` includes the role (D-060).
   */
  readonly roleVisibilityDerivesFrom: 'register_surface_role_scope';
}

export interface ShellConversationPanelContract {
  readonly dock: 'right';
  readonly anchor: 'bottom';
  readonly growingComposer: true;
  readonly importAffordance: '+';
}

export type MobileBottomBarSlotId = 'home' | 'create' | 'speak' | 'camera' | 'more';

export interface MobileBottomBarContract {
  readonly slots: readonly [
    MobileBottomBarSlotId,
    MobileBottomBarSlotId,
    MobileBottomBarSlotId,
    MobileBottomBarSlotId,
    MobileBottomBarSlotId,
  ];
}

export interface AppShellContract {
  readonly version: typeof KERF_LANE1_SHELL_CONTRACT_VERSION;
  readonly topBar: ShellTopBarContract;
  readonly sidebar: ShellSidebarContract;
  readonly contentSlot: true;
  readonly conversationPanel: ShellConversationPanelContract;
  readonly mobileBottomBar: MobileBottomBarContract;
  /** Desktop shell has no bottom tab bar — conversation + sidebar only. */
  readonly desktopBottomBar: false;
}

export const APP_SHELL_CONTRACT: AppShellContract = {
  version: KERF_LANE1_SHELL_CONTRACT_VERSION,
  topBar: {
    brandWordmark: 'Right Hand',
    commandPalette: true,
    mic: true,
    roleChipSwitcher: true,
    avatar: true,
  },
  sidebar: {
    domains: [
      'home',
      'sales',
      'clients',
      'projects',
      'field',
      'schedule',
      'money',
      'people_admin_ops',
      'client_success',
    ],
    drillDownExpand: true,
    highlightCurrentSubSurface: true,
    roleVisibilityDerivesFrom: 'register_surface_role_scope',
  },
  contentSlot: true,
  conversationPanel: {
    dock: 'right',
    anchor: 'bottom',
    growingComposer: true,
    importAffordance: '+',
  },
  mobileBottomBar: {
    slots: ['home', 'create', 'speak', 'camera', 'more'],
  },
  desktopBottomBar: false,
};
