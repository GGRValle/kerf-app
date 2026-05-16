export type VerticalSlicePhase = 'capture' | 'review' | 'draft' | 'approve' | 'audit' | 'none';

export type MatchedRoute =
  | { name: 'dashboard' }
  | { name: 'field-capture' }
  | { name: 'transcript-review' }
  | { name: 'draft-review' }
  | { name: 'decisions-list' }
  | { name: 'decision-detail'; id: string }
  | { name: 'audit-detail'; packetId: string }
  | { name: 'blackboard' }
  | { name: 'kb-ingestion' }
  | { name: 'kb-ingestion-detail'; ingestionId: string }
  | { name: 'relay-list' }
  | { name: 'relay-detail'; entryId: string };

const DECISION_DETAIL = /^\/decisions\/([^/]+)\/?$/;
const AUDIT_DETAIL = /^\/audit\/([^/]+)\/?$/;
const KB_ING_DETAIL = /^\/kb-ingestion\/([^/]+)\/?$/;
const RELAY_DETAIL = /^\/relay\/([^/]+)\/?$/;

export function matchRoute(pathname: string): MatchedRoute {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/dashboard') {
    return { name: 'dashboard' };
  }
  if (p === '/field-capture') {
    return { name: 'field-capture' };
  }
  if (p === '/transcript-review') {
    return { name: 'transcript-review' };
  }
  if (p === '/draft-review') {
    return { name: 'draft-review' };
  }
  if (p === '/decisions') {
    return { name: 'decisions-list' };
  }
  const dm = DECISION_DETAIL.exec(p);
  if (dm?.[1]) {
    return { name: 'decision-detail', id: decodeURIComponent(dm[1]) };
  }
  const am = AUDIT_DETAIL.exec(p);
  if (am?.[1]) {
    return { name: 'audit-detail', packetId: decodeURIComponent(am[1]) };
  }
  if (p === '/blackboard') {
    return { name: 'blackboard' };
  }
  if (p === '/kb-ingestion') {
    return { name: 'kb-ingestion' };
  }
  const kbM = KB_ING_DETAIL.exec(p);
  if (kbM?.[1]) {
    return { name: 'kb-ingestion-detail', ingestionId: decodeURIComponent(kbM[1]) };
  }
  if (p === '/relay') {
    return { name: 'relay-list' };
  }
  const relayM = RELAY_DETAIL.exec(p);
  if (relayM?.[1]) {
    return { name: 'relay-detail', entryId: decodeURIComponent(relayM[1]) };
  }
  return { name: 'dashboard' };
}

export function phaseForRoute(route: MatchedRoute): VerticalSlicePhase {
  switch (route.name) {
    case 'field-capture':
      return 'capture';
    case 'transcript-review':
      return 'review';
    case 'draft-review':
      return 'draft';
    case 'decisions-list':
    case 'decision-detail':
      return 'approve';
    case 'audit-detail':
      return 'audit';
    default:
      return 'none';
  }
}
