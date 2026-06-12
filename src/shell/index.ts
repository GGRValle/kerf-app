export { readBuildStamp, buildStampPayload, type BuildStamp } from './buildStamp.js';
export {
  SHELL_SESSION_COOKIE,
  issueShellSessionCookie,
  parseShellSessionCookie,
  platformSessionFromShellCookie,
  resolveShellSessionCookieSecure,
  shellSessionSetCookieHeader,
  verifyDeployBasicAuth,
} from './shellAuthSession.js';
export { createInMemorySurfaceRegistry } from './inMemorySurfaceRegistry.js';
