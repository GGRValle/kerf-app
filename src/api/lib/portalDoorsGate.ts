/**
 * Portal doors kill switch · client + sub portal token doors are DISABLED in
 * production until real credentialing ships.
 *
 * The portal doors (POST /portal/login, GET /portal/session/:token, its
 * approval-confirm door, and the /sub/portal/session/:token doors) run on
 * repo-committed fixture tokens (psess_*_demo / subtok_*) with email-hint
 * matching — on the live app they'd be a public, password-less login whose
 * confirm door writes REAL events. Default OFF in production AND on the Fly
 * host (belt + suspenders — a misconfigured NODE_ENV still can't reopen the
 * doors on Fly; mirrors dogfoodTokensEnabled in platformSession.ts); ON in
 * dev/test so the suite + local dogfooding keep working. PORTAL_LOGIN_ENABLED=true
 * is the explicit operator override for supervised demos. Real client/sub
 * credentialing (invites + issued tokens) is a later lane — this gate comes
 * off when that ships.
 */
export function portalClientDoorsEnabled(): boolean {
  return (
    process.env['PORTAL_LOGIN_ENABLED'] === 'true' ||
    (process.env['NODE_ENV'] !== 'production' && !process.env['FLY_APP_NAME'])
  );
}

/** Uniform 403 body for every gated portal door (client + sub). */
export const PORTAL_DOORS_DISABLED_BODY = {
  error: 'portal_login_disabled',
  message:
    'The client portal is not open yet. Your project team will send an invite when it is ready.',
} as const;
