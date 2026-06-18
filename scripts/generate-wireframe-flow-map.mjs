import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const canonDir = path.join(root, 'docs/wireframes/canon');
const outFile = path.join(root, 'docs/wireframes/wireframe-flow-map.html');
const backlogFile = path.join(root, 'docs/wireframes/wireframe-system-build-backlog.md');
const dispatchFile = path.join(root, 'docs/wireframes/wireframe-system-lane-dispatches.md');
const gapRegisterFile = path.join(root, 'docs/wireframes/wireframe-system-gap-register.md');

const SKIP_CONTROLS = new Set([
  'annotated',
  'true scale',
  'dark',
  'light',
  'auto',
]);

const files = readdirSync(canonDir)
  .filter((name) => /^F-.*\.html$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const faceById = new Map();

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeMd(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&rarr;|→/g, '→')
    .replace(/\s+/g, ' ')
    .trim();
}

function textBetween(source, tag) {
  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripTags(match[1]) : '';
}

function idFromFile(file) {
  return file.match(/^(F-[^_]+)_/)?.[1] ?? file.replace(/\.html$/, '');
}

function deviceFromFile(file) {
  if (/_mobile_/.test(file)) return 'mobile';
  if (/_desktop_/.test(file)) return 'desktop';
  return 'matrix';
}

function familyFromId(id) {
  return id.replace(/[a-z]$/, '').replace(/\d+$/, (n) => n);
}

function extractControls(source) {
  const controls = [];
  const add = (kind, attrs, inner) => {
    const label = stripTags(inner);
    if (!label || SKIP_CONTROLS.has(label.toLowerCase())) return;
    if (/^(v|view|theme)$/i.test(label)) return;
    if (/^\d+\s*[·.]\s*(listening|sorting|job note|open lidar)$/i.test(label)) {
      controls.push({ kind: 'state', label, target: attrs.match(/data-go=["']([^"']+)["']/i)?.[1] ?? '' });
      return;
    }
    controls.push({
      kind,
      label: label.slice(0, 96),
      href: attrs.match(/href=["']([^"']+)["']/i)?.[1] ?? '',
      dataGo: attrs.match(/data-go=["']([^"']+)["']/i)?.[1] ?? '',
    });
  };

  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    add('button', match[1], match[2]);
  }
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    add('link', match[1], match[2]);
  }
  return controls.slice(0, 28);
}

function domainFromId(id) {
  if (/^F-(AA|NAV|MEM|ORCH|VW)/.test(id)) return 'System / shared grammar';
  if (/^F-(A|P|AO|TO|SH|ES|C|FL|SU)\d/.test(id)) return 'Role homes';
  if (/^F-(S1|D1|RH|CAM|RC)/.test(id)) return 'Global phone chrome';
  if (/^F-(PR|PS|ML|CO|W1|PA|DL|PN)/.test(id)) return 'Projects';
  if (/^F-(SL|LD|PV|B1|B2|G1|EST|CHG|DS|DES|LIB|SA|RT)/.test(id)) return 'Sales / decisions';
  if (/^F-(MN|BK|PU|VC|INV)/.test(id)) return 'Money';
  if (/^F-(CL|CA|CS|WW|CP|CPS|WAR)/.test(id)) return 'Clients';
  if (/^F-(E1|FD|FU|F1|FH)/.test(id)) return 'Field capture';
  if (/^F-(SC|SB|CR|HR|SP|RR|AD|BC|SUB|SUBM|US|UTIL)/.test(id)) return 'Ops / admin';
  if (/^F-(LND|ON)/.test(id)) return 'Role homes';
  if (/^F-(MK)/.test(id)) return 'Marketing';
  if (/^F-(RP|AV|H1|TD)/.test(id)) return 'Reports / queues';
  return 'Other';
}

function systemContractForFace(id) {
  const exact = {
    'F-A1': ['/', 'mapped_pending_rebuild', 'attention_queue', 'Home attention queue: One Thing, On Deck, Pulse'],
    'F-A1b': ['/', 'mapped_pending_rebuild', 'attention_queue', 'Home attention queue: One Thing, On Deck, Pulse'],
    'F-A2': ['/home/owner', 'mapped_pending_rebuild', 'attention_queue', 'Owner role-root projection'],
    'F-AA1': ['shared AttentionArtifact component', 'mapped_pending_rebuild', 'attention_queue', 'Shared attention artifact mounts on Home, On Me, and review queues'],
    'F-P1': ['/home/pm', 'mapped_pending_rebuild', 'attention_queue', 'PM role-root projection'],
    'F-P2': ['/home/pm', 'mapped_pending_rebuild', 'attention_queue', 'PM role-root projection'],
    'F-AO1': ['/home/admin-ops', 'mapped_pending_rebuild', 'attention_queue', 'Admin/Ops role-root projection'],
    'F-AO2': ['/home/admin-ops', 'mapped_pending_rebuild', 'attention_queue', 'Admin/Ops role-root projection'],
    'F-AD3': ['/home/admin-ops', 'mapped_pending_rebuild', 'attention_queue', 'Admin command home'],
    'F-TO1': ['/home/team-ops', 'mapped_pending_rebuild', 'attention_queue', 'Team/Ops role-root projection'],
    'F-TO2': ['/home/team-ops', 'mapped_pending_rebuild', 'attention_queue', 'Team/Ops role-root projection'],
    'F-FH1': ['/home/field', 'mapped_pending_rebuild', 'capture_gate', 'Field hand execution home'],
    'F-SH1': ['/home/sub or /sub/portal/s/:token', 'client_surface', 'portal_session', 'Subcontractor portal and assignment spine'],
    'F-SH2': ['/home/sub or /sub/portal/s/:token', 'client_surface', 'portal_session', 'Subcontractor portal and assignment spine'],
    'F-ES1': ['/home/estimator', 'mapped_pending_rebuild', 'attention_queue', 'Estimator role-root projection'],
    'F-ES2': ['/home/estimator', 'mapped_pending_rebuild', 'attention_queue', 'Estimator role-root projection'],
    'F-C1': ['/home/field or /field', 'mapped_pending_rebuild', 'capture_gate', 'Field role-root projection'],
    'F-FL1': ['/home/field', 'mapped_pending_rebuild', 'capture_gate', 'Foreman role-root projection'],
    'F-SU1': ['/home/field', 'mapped_pending_rebuild', 'capture_gate', 'Superintendent role-root projection'],
    'F-SU2': ['/home/field', 'mapped_pending_rebuild', 'capture_gate', 'Superintendent role-root projection'],
    'F-S1': ['/create', 'mapped_pending_rebuild', 'navigation_only', 'Start sheet routes to canonical artifact owners'],
    'F-D1': ['/more', 'mapped_pending_rebuild', 'navigation_only', 'Secondary domain drawer'],
    'F-NAV1': ['global shell chrome', 'mapped_pending_rebuild', 'navigation_only', 'Normal view + bubble view chrome'],
    'F-NAV2': ['global bottom bar', 'mapped_pending_rebuild', 'navigation_only', 'Bottom bar center mic doctrine'],
    'F-RH1': ['global overlay + /right-hand fallback', 'canon_wired', 'durable_write_gate', 'SurfaceContext + working draft + conversation spine'],
    'F-RH3': ['global overlay + /right-hand fallback', 'canon_wired', 'durable_write_gate', 'Right Hand conversation lifecycle spine'],
    'F-RH4': ['global overlay + /right-hand fallback', 'mapped_pending_rebuild', 'durable_write_gate', 'Desktop Right Hand compose surface'],
    'F-RH6': ['global overlay + /right-hand fallback', 'mapped_pending_rebuild', 'right_hand_route_only', 'Talk-to-Right-Hand interaction doctrine'],
    'F-RH7': ['global overlay', 'mapped_pending_rebuild', 'right_hand_route_only', 'Right Hand bottom-bloom / travels-never-parks spine'],
    'F-MEM-RH': ['Right Hand memory model', 'mapped_pending_rebuild', 'right_hand_route_only', 'Right Hand working set / memory stack'],
    'F-ORCH1': ['background orchestration', 'future_or_unrouted', 'review_gate', 'Background orchestration flow'],
    'F-VW1': ['global overlay viewing window', 'mapped_pending_rebuild', 'right_hand_route_only', 'Viewing window voice editing doctrine'],
    'F-CAM1': ['/camera', 'canon_wired', 'capture_route_confirm', 'Capture-first camera; route after capture'],
    'F-RC1': ['/room-capture', 'mapped_pending_rebuild', 'capture_route_confirm', 'Room scan capture spine'],
    'F-RT1': ['/room-capture', 'mapped_pending_rebuild', 'review_gate', 'Room takeoff / scan review'],
    'F-E1': ['/field-capture', 'canon_wired', 'capture_route_confirm', 'Field capture -> Daily Log / review spine'],
    'F-DL1': ['/projects/:id/daily-log', 'future_or_unrouted', 'capture_route_confirm', 'Capture -> Daily Log -> Project graph spine'],
    'F-DL2': ['/projects/:id/daily-log', 'future_or_unrouted', 'capture_route_confirm', 'Field hand daily log + clock-out'],
    'F-DL3': ['/settings or /home/field', 'future_or_unrouted', 'admin_gate', 'Field guidance level settings'],
    'F-FD1': ['/field-detail', 'mapped_pending_rebuild', 'review_gate', 'Field item drilldown'],
    'F-FD2': ['/field-detail', 'mapped_pending_rebuild', 'review_gate', 'Field item drilldown'],
    'F-FU1': ['/relay', 'mapped_pending_rebuild', 'review_gate', 'Office review queue for field updates'],
    'F-F1': ['/transcript-review', 'mapped_pending_rebuild', 'review_gate', 'Transcript review -> draft/review/audit spine'],
    'F-PR1': ['/projects', 'mapped_pending_rebuild', 'navigation_only', 'Project graph index'],
    'F-PR3': ['/projects', 'mapped_pending_rebuild', 'navigation_only', 'Project graph index'],
    'F-PR0a': ['/projects/new', 'mapped_pending_rebuild', 'operator_confirm', 'Client/project graph creation spine'],
    'F-PR0b': ['/projects/new', 'mapped_pending_rebuild', 'operator_confirm', 'Client/project graph creation spine'],
    'F-PR2': ['/projects/:id', 'mapped_pending_rebuild', 'project_artifact_owner', 'Project canonical home and lenses'],
    'F-PR4': ['/projects/:id', 'mapped_pending_rebuild', 'project_artifact_owner', 'Project canonical home and lenses'],
    'F-PS1': ['/projects/:id/status', 'mapped_pending_rebuild', 'project_artifact_owner', 'Project status lens'],
    'F-PN1': ['/projects/:id/notes', 'future_or_unrouted', 'project_artifact_owner', 'Project notes lens'],
    'F-ML1': ['/projects/:id/media', 'future_or_unrouted', 'capture_route_confirm', 'Project media lens is not a distinct live route yet'],
    'F-ML2': ['/projects/:id/media', 'future_or_unrouted', 'capture_route_confirm', 'Project media lens is not a distinct live route yet'],
    'F-CO1a': ['/projects/:id/closeout', 'mapped_pending_rebuild', 'operator_confirm', 'Project closeout spine'],
    'F-CO1b': ['/projects/:id/closeout', 'mapped_pending_rebuild', 'operator_confirm', 'Project closeout spine'],
    'F-W1': ['/projects/:id/work-orders/:wid or /sub/portal/s/:token/a/:assignmentId', 'client_surface', 'portal_session', 'Work order / assignment spine'],
    'F-PA1a': ['/projects?archive=1', 'future_or_unrouted', 'navigation_only', 'Project archive state'],
    'F-PA1b': ['/projects?archive=1', 'future_or_unrouted', 'navigation_only', 'Project archive state'],
    'F-SL1': ['/sales', 'mapped_pending_rebuild', 'navigation_only', 'Sales pipeline spine'],
    'F-SL2': ['/sales', 'mapped_pending_rebuild', 'navigation_only', 'Sales pipeline spine'],
    'F-SL3': ['/sales/:id', 'mapped_pending_rebuild', 'navigation_only', 'Deal detail -> design -> estimate spine'],
    'F-SL4': ['/sales/:id', 'mapped_pending_rebuild', 'navigation_only', 'Deal detail -> design -> estimate spine'],
    'F-SA1': ['/sales', 'mapped_pending_rebuild', 'navigation_only', 'Sales command home'],
    'F-DES1a': ['/design/:projectId', 'mapped_pending_rebuild', 'review_gate', 'Deal -> design -> estimate spine'],
    'F-DS1': ['/design/:projectId', 'mapped_pending_rebuild', 'review_gate', 'Design workspace -> estimate spine'],
    'F-LIB1': ['/library', 'mapped_pending_rebuild', 'review_gate', 'Libraries / selections / cost knowledge'],
    'F-LD1a': ['/sales?state=lost', 'future_or_unrouted', 'navigation_only', 'Lost-deal state in Sales'],
    'F-LD1b': ['/sales?state=lost', 'future_or_unrouted', 'navigation_only', 'Lost-deal state in Sales'],
    'F-PV1': ['/estimate/:projectId/proposal or /proposals/:id/preview', 'mapped_pending_rebuild', 'send_signature_gate', 'Proposal projection; estimate-owned until signed'],
    'F-PV2': ['/estimate/:projectId/proposal or /proposals/:id/preview', 'mapped_pending_rebuild', 'send_signature_gate', 'Proposal projection; estimate-owned until signed'],
    'F-INV1a': ['/estimate/:projectId/invoice or /projects/:id/money/invoices', 'mapped_pending_rebuild', 'money_guard', 'Estimate line_id -> contract milestone -> invoice spine'],
    'F-INV1b': ['/estimate/:projectId/invoice or /projects/:id/money/invoices', 'mapped_pending_rebuild', 'money_guard', 'Estimate line_id -> contract milestone -> invoice spine'],
    'F-INV2a': ['/estimate/:projectId/invoice/:invoiceId or /money/invoices/:id', 'mapped_pending_rebuild', 'money_guard', 'Contract milestone -> invoice detail -> payment spine'],
    'F-INV2b': ['/estimate/:projectId/invoice/:invoiceId or /money/invoices/:id', 'mapped_pending_rebuild', 'money_guard', 'Contract milestone -> invoice detail -> payment spine'],
    'F-EST1': ['/estimate/:projectId', 'mapped_pending_rebuild', 'operator_confirm', 'Estimate -> proposal -> invoice line_id spine'],
    'F-CHG1': ['/change-orders/new', 'future_or_unrouted', 'operator_confirm', 'Change order -> decision card -> contract adjustment spine'],
    'F-G1': ['/draft-review/:draft_id', 'mapped_pending_rebuild', 'review_gate', 'Draft review gate'],
    'F-B1': ['/decisions/:id', 'mapped_pending_rebuild', 'operator_confirm', 'Decision card consequence gate'],
    'F-B1b': ['/decisions/:id?mode=edit', 'mapped_pending_rebuild', 'operator_confirm', 'Decision edit gate'],
    'F-B1c': ['/proposals/:id/send', 'mapped_pending_rebuild', 'send_signature_gate', 'Client preview / send gate'],
    'F-B2': ['/decisions/:id', 'mapped_pending_rebuild', 'operator_confirm', 'Decision card consequence gate'],
    'F-CL1': ['/clients', 'mapped_pending_rebuild', 'navigation_only', 'Client graph index'],
    'F-CL3': ['/clients', 'mapped_pending_rebuild', 'navigation_only', 'Client graph index'],
    'F-CL0a': ['/clients/new', 'mapped_pending_rebuild', 'operator_confirm', 'Client graph creation spine'],
    'F-CL0b': ['/clients/new', 'mapped_pending_rebuild', 'operator_confirm', 'Client graph creation spine'],
    'F-CL2': ['/clients/:id', 'mapped_pending_rebuild', 'client_artifact_owner', 'Client canonical home'],
    'F-CL4': ['/clients/:id', 'mapped_pending_rebuild', 'client_artifact_owner', 'Client canonical home'],
    'F-CL5': ['/clients/:id', 'mapped_pending_rebuild', 'client_artifact_owner', 'Client record'],
    'F-CL6': ['/clients/:id', 'mapped_pending_rebuild', 'client_artifact_owner', 'Client record'],
    'F-CP1': ['/portal/s/:token', 'client_surface', 'portal_session', 'Client portal projection'],
    'F-CPS1': ['/portal/s/:token or /projects/:id/status', 'client_surface', 'portal_session', 'Client-facing project status projection'],
    'F-CA1a': ['/clients?archive=1', 'future_or_unrouted', 'navigation_only', 'Client archive state'],
    'F-CA1b': ['/clients?archive=1', 'future_or_unrouted', 'navigation_only', 'Client archive state'],
    'F-CS1': ['/client-success/:clientId or /projects/:id/portal-preview', 'mapped_pending_rebuild', 'client_review_gate', 'Client success / portal preview spine'],
    'F-CS2': ['/client-success/:clientId or /projects/:id/portal-preview', 'mapped_pending_rebuild', 'client_review_gate', 'Client success / portal preview spine'],
    'F-WW1a': ['/clients/:id/warranty', 'mapped_pending_rebuild', 'client_artifact_owner', 'Warranty lane'],
    'F-WW1b': ['/clients/:id/warranty', 'mapped_pending_rebuild', 'client_artifact_owner', 'Warranty lane'],
    'F-WAR1': ['/clients/:id/warranty', 'mapped_pending_rebuild', 'client_artifact_owner', 'Warranty client-success/admin tracking'],
    'F-SC1': ['/schedule', 'mapped_pending_rebuild', 'navigation_only', 'Schedule domain'],
    'F-SC2': ['/schedule', 'mapped_pending_rebuild', 'navigation_only', 'Schedule domain'],
    'F-SB1': ['/team-ops/subs', 'mapped_pending_rebuild', 'navigation_only', 'Subs/team ops spine'],
    'F-SB2': ['/team-ops/subs', 'mapped_pending_rebuild', 'navigation_only', 'Subs/team ops spine'],
    'F-SUBM1': ['/team-ops/subs', 'mapped_pending_rebuild', 'navigation_only', 'Subs management'],
    'F-SUB1': ['/sub/portal/s/:token', 'client_surface', 'portal_session', 'Sub portal'],
    'F-CR1': ['/team-ops/subs', 'mapped_pending_rebuild', 'navigation_only', 'Crew folded into team ops'],
    'F-CR2': ['/team-ops/subs', 'mapped_pending_rebuild', 'navigation_only', 'Crew folded into team ops'],
    'F-HR1a': ['/team-ops/time', 'future_or_unrouted', 'time_gate', 'Time tracking route missing'],
    'F-HR1b': ['/team-ops/time', 'future_or_unrouted', 'time_gate', 'Time tracking route missing'],
    'F-HR2': ['/team-ops/docs', 'future_or_unrouted', 'document_gate', 'Employee docs route missing'],
    'F-SP1': ['/settings', 'mapped_pending_rebuild', 'admin_gate', 'Settings hub'],
    'F-SP1a': ['/settings/me', 'mapped_pending_rebuild', 'admin_gate', 'Account editor'],
    'F-US1': ['/settings/me', 'mapped_pending_rebuild', 'admin_gate', 'User settings'],
    'F-UTIL1a': ['/connections + /kb-ingestion + /blackboard', 'mapped_pending_rebuild', 'admin_gate / review_gate', 'Settings / knowledge / Blackboard utility spine'],
    'F-UTIL1b': ['/connections + /kb-ingestion + /blackboard', 'mapped_pending_rebuild', 'admin_gate / review_gate', 'Settings / knowledge / Blackboard utility spine'],
    'F-RR1': ['/role-routing', 'mapped_pending_rebuild', 'admin_gate', 'Role routing matrix'],
    'F-BC1': ['/settings or /more', 'future_or_unrouted', 'admin_gate', 'Bottom bar customization route missing'],
    'F-AD1': ['/settings or /home/admin-ops', 'future_or_unrouted', 'admin_gate', 'Admin landing not distinct yet'],
    'F-AD2': ['/settings or /home/admin-ops', 'future_or_unrouted', 'admin_gate', 'Admin landing not distinct yet'],
    'F-RP1': ['/reports', 'mapped_pending_rebuild', 'review_gate', 'Reports center'],
    'F-RP2': ['/reports', 'mapped_pending_rebuild', 'review_gate', 'Reports center'],
    'F-AV1a': ['/reports or /audit/:packetId', 'future_or_unrouted', 'review_gate', 'Audit portfolio state'],
    'F-AV1b': ['/reports or /audit/:packetId', 'future_or_unrouted', 'review_gate', 'Audit portfolio state'],
    'F-H1': ['/audit/:packetId', 'mapped_pending_rebuild', 'audit_read_only', 'Audit detail spine'],
    'F-TD1': ['/on-me', 'mapped_pending_rebuild', 'task_gate', 'Global to-do / On Me queue'],
    'F-TD2': ['/on-me', 'mapped_pending_rebuild', 'task_gate', 'Global to-do / On Me queue'],
    'F-ON1': ['/on-me', 'mapped_pending_rebuild', 'task_gate', 'On Me / Today two-stream queue'],
    'F-LND1': ['/login', 'mapped_pending_rebuild', 'navigation_only', 'Landing / login role routing'],
    'F-MK1': ['/marketing', 'future_or_unrouted', 'navigation_only', 'Marketing domain missing live route'],
    'F-MK2': ['/marketing', 'future_or_unrouted', 'navigation_only', 'Marketing domain missing live route'],
    'F-MK3': ['/marketing/reviews', 'future_or_unrouted', 'navigation_only', 'Marketing reviews route missing'],
    'F-MK4': ['/marketing/reviews', 'future_or_unrouted', 'navigation_only', 'Marketing reviews route missing'],
    'F-MK5': ['/marketing/outreach', 'future_or_unrouted', 'navigation_only', 'Marketing outreach route missing'],
    'F-MK6': ['/marketing/outreach', 'future_or_unrouted', 'navigation_only', 'Marketing outreach route missing'],
    'F-MK7': ['/marketing/attribution', 'future_or_unrouted', 'navigation_only', 'Marketing attribution route missing'],
    'F-MK8': ['/marketing/attribution', 'future_or_unrouted', 'navigation_only', 'Marketing attribution route missing'],
    'F-MK9': ['/marketing/leads or /sales', 'future_or_unrouted', 'navigation_only', 'Leads currently fold into Sales'],
    'F-MK10': ['/marketing/leads or /sales', 'future_or_unrouted', 'navigation_only', 'Leads currently fold into Sales'],
  };
  if (exact[id]) {
    const [route, status, gate, spineDependency] = exact[id];
    return { owningRoute: route, routeStatus: status, gate, spineDependency };
  }
  if (/^F-MN/.test(id)) return { owningRoute: '/money', routeStatus: 'mapped_pending_rebuild', gate: 'money_guard', spineDependency: 'Money ledger / AR / AP spine' };
  if (/^F-INV/.test(id)) return { owningRoute: '/estimate/:projectId/invoice or /money/invoices/:id', routeStatus: 'mapped_pending_rebuild', gate: 'money_guard', spineDependency: 'Estimate line_id -> contract milestone -> invoice spine' };
  if (/^F-BK/.test(id)) return { owningRoute: '/money/bookkeeping', routeStatus: 'mapped_pending_rebuild', gate: 'money_guard', spineDependency: 'Bookkeeping / QB export spine' };
  if (/^F-PU/.test(id)) return { owningRoute: '/money/purchasing', routeStatus: 'future_or_unrouted', gate: 'money_guard', spineDependency: 'Purchasing/vendor spine missing route' };
  if (/^F-VC/.test(id)) return { owningRoute: '/money/spend-card', routeStatus: 'future_or_unrouted', gate: 'money_guard', spineDependency: 'Spend card route missing' };
  return { owningRoute: 'unmapped', routeStatus: 'future_or_unrouted', gate: 'conductor_decision', spineDependency: 'Needs route assignment' };
}

function transitionGate(transition, face) {
  const text = `${transition.trigger} ${transition.target || ''} ${transition.missing || ''} ${transition.note || ''}`.toLowerCase();
  if (transition.missing) return 'gap_build_required';
  if (transition.state) return 'in_face_state';
  if (/\b(send|sign|approve|reject|confirm|file|save|submit|export|issue|record payment|create invoice|create project|create client|bill|pay|payment)\b/.test(text)) {
    if (/\b(money|invoice|ar|ap|qb|export|issue|record payment|bill|pay|payment)\b/.test(text) || /^F-(MN|BK|PU|VC|INV)/.test(transition.target || '')) return 'money_or_egress_guard';
    return 'operator_confirm';
  }
  if (/right hand|speak|mic|ask/.test(text) || /^F-RH/.test(transition.target || '')) return 'right_hand_route_only';
  if (face?.system?.gate === 'client_review_gate') return 'client_review_gate';
  if (face?.system?.gate?.includes('admin_gate') && /connect|oauth|integration|manage/.test(text)) return 'admin_gate';
  if (face?.system?.gate?.includes('review_gate') && /knowledge|kb|blackboard|memory|review|preview/.test(text)) return 'review_gate';
  return 'navigation';
}

function transitionSpine(transition, face) {
  const text = `${transition.trigger} ${transition.target || ''} ${transition.missing || ''} ${transition.note || ''}`.toLowerCase();
  if (transition.missing) return 'missing_face_backlog';
  if (/^(home|start|more)$/i.test(transition.trigger)) return 'global_navigation';
  if (/daily log|capture|camera|field|transcript/.test(text) || /^F-(CAM|E1|FD|FU|F1|RC)/.test(transition.target || '')) return 'capture_to_daily_log_review';
  if (/proposal|estimate|decision|draft/.test(text) || /^F-(PV|B1|B2|G1|SL|ES)/.test(transition.target || '')) return 'estimate_proposal_decision_spine';
  if (/\b(money|invoice|ar|ap|qb|vendor|margin|allowance)\b/.test(text) || /^F-(MN|BK|PU|VC)/.test(transition.target || '')) return 'money_spine';
  if (/connections|integration|knowledge|kb|blackboard|memory/.test(text) || /^F-UTIL/.test(transition.target || '')) return 'settings_knowledge_utility_spine';
  if (/client|warranty|portal/.test(text) || /^F-(CL|CS|CA|WW|SH|W1)/.test(transition.target || '')) return 'client_portal_spine';
  if (/project|work order|closeout|status|media/.test(text) || /^F-(PR|PS|ML|CO|PA)/.test(transition.target || '')) return 'project_graph_spine';
  if (/right hand|speak|mic/.test(text) || /^F-RH/.test(transition.target || '')) return 'right_hand_surface_context';
  return face?.system?.spineDependency || 'domain_navigation';
}

const faces = files.map((file) => {
  const source = readFileSync(path.join(canonDir, file), 'utf8');
  const id = idFromFile(file);
  const title = textBetween(source, 'title') || file;
  const h1 = textBetween(source, 'h1');
  const face = {
    id,
    file,
    title,
    h1,
    device: deviceFromFile(file),
    domain: domainFromId(id),
    system: systemContractForFace(id),
    canonCorrection:
      id === 'F-CAM1'
        ? 'Founder correction 2026-06-14: camera is capture-first. Destination routing happens after capture; the source file title is superseded.'
        : '',
    controls: extractControls(source),
    transitions: [],
  };
  faceById.set(id, face);
  return face;
});

function target(id, note = '') {
  return { target: id, missing: '', note };
}

function faceIdFromFileLabel(label) {
  return String(label).match(/^(F-[^_]+)_/)?.[1] ?? '';
}

function missing(label, note = '') {
  const existingFace = faceIdFromFileLabel(label);
  if (existingFace && faceById.has(existingFace)) return target(existingFace, note);
  return { target: '', missing: label, note };
}

function state(note = '') {
  return { target: '', state: true, missing: '', note };
}

function missingFaceForDevice(generic, device = 'mobile') {
  const lane = device === 'desktop' ? 'desktop' : 'mobile';
  const map = {
    'Per-job invoice list face': {
      mobile: 'F-INV1a_mobile_per_job_invoice_list.html',
      desktop: 'F-INV1b_desktop_per_job_invoice_list.html',
    },
    'Per-job invoice detail face': {
      mobile: 'F-INV2a_mobile_per_job_invoice_detail.html',
      desktop: 'F-INV2b_desktop_per_job_invoice_detail.html',
    },
    'Project setup / new project face': {
      mobile: 'F-PR0a_mobile_project_setup.html',
      desktop: 'F-PR0b_desktop_project_setup.html',
    },
    'Design workspace face': {
      mobile: 'F-DES1a_mobile_design_workspace.html',
      desktop: 'F-DS1_desktop_design_workspace.html',
    },
    'Connections face': {
      mobile: 'F-UTIL1a_mobile_connections_kb_blackboard.html',
      desktop: 'F-UTIL1b_desktop_connections_kb_blackboard.html',
    },
    'New client face': {
      mobile: 'F-CL0a_mobile_client_create.html',
      desktop: 'F-CL0b_desktop_client_create.html',
    },
  };
  return map[generic]?.[lane] ?? generic;
}

function deviceFromGapLabel(label, fallback = 'unassigned') {
  if (/_mobile_|mobile/i.test(label)) return 'mobile';
  if (/_desktop_|desktop/i.test(label)) return 'desktop';
  if (/matrix/i.test(label)) return 'matrix';
  return fallback;
}

function add(ids, transitions) {
  for (const id of ids) {
    const face = faceById.get(id);
    if (!face) continue;
    face.transitions.push(...transitions);
  }
}

const bottomNav = [
  { trigger: 'Home', ...target('F-A1', 'Bottom bar home') },
  { trigger: 'Start', ...target('F-S1', 'Bottom bar Start sheet') },
  { trigger: 'Speak / center mic', ...target('F-RH1', 'Global Right Hand overlay; F-RH7 defines the imported bubble/bloom behavior') },
  { trigger: 'Camera', ...target('F-CAM1', 'Global camera face') },
  { trigger: 'More', ...target('F-D1', 'More sidebar') },
];

add(['F-A1', 'F-A1b', 'F-A2'], [
  ...bottomNav,
  { trigger: 'One Thing / priority card', ...target('F-B1', 'Decision or review item selected from home') },
  { trigger: 'Project pulse tile', ...target('F-PR2', 'Project detail / project lens') },
  { trigger: 'Money pulse', ...target('F-MN1', 'Money domain') },
]);
add(['F-AA1'], [
  { trigger: 'Mount on Home', ...target('F-A1b') },
  { trigger: 'Mount on On Me', ...target('F-ON1') },
  { trigger: 'Open artifact owner', ...target('F-B1', 'Attention artifact routes to the owning artifact, not a detached task') },
]);
add(['F-P1', 'F-P2'], [
  ...bottomNav,
  { trigger: 'Project needing PM', ...target('F-PR2') },
  { trigger: 'Schedule conflict', ...target('F-SC1') },
  { trigger: 'Field update', ...target('F-FU1') },
]);
add(['F-AO1', 'F-AO2'], [
  ...bottomNav,
  { trigger: 'Bookkeeping / QB sync', ...target('F-BK1a') },
  { trigger: 'AP / vendor issue', ...target('F-MN7a') },
  { trigger: 'Settings / company ops', ...target('F-SP1') },
]);
add(['F-AD3'], [
  ...bottomNav,
  { trigger: 'Money issue', ...target('F-MN1') },
  { trigger: 'Team/Ops', ...target('F-SB1') },
  { trigger: 'Settings', ...target('F-SP1') },
  { trigger: 'On Me', ...target('F-ON1') },
]);
add(['F-TO1', 'F-TO2'], [
  ...bottomNav,
  { trigger: 'Subs', ...target('F-SB1') },
  { trigger: 'Crew', ...target('F-CR1') },
  { trigger: 'Time tracking', ...target('F-HR1a') },
  { trigger: 'Employee docs', ...target('F-HR2') },
]);
add(['F-SH1', 'F-SH2'], [
  ...bottomNav,
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-ES1', 'F-ES2'], [
  ...bottomNav,
  { trigger: 'Sales pipeline', ...target('F-SL1') },
  { trigger: 'Deal detail', ...target('F-SL3') },
  { trigger: 'Estimate builder', ...missing('F-EST1_mobile_estimate_builder.html', 'Referenced in current canon conversation, not present in docs/wireframes/canon') },
]);
add(['F-C1', 'F-FL1', 'F-SU1', 'F-SU2'], [
  ...bottomNav,
  { trigger: 'Capture', ...target('F-E1') },
  { trigger: 'Project detail', ...target('F-PR2') },
  { trigger: 'Work order', ...target('F-W1') },
]);
add(['F-FH1'], [
  ...bottomNav,
  { trigger: 'Capture now', ...target('F-E1') },
  { trigger: 'Daily Log', ...target('F-DL1') },
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Project', ...target('F-PR2') },
]);

add(['F-S1'], [
  { trigger: 'New estimate', ...missing('F-EST1_mobile_estimate_builder.html', 'Missing face; should land on estimate builder, not project setup first') },
  { trigger: 'Daily log note', ...missing('F-DL1_mobile_daily_log.html', 'Missing face; Daily Log canonical surface not in repo canon') },
  { trigger: 'Change order', ...missing('F-CHG1_mobile_change_order_builder.html', 'Missing face; should flow to builder then F-B1 decision card') },
  { trigger: 'Invoice', ...missing('Per-job invoice list face', 'Deposit / progress / final invoice list per job is not present as a canon file') },
  { trigger: 'Room scan / LiDAR', ...target('F-RC1') },
  { trigger: 'Ask Right Hand', ...target('F-RH1') },
]);
add(['F-D1'], [
  { trigger: 'Schedule', ...target('F-SC1') },
  { trigger: 'Reports', ...target('F-RP1') },
  { trigger: 'Settings', ...target('F-SP1') },
  { trigger: 'Transcript review', ...target('F-F1') },
  { trigger: 'Decisions', ...target('F-B1') },
  { trigger: 'Blackboard', ...target('F-UTIL1a', 'Mobile utility face state for read-only Blackboard preview') },
  { trigger: 'Cost KB', ...target('F-UTIL1a', 'Mobile utility face state for cost knowledge review') },
  { trigger: 'Clients', ...target('F-CL1') },
  { trigger: 'Marketing', ...target('F-MK1') },
]);
add(['F-NAV1', 'F-NAV2'], [
  ...bottomNav,
  { trigger: 'Tap to talk pill', ...target('F-RH7') },
  { trigger: 'Bubble view', ...target('F-RH7') },
]);
add(['F-RH1'], [
  { trigger: 'Stop listening', ...state('Internal overlay state: listening -> sorting') },
  { trigger: 'Save to job', ...target('F-PR2', 'Files to job/project after confirmation') },
  { trigger: 'Not that', ...state('Correction loop inside Right Hand') },
  { trigger: 'Open LiDAR', ...target('F-RC1') },
  { trigger: 'Conversation lifecycle', ...target('F-RH3') },
]);
add(['F-RH3'], [
  { trigger: 'Attach source', ...target('F-CAM1', 'Attach camera/photo/source to thread') },
  { trigger: 'Save/confirm', ...target('F-PR2', 'Durable write returns to canonical artifact') },
  { trigger: 'Keep talking', ...target('F-RH1') },
  { trigger: 'Bubble transition', ...target('F-RH7', 'Imported Canon bubble/bloom behavior') },
]);
add(['F-RH4', 'F-RH6', 'F-MEM-RH', 'F-VW1'], [
  { trigger: 'Speak / compose', ...target('F-RH1') },
  { trigger: 'Bubble behavior', ...target('F-RH7') },
  { trigger: 'Attach source', ...target('F-CAM1') },
  { trigger: 'Return to artifact', ...state('Right Hand travels with context; artifact stays on its owning route') },
]);
add(['F-RH7'], [
  { trigger: 'Tap to talk pill', ...target('F-RH1', 'Side pill opens the same Right Hand conversation surface') },
  { trigger: 'Bottom bloom', ...target('F-RH1', 'Bloom grows from center mic into conversation') },
  { trigger: 'Attach source', ...target('F-CAM1', 'Composer attach opens capture/source picker') },
  { trigger: 'Return to artifact', ...state('Overlay travels; it does not park on its own artifact route') },
]);
add(['F-CAM1'], [
  { trigger: 'Open camera', ...target('F-CAM1', 'Capture starts immediately; no pre-capture job gate') },
  { trigger: 'Walkthru mode', ...target('F-CAM1', 'Internal camera mode') },
  { trigger: 'Photo mode', ...target('F-CAM1', 'Internal camera mode') },
  { trigger: 'Scan mode', ...target('F-CAM1', 'Internal camera mode; document source for estimate/CO') },
  { trigger: 'Done / confirm destination', ...target('F-DL1', 'Route after capture; filed capture should land in Daily Log or project media') },
  { trigger: 'Route to new client', ...target('F-CL0a', 'Capture-first route for new lead/intake') },
  { trigger: 'Route to new project', ...target('F-PR0a', 'Capture-first route when the job does not exist yet') },
  { trigger: 'Save to review', ...target('F-FU1', 'Hold captured evidence for office review when destination is unclear') },
  { trigger: 'Room scan', ...target('F-RC1') },
]);
add(['F-ORCH1'], [
  { trigger: 'Surface context read', ...target('F-RH1') },
  { trigger: 'Review gate', ...target('F-G1') },
  { trigger: 'Audit detail', ...target('F-H1') },
]);
add(['F-RC1'], [
  { trigger: 'Back to camera/start', ...target('F-CAM1') },
  { trigger: 'Add to project', ...target('F-PR2') },
  { trigger: 'Release preview', ...target('F-B1', 'Consequence gate if source becomes durable artifact') },
]);
add(['F-RT1'], [
  { trigger: 'Back to room capture', ...target('F-RC1') },
  { trigger: 'Design workspace', ...target('F-DS1') },
  { trigger: 'Build estimate', ...target('F-EST1') },
]);

add(['F-E1'], [
  { trigger: 'Take photo', ...target('F-CAM1') },
  { trigger: 'Attach file', ...state('File picker / preflight state') },
  { trigger: 'Type note', ...state('Typed note state') },
  { trigger: 'Done / submit', ...target('F-DL1', 'Filed capture lands on Daily Log / Project after route confirmation') },
  { trigger: 'Office review', ...target('F-FU1') },
  { trigger: 'Transcript review', ...target('F-F1') },
  { trigger: 'Field detail', ...target('F-FD1') },
]);
add(['F-DL1'], [
  { trigger: 'Add media', ...target('F-CAM1') },
  { trigger: 'File / done', ...target('F-PR2', 'Daily Log is project-owned after visible confirmation') },
  { trigger: 'Project', ...target('F-PR2') },
  { trigger: 'Office review', ...target('F-FU1') },
  { trigger: 'Work order', ...target('F-W1') },
]);
add(['F-DL2'], [
  { trigger: 'File Daily Log', ...target('F-DL1') },
  { trigger: 'Clock out', ...target('F-FH1') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-DL3'], [
  { trigger: 'Back settings', ...target('F-US1') },
  { trigger: 'Field home preview', ...target('F-FH1') },
]);
add(['F-FD1', 'F-FD2'], [
  { trigger: 'View transcript review', ...target('F-F1') },
  { trigger: 'View audit detail', ...target('F-H1') },
  { trigger: 'Back to field updates', ...target('F-FU1') },
]);
add(['F-FU1'], [
  { trigger: 'Review update', ...target('F-FD1') },
  { trigger: 'Continue draft', ...target('F-G1') },
  { trigger: 'Transcript', ...target('F-F1') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-F1'], [
  { trigger: 'Save transcript edit', ...target('F-G1') },
  { trigger: 'Classify as project-specific', ...target('F-G1') },
  { trigger: 'Classify as universal', ...target('F-H1') },
  { trigger: 'Back to field capture', ...target('F-E1') },
]);

add(['F-PR1', 'F-PR3'], [
  { trigger: 'Project row', ...target('F-PR2') },
  { trigger: 'Project archive', ...target('F-PA1a') },
  { trigger: 'New project', ...missing('Project setup / new project face', 'No dedicated Canon file') },
]);
add(['F-PR2', 'F-PR4'], [
  { trigger: 'Status', ...target('F-PS1') },
  { trigger: 'Media', ...target('F-ML1') },
  { trigger: 'Daily Log', ...target('F-DL1') },
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Closeout', ...target('F-CO1a') },
  { trigger: 'Money lens', ...target('F-MN1') },
  { trigger: 'Proposal', ...target('F-PV1') },
]);
add(['F-PN1'], [
  { trigger: 'Back project', ...target('F-PR2') },
  { trigger: 'Ask Right Hand', ...target('F-RH1') },
  { trigger: 'File to Daily Log', ...target('F-DL1') },
]);
add(['F-PS1'], [
  { trigger: 'Scope / project detail', ...target('F-PR2') },
  { trigger: 'Audit', ...target('F-H1') },
  { trigger: 'Relay / updates', ...target('F-FU1') },
]);
add(['F-ML1', 'F-ML2'], [
  { trigger: 'Open media item', ...target('F-FD1') },
  { trigger: 'Add media', ...target('F-CAM1') },
  { trigger: 'Back project', ...target('F-PR2') },
]);
add(['F-CO1a', 'F-CO1b'], [
  { trigger: 'Audit detail', ...target('F-H1') },
  { trigger: 'Project detail', ...target('F-PR2') },
]);
add(['F-W1'], [
  { trigger: 'Project', ...target('F-PR2') },
  { trigger: 'Sub home', ...target('F-SH1') },
]);
add(['F-PA1a', 'F-PA1b'], [
  { trigger: 'Project row', ...target('F-PR2') },
  { trigger: 'Back projects', ...target('F-PR1') },
]);

add(['F-SL1', 'F-SL2'], [
  { trigger: 'Deal row', ...target('F-SL3') },
  { trigger: 'Lost deals', ...target('F-LD1a') },
  { trigger: 'Marketing leads', ...target('F-MK9') },
]);
add(['F-SA1'], [
  ...bottomNav,
  { trigger: 'Pipeline', ...target('F-SL1') },
  { trigger: 'Deal detail', ...target('F-SL3') },
  { trigger: 'Design workspace', ...target('F-DS1') },
  { trigger: 'Estimate builder', ...target('F-EST1') },
]);
add(['F-SL3', 'F-SL4'], [
  { trigger: 'Pipeline', ...target('F-SL1') },
  { trigger: 'Design workspace', ...missing('Design workspace face', 'Route to the design workspace surface') },
  { trigger: 'Estimate builder', ...missing('F-EST1_mobile_estimate_builder.html') },
  { trigger: 'Proposal preview', ...target('F-PV1') },
]);
add(['F-DES1a'], [
  { trigger: 'Back deal', ...target('F-SL3') },
  { trigger: 'Build estimate', ...target('F-EST1') },
  { trigger: 'Ask Right Hand', ...target('F-RH1', 'Right Hand can organize selections but does not price or publish') },
  { trigger: 'Library', ...target('F-LIB1', 'Selections/cost library reference') },
]);
add(['F-EST1'], [
  { trigger: 'Back project / deal', ...target('F-PR2', 'Estimate remains tied to the project graph') },
  { trigger: 'Ask Right Hand', ...target('F-RH1', 'Right Hand drafts/refines but does not own estimate artifact') },
  { trigger: 'Preview proposal', ...target('F-PV1') },
  { trigger: 'Create invoice', ...missing('Per-job invoice list face', 'Deposit/progress/final invoice list missing') },
  { trigger: 'Open Money', ...target('F-MN1') },
]);
add(['F-DS1'], [
  { trigger: 'Back deal', ...target('F-SL4') },
  { trigger: 'Build estimate', ...target('F-EST1') },
  { trigger: 'Ask Right Hand', ...target('F-RH1', 'Right Hand can draft and retrieve; artifact remains design/estimate-owned') },
  { trigger: 'Open selections library', ...missing('F-LIB1_desktop_libraries_selections.html', 'Design selections library is imported; route still needs the live UI rebuild') },
]);
add(['F-LIB1'], [
  { trigger: 'Back design', ...target('F-DS1') },
  { trigger: 'Project instance', ...target('F-PR2') },
  { trigger: 'Build estimate', ...target('F-EST1') },
]);
add(['F-CHG1'], [
  { trigger: 'Back project', ...target('F-PR2') },
  { trigger: 'Submit for approval', ...target('F-B1', 'Change order goes to decision card before contract adjustment') },
  { trigger: 'Ask Right Hand', ...target('F-RH1') },
]);
add(['F-LD1a', 'F-LD1b'], [
  { trigger: 'Back pipeline', ...target('F-SL1') },
  { trigger: 'Deal detail', ...target('F-SL3') },
]);
add(['F-PV1', 'F-PV2'], [
  { trigger: 'Back to estimate', ...missing('F-EST1_mobile_estimate_builder.html') },
  { trigger: 'Review / client preview', ...target('F-B1c') },
  { trigger: 'Create invoice', ...missing('Per-job invoice list face', 'Deposit/progress/final invoice list missing') },
  { trigger: 'Open Money', ...target('F-MN1') },
]);
add(['F-G1'], [
  { trigger: 'Preview proposal', ...target('F-PV1') },
  { trigger: 'Decision card', ...target('F-B1') },
  { trigger: 'Audit detail', ...target('F-H1') },
]);
add(['F-B1', 'F-B2'], [
  { trigger: 'Preview', ...target('F-B1c') },
  { trigger: 'Approve', ...target('F-PR2', 'Approved consequence returns to canonical project/artifact') },
  { trigger: 'Edit', ...target('F-B1b') },
  { trigger: 'Reject', ...target('F-G1') },
  { trigger: 'Ask more', ...target('F-RH1') },
]);
add(['F-B1b'], [
  { trigger: 'Save edit', ...target('F-B1') },
  { trigger: 'Cancel', ...target('F-B1') },
]);
add(['F-B1c'], [
  { trigger: 'Back to decision', ...target('F-B1') },
  { trigger: 'Send / sign', ...target('F-PV1', 'Visible send/sign gate returns to proposal artifact') },
]);

add(['F-MN1', 'F-MN2'], [
  { trigger: 'Margin posture', ...target('F-MN3') },
  { trigger: 'Allowance exceptions', ...target('F-MN5a') },
  { trigger: 'AR aging', ...target('F-MN6a') },
  { trigger: 'AP scheduling', ...target('F-MN7a') },
  { trigger: 'Bookkeeping recon', ...target('F-BK1a') },
  { trigger: 'QB export', ...target('F-BK2') },
  { trigger: 'Purchasing', ...target('F-PU1a') },
  { trigger: 'Spend card', ...target('F-VC1') },
]);
add(['F-MN3', 'F-MN4'], [
  { trigger: 'Back Money', ...target('F-MN1') },
  { trigger: 'Export PDF', ...target('F-B1', 'Egress/consequence gate') },
]);
add(['F-MN5a', 'F-MN5b'], [
  { trigger: 'Back Money', ...target('F-MN1') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-MN6a', 'F-MN6b'], [
  { trigger: 'Back Money', ...target('F-MN1') },
  { trigger: 'Invoice detail', ...missing('Per-job invoice detail face') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-INV1a'], [
  { trigger: 'Back estimate / proposal', ...target('F-EST1', 'Return to the source estimate/proposal context') },
  { trigger: 'Open detail', ...target('F-INV2a', 'Drill into one deposit/progress/final invoice') },
  { trigger: 'Open Money', ...target('F-MN1', 'Global Money can find the same invoice set') },
  { trigger: 'Issue selected', ...target('F-INV2a', 'Money consequence stays behind the invoice detail gate') },
]);
add(['F-INV1b'], [
  { trigger: 'Back estimate / proposal', ...target('F-PV2', 'Return to desktop proposal/estimate context') },
  { trigger: 'Detail', ...target('F-INV2b', 'Drill into one deposit/progress/final invoice') },
  { trigger: 'Issue selected', ...target('F-INV2b', 'Money consequence stays behind the invoice detail gate') },
  { trigger: 'Global Money', ...target('F-MN2', 'Desktop Money can find the same invoice set') },
]);
add(['F-INV2a'], [
  { trigger: 'Back to list', ...target('F-INV1a') },
  { trigger: 'Issue invoice', ...target('F-INV2a', 'In-face money_guard confirmation') },
  { trigger: 'Preview client copy', ...target('F-B1c', 'Egress preview gate before external send') },
  { trigger: 'Open Money', ...target('F-MN1') },
]);
add(['F-INV2b'], [
  { trigger: 'Back to list', ...target('F-INV1b') },
  { trigger: 'Issue invoice', ...target('F-INV2b', 'In-face money_guard confirmation') },
  { trigger: 'Record payment', ...target('F-INV2b', 'In-face money_guard confirmation') },
  { trigger: 'Preview client copy', ...target('F-B1c', 'Egress preview gate before external send') },
  { trigger: 'Open Money', ...target('F-MN2') },
]);
add(['F-MN7a', 'F-MN7b'], [
  { trigger: 'Back Money', ...target('F-MN1') },
  { trigger: 'Vendor / bill detail', ...target('F-PU2') },
]);
add(['F-BK1a', 'F-BK1b'], [
  { trigger: 'Back Money', ...target('F-MN1') },
  { trigger: 'QB export', ...target('F-BK2') },
]);
add(['F-BK2'], [
  { trigger: 'Back bookkeeping', ...target('F-BK1a') },
  { trigger: 'Export IIF', ...target('F-B1', 'Egress/consequence gate') },
]);
add(['F-PU1a', 'F-PU1b'], [
  { trigger: 'Vendor detail', ...target('F-PU2') },
  { trigger: 'Money', ...target('F-MN1') },
]);
add(['F-PU2'], [
  { trigger: 'Purchasing', ...target('F-PU1a') },
  { trigger: 'AP', ...target('F-MN7a') },
]);
add(['F-VC1'], [
  { trigger: 'Money', ...target('F-MN1') },
  { trigger: 'Export', ...target('F-B1', 'Egress/consequence gate') },
]);

add(['F-CL1', 'F-CL3'], [
  { trigger: 'Client row', ...target('F-CL5') },
  { trigger: 'New client', ...missing('New client face', 'No dedicated Canon file') },
  { trigger: 'Archive', ...target('F-CA1a') },
]);
add(['F-CL0a'], [
  { trigger: 'Cancel', ...target('F-CL1') },
  { trigger: 'Save client', ...target('F-CL5', 'Operator-confirmed client graph write') },
  { trigger: 'Add project', ...target('F-PR0a') },
  { trigger: 'Save to intake', ...target('F-FU1', 'Hold capture/intake evidence for review') },
]);
add(['F-CL0b'], [
  { trigger: 'Cancel', ...target('F-CL3') },
  { trigger: 'Save client', ...target('F-CL6', 'Operator-confirmed client graph write') },
  { trigger: 'Add project', ...target('F-PR0b') },
  { trigger: 'Save to intake', ...target('F-FU1', 'Hold capture/intake evidence for review') },
]);
add(['F-CL2', 'F-CL4', 'F-CL5', 'F-CL6'], [
  { trigger: 'Back clients', ...target('F-CL1') },
  { trigger: 'Project row', ...target('F-PR2') },
  { trigger: 'New project', ...missing('Project setup / new project face') },
  { trigger: 'Warranty', ...target('F-WW1a') },
  { trigger: 'Client success', ...target('F-CS1') },
]);
add(['F-PR0a'], [
  { trigger: 'Cancel', ...target('F-PR1') },
  { trigger: 'Create project', ...target('F-PR2', 'Operator-confirmed project graph write') },
  { trigger: 'File capture here', ...target('F-DL1', 'Waiting capture files only after project confirmation') },
  { trigger: 'Build estimate', ...target('F-EST1') },
]);
add(['F-PR0b'], [
  { trigger: 'Cancel', ...target('F-PR3') },
  { trigger: 'Create project', ...target('F-PR4', 'Operator-confirmed project graph write') },
  { trigger: 'File capture here', ...target('F-DL1', 'Waiting capture files only after project confirmation') },
  { trigger: 'Build estimate', ...target('F-EST1') },
]);
add(['F-CA1a', 'F-CA1b'], [
  { trigger: 'Client record', ...target('F-CL5') },
  { trigger: 'Back clients', ...target('F-CL1') },
]);
add(['F-CS1', 'F-CS2'], [
  { trigger: 'Client record', ...target('F-CL5') },
  { trigger: 'Warranty', ...target('F-WW1a') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-CP1', 'F-CPS1'], [
  { trigger: 'Project status', ...target('F-CPS1') },
  { trigger: 'Client success', ...target('F-CS1') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-WW1a', 'F-WW1b'], [
  { trigger: 'Client record', ...target('F-CL5') },
  { trigger: 'Project', ...target('F-PR2') },
]);
add(['F-WAR1'], [
  { trigger: 'Client record', ...target('F-CL5') },
  { trigger: 'Project', ...target('F-PR2') },
  { trigger: 'Decision / approval', ...target('F-B1') },
]);

add(['F-SC1', 'F-SC2'], [
  { trigger: 'Project', ...target('F-PR2') },
  { trigger: 'Crew/subs', ...target('F-SB1') },
  { trigger: 'Time tracking', ...target('F-HR1a') },
]);
add(['F-SB1', 'F-SB2'], [
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Crew', ...target('F-CR1') },
  { trigger: 'Message / relay', ...target('F-FU1') },
]);
add(['F-SUBM1'], [
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Subs list', ...target('F-SB1') },
  { trigger: 'Message / relay', ...target('F-FU1') },
]);
add(['F-SUB1'], [
  { trigger: 'Assignment', ...target('F-W1') },
  { trigger: 'Sub home', ...target('F-SH1') },
]);
add(['F-CR1', 'F-CR2'], [
  { trigger: 'Time tracking', ...target('F-HR1a') },
  { trigger: 'Employee docs', ...target('F-HR2') },
  { trigger: 'Schedule', ...target('F-SC1') },
]);
add(['F-HR1a', 'F-HR1b'], [
  { trigger: 'Crew', ...target('F-CR1') },
  { trigger: 'Employee docs', ...target('F-HR2') },
]);
add(['F-HR2'], [
  { trigger: 'Crew', ...target('F-CR1') },
  { trigger: 'Time tracking', ...target('F-HR1a') },
]);
add(['F-SP1'], [
  { trigger: 'Account editor', ...target('F-SP1a') },
  { trigger: 'Role routing', ...target('F-RR1') },
  { trigger: 'Bar customization', ...target('F-BC1') },
  { trigger: 'Connections', ...missing('Connections face', 'Settings utility face for connections, KB, and Blackboard') },
]);
add(['F-SP1a'], [
  { trigger: 'Back settings', ...target('F-SP1') },
]);
add(['F-US1'], [
  { trigger: 'Back settings', ...target('F-SP1') },
  { trigger: 'Field guidance level', ...target('F-DL3') },
]);
add(['F-RR1'], [
  { trigger: 'Settings', ...target('F-SP1') },
]);
add(['F-BC1'], [
  { trigger: 'Settings', ...target('F-SP1') },
  { trigger: 'Bottom nav preview', ...target('F-A1') },
]);
add(['F-AD1', 'F-AD2'], [
  { trigger: 'Admin/Ops home', ...target('F-AO1') },
  { trigger: 'Settings', ...target('F-SP1') },
]);
add(['F-UTIL1a'], [
  { trigger: 'Back More', ...target('F-D1') },
  { trigger: 'Connections', ...target('F-UTIL1a', 'In-face admin-gated connections state') },
  { trigger: 'Cost knowledge review', ...target('F-UTIL1a', 'In-face KB review state') },
  { trigger: 'Blackboard preview', ...target('F-UTIL1a', 'In-face read-only memory preview state') },
  { trigger: 'Review queue', ...target('F-FU1') },
  { trigger: 'Audit detail', ...target('F-H1') },
]);
add(['F-UTIL1b'], [
  { trigger: 'Back settings', ...target('F-SP1') },
  { trigger: 'Open Connections', ...target('F-UTIL1b', 'In-face admin-gated connections state') },
  { trigger: 'Open KB queue', ...target('F-UTIL1b', 'In-face KB review state') },
  { trigger: 'Open Blackboard', ...target('F-UTIL1b', 'In-face read-only memory preview state') },
  { trigger: 'Review queue', ...target('F-FU1') },
  { trigger: 'Audit detail', ...target('F-H1') },
]);

add(['F-RP1', 'F-RP2'], [
  { trigger: 'Audit portfolio', ...target('F-AV1a') },
  { trigger: 'Audit detail', ...target('F-H1') },
  { trigger: 'Global todo', ...target('F-TD1') },
]);
add(['F-AV1a', 'F-AV1b'], [
  { trigger: 'Audit detail', ...target('F-H1') },
  { trigger: 'Reports', ...target('F-RP1') },
]);
add(['F-H1'], [
  { trigger: 'Reports', ...target('F-RP1') },
  { trigger: 'Project', ...target('F-PR2') },
  { trigger: 'Decision', ...target('F-B1') },
]);
add(['F-TD1', 'F-TD2'], [
  { trigger: 'Task item', ...target('F-B1', 'Task selects owning decision/artifact') },
  { trigger: 'Project task', ...target('F-PR2') },
]);
add(['F-ON1'], [
  { trigger: 'Attention item', ...target('F-AA1') },
  { trigger: 'Task item', ...target('F-B1') },
  { trigger: 'Project task', ...target('F-PR2') },
]);
add(['F-LND1'], [
  { trigger: 'Sign in as owner', ...target('F-A1') },
  { trigger: 'Sign in as field', ...target('F-FH1') },
  { trigger: 'Sign in as sales', ...target('F-SA1') },
]);

add(['F-MK1', 'F-MK2'], [
  { trigger: 'Reviews/referrals', ...target('F-MK3') },
  { trigger: 'Outreach queue', ...target('F-MK5') },
  { trigger: 'Attribution', ...target('F-MK7') },
  { trigger: 'Leads', ...target('F-MK9') },
]);
add(['F-MK3', 'F-MK4'], [
  { trigger: 'Marketing home', ...target('F-MK1') },
  { trigger: 'Client record', ...target('F-CL5') },
]);
add(['F-MK5', 'F-MK6'], [
  { trigger: 'Marketing home', ...target('F-MK1') },
  { trigger: 'Lead detail', ...target('F-SL3') },
]);
add(['F-MK7', 'F-MK8'], [
  { trigger: 'Marketing home', ...target('F-MK1') },
  { trigger: 'Leads', ...target('F-MK9') },
]);
add(['F-MK9', 'F-MK10'], [
  { trigger: 'Lead detail', ...target('F-SL3') },
  { trigger: 'Sales pipeline', ...target('F-SL1') },
  { trigger: 'Marketing home', ...target('F-MK1') },
]);

for (const face of faces) {
  if (face.transitions.length === 0) {
    face.transitions.push({
      trigger: 'No explicit target mapped yet',
      target: '',
      missing: 'Transition needs conductor decision',
      note: 'This face is included, but its click path is not fully specified in the current wireframe set.',
    });
  }
  face.transitions = face.transitions.map((transition) => {
    let normalized = transition;
    if (transition.missing) {
      const mappedMissing = missingFaceForDevice(transition.missing, face.device);
      const mappedFaceId = faceIdFromFileLabel(mappedMissing);
      normalized = mappedFaceId && faceById.has(mappedFaceId)
        ? { ...transition, target: mappedFaceId, missing: '' }
        : { ...transition, missing: mappedMissing };
    }
    return {
      ...normalized,
      gate: transitionGate(normalized, face),
      spine: transitionSpine(normalized, face),
    };
  });
}

const missingFaceCandidates = [
  {
    label: 'F-A1b_mobile_owner_home_v5_pulse.html',
    neededFor: 'Updated owner home with 5 brain questions / pulse',
    why: 'Referenced in current conductor/user canon, not present in docs/wireframes/canon.',
    device: 'mobile',
    intendedRoute: '/',
    gate: 'attention_queue',
    spineDependency: 'Home attention queue',
  },
  {
    label: 'F-RH7_bubble_transitions.html',
    neededFor: 'Right Hand bottom bloom / side Tap to talk pill',
    why: 'Referenced in current conductor/user canon, not present in docs/wireframes/canon.',
    device: 'mobile',
    intendedRoute: 'global overlay',
    gate: 'right_hand_route_only',
    spineDependency: 'Right Hand surface context / conversation spine',
  },
  {
    label: 'F-EST1_mobile_estimate_builder.html',
    neededFor: 'Estimate builder',
    why: 'Referenced repeatedly as the estimate face; not present in repo canon.',
    device: 'mobile',
    intendedRoute: '/estimate/:projectId',
    gate: 'operator_confirm for publish/proposal; no money write',
    spineDependency: 'Estimate -> proposal -> invoice line_id spine',
  },
  {
    label: 'F-CHG1_mobile_change_order_builder.html',
    neededFor: 'Change order builder before F-B1 decision',
    why: 'Referenced by sprint dispatch; not present in repo canon.',
    device: 'mobile',
    intendedRoute: '/change-orders/new',
    gate: 'operator_confirm then F-B1 decision',
    spineDependency: 'Change order -> decision card -> contract adjustment spine',
  },
  {
    label: 'F-DL1_mobile_daily_log.html',
    neededFor: 'Flat Daily Log surface',
    why: 'Referenced by Cursor C and current canon; not present in repo canon.',
    device: 'mobile',
    intendedRoute: '/projects/:id/daily-log',
    gate: 'capture_route_confirm',
    spineDependency: 'Capture -> Daily Log -> Project graph spine',
  },
  {
    label: 'F-INV1a_mobile_per_job_invoice_list.html',
    neededFor: 'Deposit / progress / final invoices under one job',
    why: 'User canon calls for this; repo only has money/AR/AP faces, not this explicit page.',
    device: 'mobile',
    intendedRoute: '/estimate/:projectId/invoice or /projects/:id/money/invoices',
    gate: 'money_guard',
    spineDependency: 'Estimate line_id -> contract milestone -> invoice spine',
  },
  {
    label: 'F-INV1b_desktop_per_job_invoice_list.html',
    neededFor: 'Desktop invoice list/detail for the same per-job invoice spine',
    why: 'Desktop Money has AR/AP, but not the job-owned deposit/progress/final invoice face.',
    device: 'desktop',
    intendedRoute: '/estimate/:projectId/invoice or /projects/:id/money/invoices',
    gate: 'money_guard',
    spineDependency: 'Estimate line_id -> contract milestone -> invoice spine',
  },
  {
    label: 'F-INV2a_mobile_per_job_invoice_detail.html',
    neededFor: 'Drill into one deposit/progress/final invoice from the per-job list',
    why: 'Money AR has invoice rows, but the job-owned invoice drill face is not present.',
    device: 'mobile',
    intendedRoute: '/estimate/:projectId/invoice/:invoiceId or /money/invoices/:id',
    gate: 'money_guard',
    spineDependency: 'Contract milestone -> invoice detail -> payment spine',
  },
  {
    label: 'F-INV2b_desktop_per_job_invoice_detail.html',
    neededFor: 'Desktop drill into one deposit/progress/final invoice from the per-job list',
    why: 'Money AR has invoice rows, but the job-owned invoice drill face is not present.',
    device: 'desktop',
    intendedRoute: '/estimate/:projectId/invoice/:invoiceId or /money/invoices/:id',
    gate: 'money_guard',
    spineDependency: 'Contract milestone -> invoice detail -> payment spine',
  },
  {
    label: 'F-PR0a_mobile_project_setup.html',
    neededFor: 'Projects/new and client-to-project creation',
    why: 'Live app route exists; no dedicated Canon face.',
    device: 'mobile',
    intendedRoute: '/projects/new',
    gate: 'operator_confirm',
    spineDependency: 'Client/project graph creation spine',
  },
  {
    label: 'F-PR0b_desktop_project_setup.html',
    neededFor: 'Desktop projects/new and client-to-project creation',
    why: 'Live app route exists; no dedicated Canon face.',
    device: 'desktop',
    intendedRoute: '/projects/new',
    gate: 'operator_confirm',
    spineDependency: 'Client/project graph creation spine',
  },
  {
    label: 'F-CL0a_mobile_client_create.html',
    neededFor: 'Create a new client from Clients and intake flows',
    why: 'Live /clients/new exists; no dedicated create-client Canon face.',
    device: 'mobile',
    intendedRoute: '/clients/new',
    gate: 'operator_confirm',
    spineDependency: 'Client graph creation spine',
  },
  {
    label: 'F-CL0b_desktop_client_create.html',
    neededFor: 'Desktop create-client flow from Clients and intake flows',
    why: 'Live /clients/new exists; no dedicated create-client Canon face.',
    device: 'desktop',
    intendedRoute: '/clients/new',
    gate: 'operator_confirm',
    spineDependency: 'Client graph creation spine',
  },
  {
    label: 'F-DES1a_mobile_design_workspace.html',
    neededFor: 'Deal detail -> design -> estimate bridge',
    why: 'Live app route exists; no dedicated Canon face.',
    device: 'mobile',
    intendedRoute: '/design/:projectId',
    gate: 'review_gate',
    spineDependency: 'Deal -> design -> estimate spine',
  },
  {
    label: 'F-DS1_desktop_design_workspace.html',
    neededFor: 'Desktop deal detail -> design -> estimate bridge',
    why: 'Canon desktop face is now imported; live route needs a rebuild to match it.',
    device: 'desktop',
    intendedRoute: '/design/:projectId',
    gate: 'review_gate',
    spineDependency: 'Deal -> design -> estimate spine',
  },
  {
    label: 'F-UTIL1a_mobile_connections_kb_blackboard.html',
    neededFor: 'Settings integrations and knowledge-ingestion holding routes',
    why: 'Live app routes exist; no dedicated Canon faces.',
    device: 'mobile',
    intendedRoute: '/connections + /kb-ingestion + /blackboard',
    gate: 'admin_gate / review_gate',
    spineDependency: 'Settings / knowledge / Blackboard utility spine',
  },
  {
    label: 'F-UTIL1b_desktop_connections_kb_blackboard.html',
    neededFor: 'Desktop settings integrations and knowledge-ingestion holding routes',
    why: 'Live app routes exist; no dedicated Canon faces.',
    device: 'desktop',
    intendedRoute: '/connections + /kb-ingestion + /blackboard',
    gate: 'admin_gate / review_gate',
    spineDependency: 'Settings / knowledge / Blackboard utility spine',
  },
];

const missingFaces = missingFaceCandidates.filter((gap) => {
  const existingFace = faceIdFromFileLabel(gap.label);
  return !(existingFace && faceById.has(existingFace));
});

const buildCards = missingFaceCandidates.map((gap) => {
  const existingFace = faceIdFromFileLabel(gap.label);
  return {
    ...gap,
    canonStatus: existingFace && faceById.has(existingFace) ? 'canon_present' : 'canon_missing',
  };
});

const externalCanonConflicts = [
  {
    label: 'F-PS1_mobile_pm_super_home.html',
    device: 'mobile',
    intendedRoute: '/home/pm or /home/field',
    conflict: 'External Canon reuses F-PS1, which already maps to F-PS1_mobile_project_status.html in repo canon.',
    decisionNeeded: 'Rename or re-ID the PM/Super home face before importing it into docs/wireframes/canon.',
  },
  {
    label: 'F-SU2_desktop_super_home.html',
    device: 'desktop',
    intendedRoute: '/home/field',
    conflict: 'External Canon reuses F-SU2, which already maps to F-SU2_desktop_superintendent_home.html in repo canon.',
    decisionNeeded: 'Rename or re-ID the alternate superintendent home face before importing it into docs/wireframes/canon.',
  },
];

const deviceBreakdown = ['mobile', 'desktop', 'matrix'].map((device) => ({
  device,
  faces: faces.filter((face) => face.device === device).length,
  edges: faces
    .filter((face) => face.device === device)
    .reduce((count, face) => count + face.transitions.length, 0),
  transitionGaps: faces
    .filter((face) => face.device === device)
    .reduce((count, face) => count + face.transitions.filter((transition) => transition.missing).length, 0),
  missingFaces: missingFaces.filter((gap) => gap.device === device).length,
}));

const data = {
  generatedAt: new Date().toISOString(),
  source: 'docs/wireframes/canon/*.html',
  faces,
  missingFaces,
  buildCards,
  deviceBreakdown,
};

function priorityForGap(gap) {
  if (/F-A1b|F-RH7|F-DL1/.test(gap.label)) return 'P0';
  if (/F-EST1|F-CHG1|F-INV1a|F-INV2a/.test(gap.label)) return 'P1';
  if (/F-INV1b|F-INV2b|F-PR0|F-CL0|F-DES1|F-DS1/.test(gap.label)) return 'P2';
  return 'P3';
}

function laneForGap(gap) {
  if (/F-A1b|F-RH7/.test(gap.label)) return 'Codex + Claude chrome';
  if (/F-DL1/.test(gap.label)) return 'Cursor A capture/log';
  if (/F-EST1|F-CHG1/.test(gap.label)) return 'Cursor B estimate/CO';
  if (/F-INV/.test(gap.label)) return 'Cursor C money';
  if (/F-PR0|F-CL0|F-DES1|F-DS1/.test(gap.label)) return 'Cursor D intake/sales';
  return 'Codex utility';
}

function sourceClicksForGap(label) {
  const clicks = [];
  for (const face of faces) {
    for (const transition of face.transitions) {
      if (transition.missing === label) clicks.push(`${face.id} ${transition.trigger}`);
    }
  }
  return clicks;
}

function sourceClicksForBuildCard(label) {
  const clicks = sourceClicksForGap(label);
  const targetFaceId = faceIdFromFileLabel(label);
  if (!targetFaceId) return clicks;
  for (const face of faces) {
    for (const transition of face.transitions) {
      if (transition.target === targetFaceId) clicks.push(`${face.id} ${transition.trigger}`);
    }
  }
  return [...new Set(clicks)];
}

function transitionGapRows() {
  const rows = [];
  for (const face of faces) {
    for (const transition of face.transitions) {
      if (!transition.missing) continue;
      rows.push({
        sourceFace: face.file,
        sourceId: face.id,
        device: face.device,
        trigger: transition.trigger,
        missingFace: transition.missing,
        gate: transition.gate,
        spine: transition.spine,
        note: transition.note || '',
      });
    }
  }
  return rows.sort((a, b) => (
    a.missingFace.localeCompare(b.missingFace)
    || a.sourceFace.localeCompare(b.sourceFace)
    || a.trigger.localeCompare(b.trigger)
  ));
}

function countBy(items, keyFor) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function laneBranchName(lane) {
  if (lane === 'Codex + Claude chrome') return 'sprint2/chrome-home-rh-wireframes';
  if (lane === 'Cursor A capture/log') return 'sprint2/capture-log-wireframes';
  if (lane === 'Cursor B estimate/CO') return 'sprint2/estimate-co-wireframes';
  if (lane === 'Cursor C money') return 'sprint2/money-invoice-wireframes';
  if (lane === 'Cursor D intake/sales') return 'sprint2/intake-sales-wireframes';
  return 'sprint2/utility-wireframes';
}

function lanePrimaryCheck(lane) {
  if (lane === 'Codex + Claude chrome') {
    return 'Phone opens Home and Right Hand; F-A1b and F-RH7 source clicks no longer show a gap screen.';
  }
  if (lane === 'Cursor A capture/log') {
    return 'Camera and Field Capture file to a flat Daily Log surface; F-DL1 source clicks no longer show a gap screen.';
  }
  if (lane === 'Cursor B estimate/CO') {
    return 'Start, Sales, Proposal, and Change Order clicks land on builder surfaces, then route through their visible gates.';
  }
  if (lane === 'Cursor C money') {
    return 'Proposal and Money invoice clicks land on per-job invoice list/detail surfaces without bypassing money_guard.';
  }
  if (lane === 'Cursor D intake/sales') {
    return 'Client, project, and design creation clicks land on owned creation/workspace surfaces with operator_confirm/review gates intact.';
  }
  return 'Settings utility clicks land on explicit utility faces or documented holding surfaces.';
}

function buildBacklogMarkdown() {
  const statusRows = countBy(faces, (face) => face.system.routeStatus);
  const gateRows = countBy(faces, (face) => face.system.gate);
  const cardRows = [...buildCards].sort((a, b) => {
    const priority = priorityForGap(a).localeCompare(priorityForGap(b));
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
  const lines = [
    '# Right Hand Wireframe System Build Backlog',
    '',
    '<!-- Generated by scripts/generate-wireframe-flow-map.mjs. Do not edit by hand. -->',
    '',
    `Generated from ${data.source} at ${data.generatedAt}.`,
    '',
    'This backlog turns the interactive wireframe map into implementation cards. Each card names the device lane, Canon file status, owning route, gate, system spine dependency, and source clicks. A card can be canon_present while the live route is still pending.',
    '',
    '## Coverage',
    '',
    '| Device | Faces | Click paths | Transition gaps | Missing faces |',
    '|---|---:|---:|---:|---:|',
    ...data.deviceBreakdown.map((row) => `| ${escapeMd(row.device)} | ${row.faces} | ${row.edges} | ${row.transitionGaps} | ${row.missingFaces} |`),
    '',
    '## Route Status Counts',
    '',
    '| Status | Faces |',
    '|---|---:|',
    ...statusRows.map(([status, count]) => `| ${escapeMd(status)} | ${count} |`),
    '',
    '## Gate Counts',
    '',
    '| Gate | Faces |',
    '|---|---:|',
    ...gateRows.map(([gate, count]) => `| ${escapeMd(gate)} | ${count} |`),
    '',
    '## Face Implementation Cards',
    '',
    '| Priority | Lane | Device | Canon status | Face | Owning route | Gate | Spine dependency | Source clicks |',
    '|---|---|---|---|---|---|---|---|---|',
    ...cardRows.map((gap) => {
      const clicks = sourceClicksForBuildCard(gap.label);
      return [
        priorityForGap(gap),
        laneForGap(gap),
        gap.device,
        gap.canonStatus,
        gap.label,
        gap.intendedRoute,
        gap.gate,
        gap.spineDependency,
        clicks.length ? clicks.join('; ') : 'Gap index / external canon reference',
      ].map(escapeMd).join(' | ');
    }).map((row) => `| ${row} |`),
    '',
    '## Implementation Rules',
    '',
    '- Build mobile and desktop faces as separate acceptance targets when both are listed.',
    '- A transition is not done until the source click in the interactive map lands on a real face or documented in-face state instead of a gap screen.',
    '- Keep the named gate intact. Money rows stay behind money_guard; sends/signatures stay behind send_signature_gate; durable writes stay behind operator_confirm or capture_route_confirm.',
    '- Use the owning route as the artifact home. Right Hand may route or draft, but the artifact parks on its canonical surface.',
    '- Every implementation PR must update the map, regenerate this backlog, and include the relevant phone or desktop verification route.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function buildGapRegisterMarkdown() {
  const missingRows = [...missingFaces].sort((a, b) => (
    priorityForGap(a).localeCompare(priorityForGap(b))
    || a.device.localeCompare(b.device)
    || a.label.localeCompare(b.label)
  ));
  const transitionRows = transitionGapRows();
  const conflictRows = [...externalCanonConflicts].sort((a, b) => a.label.localeCompare(b.label));

  const lines = [
    '# Right Hand Wireframe Gap Register',
    '',
    '<!-- Generated by scripts/generate-wireframe-flow-map.mjs. Do not edit by hand. -->',
    '',
    `Generated from ${data.source} at ${data.generatedAt}.`,
    '',
    'This register is the plain-English audit list for what is still not fully attached. It separates missing Canon face files, click-path gaps in imported faces, and external Canon files that cannot be imported yet because they conflict with existing F-* IDs.',
    '',
    '## Summary',
    '',
    `- Canon faces in repo map: ${faces.length}`,
    `- Missing Canon face records: ${missingRows.length}`,
    `- Transition gaps that still open a gap screen: ${transitionRows.length}`,
    `- External duplicate-ID conflicts: ${conflictRows.length}`,
    '',
    '## Missing Canon Face Records',
    '',
    '| Priority | Lane | Device | Missing face | Owning route | Gate | Spine dependency | Needed for | Source clicks |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (const gap of missingRows) {
    const clicks = sourceClicksForBuildCard(gap.label);
    lines.push([
      priorityForGap(gap),
      laneForGap(gap),
      gap.device,
      gap.label,
      gap.intendedRoute,
      gap.gate,
      gap.spineDependency,
      gap.neededFor,
      clicks.length ? clicks.join('; ') : 'Gap index / conductor assignment',
    ].map(escapeMd).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  lines.push('## Transition Gaps');
  lines.push('');
  lines.push('| Device | Source face | Trigger | Missing target | Gate | Spine | Note |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const row of transitionRows) {
    lines.push([
      row.device,
      row.sourceFace,
      row.trigger,
      row.missingFace,
      row.gate,
      row.spine,
      row.note,
    ].map(escapeMd).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  lines.push('## External Canon Duplicate-ID Conflicts');
  lines.push('');
  lines.push('| Device | External face | Intended route | Conflict | Decision needed |');
  lines.push('|---|---|---|---|---|');

  for (const conflict of conflictRows) {
    lines.push([
      conflict.device,
      conflict.label,
      conflict.intendedRoute,
      conflict.conflict,
      conflict.decisionNeeded,
    ].map(escapeMd).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  lines.push('## Closure Rules');
  lines.push('');
  lines.push('- A missing face closes only when the Canon HTML exists in docs/wireframes/canon and is represented in WIREFRAME_SPINE_MAP or WIREFRAME_REFERENCE_MAP.');
  lines.push('- A transition gap closes only when the source click targets a real face or a documented in-face state with a named gate and spine.');
  lines.push('- A duplicate-ID conflict closes only when the conflicting external Canon file is renamed/re-IDed and imported without overwriting an existing F-* meaning.');
  lines.push('- Implementation PRs must regenerate this register with the map, backlog, and lane dispatches.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function buildLaneDispatchesMarkdown() {
  const cardRows = [...buildCards].sort((a, b) => {
    const lane = laneForGap(a).localeCompare(laneForGap(b));
    if (lane !== 0) return lane;
    const priority = priorityForGap(a).localeCompare(priorityForGap(b));
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
  const lines = [
    '# Right Hand Wireframe Lane Dispatches',
    '',
    '<!-- Generated by scripts/generate-wireframe-flow-map.mjs. Do not edit by hand. -->',
    '',
    `Generated from ${data.source} at ${data.generatedAt}.`,
    '',
    'Purpose: copy one lane block into the matching implementation agent after the map PR lands. Every lane is derived from the interactive wireframe map and the build backlog; do not invent a parallel route, gate, palette, or artifact owner.',
    '',
    '## Global Rules For Every Lane',
    '',
    '- Base on main after the latest wireframe map/backlog commit is merged.',
    '- Build the listed face as an actual routed surface or an explicitly documented in-face state. A source click is not complete while it still opens the gap screen.',
    '- Preserve the named gate. Money stays behind money_guard; send/signature stays behind send_signature_gate; durable writes stay behind operator_confirm, capture_route_confirm, or the listed review gate.',
    '- Keep artifact ownership canonical. Right Hand may route or draft, but the artifact parks on the owning route named in the table.',
    '- Mobile and desktop are separate acceptance targets. If a lane lists both, verify both.',
    '- Each implementation PR must regenerate docs/wireframes/wireframe-flow-map.html, docs/wireframes/wireframe-system-build-backlog.md, and this dispatch file.',
    '',
  ];

  for (const [lane, gaps] of groupBy(cardRows, laneForGap)) {
    lines.push(`## ${escapeMd(lane)}`);
    lines.push('');
    lines.push(`Suggested branch: \`${escapeMd(laneBranchName(lane))}\``);
    lines.push('');
    lines.push(`Primary phone/desktop check: ${escapeMd(lanePrimaryCheck(lane))}`);
    lines.push('');
    lines.push('| Priority | Device | Canon status | Face to build | Owning route | Gate | Spine dependency | Source clicks that must stop gapping or old routing |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const gap of gaps) {
      const clicks = sourceClicksForBuildCard(gap.label);
      lines.push([
        priorityForGap(gap),
        gap.device,
        gap.canonStatus,
        gap.label,
        gap.intendedRoute,
        gap.gate,
        gap.spineDependency,
        clicks.length ? clicks.join('; ') : 'Gap index / external canon reference',
      ].map(escapeMd).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
    lines.push('Acceptance for this lane:');
    lines.push('');
    lines.push('- The source clicks listed above route to a built face or documented in-face state, not the generated gap page.');
    lines.push('- The built surface opts into the shared canon grammar when it is an app surface, not a parallel visual system.');
    lines.push('- The visible flow matches the F-* wireframe and the operable canon prototype for the same surface.');
    lines.push('- The named gate is visible in the user path and remains server-owned where money/auth/consequence is involved.');
    lines.push('- Tests or parity checks prove the transition, route, and gate mapping for every listed face.');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

const dataJson = JSON.stringify(data)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Right Hand · Interactive Wireframe Flow Map</title>
<style>
:root{--bg:#0c1117;--panel:#151b23;--panel2:#1c2430;--ink:#eef2f7;--muted:#9aa6b2;--line:#28313b;--gold:#e7aa3b;--blue:#2f6df0;--green:#22784a;--red:#b73838;--amber:#aa6719;--soft-red:rgba(183,56,56,.16);--soft-gold:rgba(231,170,59,.14);--soft-blue:rgba(47,109,240,.16);--r:8px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:0}
button,input,select{font:inherit}button{cursor:pointer}
.app{display:grid;grid-template-columns:290px minmax(0,1fr) 330px;min-height:100vh}
.rail{border-right:1px solid var(--line);background:#0a0f15;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.brand{padding:16px;border-bottom:1px solid var(--line);display:grid;gap:8px}.brand h1{font-size:16px;margin:0}.brand p{margin:0;color:var(--muted);font-size:12px}.brand strong{color:var(--gold)}
.tools{display:grid;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.tools input,.tools select{width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:9px}
.deviceTabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.deviceTabs button{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:var(--r);padding:7px 5px;font-size:11px}.deviceTabs button[aria-pressed=true]{border-color:var(--gold);background:var(--soft-gold);color:var(--gold);font-weight:800}
.counts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.count{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:7px;text-align:center}.count b{display:block;color:var(--gold);font-size:15px}.count span{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.list{overflow:auto;padding:10px;display:grid;gap:6px}.facebtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:9px;text-align:left;display:grid;gap:3px}.facebtn[aria-current=true]{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}.facebtn .top{display:flex;gap:8px;align-items:center}.id{color:var(--gold);font-weight:800}.device{margin-left:auto;color:var(--muted);font-size:10px;text-transform:uppercase}.file{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.main{min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr)}
.topbar{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:rgba(12,17,23,.92);position:sticky;top:0;z-index:4;backdrop-filter:blur(10px)}.topbar button,.topbar a{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:8px 10px;text-decoration:none}.topbar .primary{background:var(--gold);color:#1b1302;border-color:var(--gold);font-weight:800}.trail{margin-left:auto;color:var(--muted);font-size:12px;max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hero{padding:16px;border-bottom:1px solid var(--line);display:grid;gap:10px}.hero h2{font-size:24px;margin:0}.hero p{margin:0;color:var(--muted)}.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border-radius:999px;border:1px solid var(--line);background:var(--panel);padding:4px 8px;font-size:11px;color:var(--muted)}.chip.gold{border-color:rgba(231,170,59,.45);background:var(--soft-gold);color:var(--gold)}.chip.blue{border-color:rgba(47,109,240,.45);background:var(--soft-blue);color:#8fb0ff}.chip.red{border-color:rgba(183,56,56,.5);background:var(--soft-red);color:#ffb4b4}
.content{overflow:auto;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}.card{border:1px solid var(--line);background:var(--panel);border-radius:var(--r);padding:14px}.card h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin:0 0 10px;color:var(--muted)}.card p{margin:0 0 10px;color:var(--muted)}
.transitions{display:grid;gap:8px}.tbtn{width:100%;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);color:var(--ink);padding:10px;text-align:left;display:grid;gap:5px}.tbtn:hover{border-color:var(--gold)}.tbtn .row{display:flex;gap:8px;align-items:center}.tbtn .arrow{margin-left:auto;color:var(--muted)}.tbtn small{color:var(--muted)}.tbtn.missing{border-color:rgba(183,56,56,.5);background:var(--soft-red)}.tbtn.state{border-color:rgba(47,109,240,.35);background:var(--soft-blue)}
.controls{display:grid;gap:6px}.raw{display:flex;gap:6px;align-items:flex-start;border:1px solid var(--line);border-radius:var(--r);padding:7px;background:#101720}.raw code{color:var(--gold);font-size:11px}.raw span{color:var(--muted)}
.previewShell{height:calc(100vh - 176px);min-height:620px;border:1px solid var(--line);border-radius:var(--r);background:#090d12;overflow:auto;display:grid;place-items:start center;padding:14px}.previewShell iframe{height:100%;min-height:590px;border:0;background:#fff;border-radius:6px;box-shadow:0 18px 42px rgba(0,0,0,.32)}.previewShell[data-device="mobile"] iframe{width:min(430px,100%)}.previewShell[data-device="desktop"] iframe,.previewShell[data-device="matrix"] iframe{width:100%}.previewShell[data-mode="gap"]{background:linear-gradient(145deg,rgba(183,56,56,.20),#090d12 42%)}.previewShell[data-mode="gap"] iframe{width:min(680px,100%);background:#131923}
.side{border-left:1px solid var(--line);background:#0a0f15;position:sticky;top:0;height:100vh;overflow:auto;padding:14px;display:grid;gap:12px;align-content:start}.gap{border:1px solid rgba(183,56,56,.45);background:var(--soft-red);border-radius:var(--r);padding:10px}.gap b{display:block;color:#ffb4b4}.gap span{color:var(--muted)}
.gapbtn{width:100%;border:1px solid rgba(183,56,56,.45);background:var(--soft-red);color:var(--ink);border-radius:var(--r);padding:10px;text-align:left;display:grid;gap:4px}.gapbtn b{color:#ffb4b4}.gapbtn span{color:var(--muted)}
.deviceStats{display:grid;gap:7px}.deviceStat{border:1px solid var(--line);background:#101720;border-radius:var(--r);padding:9px;display:grid;gap:4px}.deviceStat b{color:var(--ink);text-transform:capitalize}.deviceStat span{color:var(--muted);font-size:12px}.deviceTag{justify-self:start;border:1px solid rgba(47,109,240,.45);background:var(--soft-blue);color:#8fb0ff;border-radius:999px;padding:2px 7px;font-size:10px;text-transform:uppercase}
.mini{border:1px solid var(--line);background:var(--panel);border-radius:var(--r);padding:10px}.mini h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.mini ul{margin:0;padding-left:18px;color:var(--muted)}.mini li{margin:0 0 6px}.hidden{display:none!important}
@media(max-width:1050px){.app{grid-template-columns:1fr}.rail,.side{position:relative;height:auto}.content{grid-template-columns:1fr}.previewShell{height:72vh}.trail{display:none}}
</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="brand">
      <h1>Right Hand Wireframe Flow Map</h1>
      <p>Built from <strong>docs/wireframes/canon/*.html</strong>. Click a drawn action to see the next expected face. Missing targets are red.</p>
    </div>
    <div class="tools">
      <input id="search" placeholder="Search face, title, domain...">
      <select id="domain"></select>
      <div class="deviceTabs" id="deviceTabs" aria-label="Device filter">
        <button type="button" data-device-filter="all" aria-pressed="true">All</button>
        <button type="button" data-device-filter="mobile" aria-pressed="false">Mobile</button>
        <button type="button" data-device-filter="desktop" aria-pressed="false">Desktop</button>
        <button type="button" data-device-filter="matrix" aria-pressed="false">Matrix</button>
      </div>
      <div class="counts">
        <div class="count"><b id="faceCount">0</b><span>faces</span></div>
        <div class="count"><b id="gapCount">0</b><span>gaps</span></div>
        <div class="count"><b id="edgeCount">0</b><span>edges</span></div>
      </div>
    </div>
    <div class="list" id="faceList"></div>
  </aside>
  <main class="main">
    <div class="topbar">
      <button class="primary" id="startHome">Start at Home</button>
      <button id="showGaps">Show gaps</button>
      <a id="openOriginal" href="#" target="_blank" rel="noreferrer">Open original</a>
      <div class="trail" id="trail">Trail: none</div>
    </div>
    <section class="hero">
      <div class="chips" id="chips"></div>
      <h2 id="faceTitle">Loading...</h2>
      <p id="faceMeta"></p>
    </section>
    <section class="content">
      <div class="previewShell" id="previewShell" data-mode="face" data-device="mobile"><iframe id="preview" title="Original wireframe preview"></iframe></div>
      <div class="flowPanel">
        <div class="card">
          <h3>Expected Click Paths</h3>
          <div class="transitions" id="transitions"></div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3>Controls Extracted From This HTML Face</h3>
          <p>These are buttons/links found in the wireframe file. View/theme toggles are filtered out.</p>
          <div class="controls" id="controls"></div>
        </div>
      </div>
    </section>
  </main>
  <aside class="side">
    <div class="mini">
      <h3>Device Breakdown</h3>
      <div class="deviceStats" id="deviceBreakdown"></div>
    </div>
    <div class="mini">
      <h3>Gap Index</h3>
      <div id="missingList"></div>
    </div>
    <div class="mini">
      <h3>How To Use</h3>
      <ul>
        <li>Pick a face or start at Home.</li>
        <li>The large frame is the actual wireframe screen.</li>
        <li>Click Expected Click Paths to play the flow.</li>
        <li>Red paths route to a gap screen instead of going dead.</li>
      </ul>
    </div>
  </aside>
</div>
<script id="flow-data" type="application/json">${dataJson}</script>
<script>
const DATA = JSON.parse(document.getElementById('flow-data').textContent);
const faces = DATA.faces;
const byId = new Map(faces.map(f => [f.id, f]));
let current = byId.get('F-A1') || faces[0];
let currentGap = null;
let activeDevice = 'all';
let trail = [];
const els = {
  search: document.getElementById('search'),
  domain: document.getElementById('domain'),
  deviceTabs: document.getElementById('deviceTabs'),
  list: document.getElementById('faceList'),
  faceCount: document.getElementById('faceCount'),
  gapCount: document.getElementById('gapCount'),
  edgeCount: document.getElementById('edgeCount'),
  chips: document.getElementById('chips'),
  title: document.getElementById('faceTitle'),
  meta: document.getElementById('faceMeta'),
  transitions: document.getElementById('transitions'),
  controls: document.getElementById('controls'),
  preview: document.getElementById('preview'),
  previewShell: document.getElementById('previewShell'),
  original: document.getElementById('openOriginal'),
  deviceBreakdown: document.getElementById('deviceBreakdown'),
  missingList: document.getElementById('missingList'),
  trail: document.getElementById('trail'),
};
function esc(s){return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function deviceFromGapLabel(label, fallback = 'unassigned'){
  if (/_mobile_|mobile/i.test(label || '')) return 'mobile';
  if (/_desktop_|desktop/i.test(label || '')) return 'desktop';
  if (/matrix/i.test(label || '')) return 'matrix';
  return fallback;
}
function deviceMatches(device){return activeDevice === 'all' || device === activeDevice;}
function domains(){return ['All domains', ...Array.from(new Set(faces.map(f=>f.domain))).sort()];}
function renderDomainOptions(){els.domain.innerHTML = domains().map(d => '<option>'+esc(d)+'</option>').join('');}
function filteredFaces(){
  const q = els.search.value.trim().toLowerCase();
  const d = els.domain.value;
  return faces.filter(f => deviceMatches(f.device) && (d === 'All domains' || f.domain === d) && (!q || [f.id,f.file,f.title,f.h1,f.domain].join(' ').toLowerCase().includes(q)));
}
function filteredMissingFaces(){
  return DATA.missingFaces
    .map((gap, index) => ({ ...gap, index }))
    .filter(gap => activeDevice === 'all' || gap.device === activeDevice || (activeDevice === 'matrix' && gap.device === 'unassigned'));
}
function renderList(){
  const list = filteredFaces();
  els.list.innerHTML = list.map(f => '<button class="facebtn" data-face="'+esc(f.id)+'" aria-current="'+(f.id===current.id)+'"><span class="top"><span class="id">'+esc(f.id)+'</span><span class="device">'+esc(f.device)+'</span></span><span>'+esc(f.h1 || f.title)+'</span><span class="file">'+esc(f.file)+'</span></button>').join('');
  els.faceCount.textContent = list.length;
  els.edgeCount.textContent = list.reduce((n,f)=>n+f.transitions.length,0);
  els.gapCount.textContent = filteredMissingFaces().length + list.reduce((n,f)=>n+f.transitions.filter(t=>t.missing).length,0);
  els.deviceTabs.querySelectorAll('[data-device-filter]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.deviceFilter === activeDevice));
  });
}
function selectFace(id, trigger){
  const next = byId.get(id);
  if (!next) return;
  if (trigger) trail.push(trigger + ' → ' + id);
  current = next;
  currentGap = null;
  render();
}
function showGap(transition, sourceFace){
  const source = sourceFace || current;
  const missingLabel = transition?.missing || 'Transition needs conductor decision';
  const gapRecord = DATA.missingFaces.find(g => g.label === missingLabel) || null;
  currentGap = {
    sourceId: source?.id || '',
    sourceTitle: source?.h1 || source?.title || '',
    trigger: transition?.trigger || 'Missing transition',
    missing: missingLabel,
    note: transition?.note || gapRecord?.why || '',
    target: transition?.target || '',
    device: gapRecord?.device || deviceFromGapLabel(missingLabel, source?.device || 'unassigned'),
    intendedRoute: gapRecord?.intendedRoute || '',
    gate: gapRecord?.gate || transition?.gate || 'gap_build_required',
    spineDependency: gapRecord?.spineDependency || transition?.spine || 'missing_face_backlog',
  };
  trail.push((currentGap.sourceId || 'Gap index') + ' · ' + currentGap.trigger + ' → GAP: ' + currentGap.missing);
  render();
}
function gapHtml(gap){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gap · '+esc(gap.missing)+'</title><style>body{margin:0;background:#111821;color:#f4f7fb;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:28px}.card{width:min(560px,100%);border:1px solid rgba(255,180,180,.45);background:rgba(183,56,56,.16);border-radius:10px;padding:22px;box-shadow:0 22px 60px rgba(0,0,0,.3)}.eyebrow{color:#ffb4b4;text-transform:uppercase;letter-spacing:.1em;font-size:12px;font-weight:800}h1{font-size:30px;line-height:1.1;margin:8px 0 16px}dl{display:grid;gap:10px;margin:0}dt{color:#a8b3bf;font-size:12px;text-transform:uppercase;letter-spacing:.08em}dd{margin:0 0 8px}.pill{display:inline-block;border:1px solid rgba(231,170,59,.45);background:rgba(231,170,59,.14);color:#e7aa3b;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:800;text-transform:uppercase}</style></head><body><main class="wrap"><section class="card"><div class="eyebrow">Gap to fill</div><h1>This click has no Canon face yet.</h1><dl><dt>Device lane</dt><dd><span class="pill">'+esc(gap.device || 'unassigned')+'</span></dd><dt>Missing face</dt><dd><span class="pill">'+esc(gap.missing)+'</span></dd><dt>Owning route to build</dt><dd>'+esc(gap.intendedRoute || 'Route decision required')+'</dd><dt>Gate</dt><dd>'+esc(gap.gate || 'gap_build_required')+'</dd><dt>Spine dependency</dt><dd>'+esc(gap.spineDependency || 'missing_face_backlog')+'</dd><dt>Source click</dt><dd>'+esc(gap.sourceId || 'Gap index')+' · '+esc(gap.trigger)+'</dd><dt>Source screen</dt><dd>'+esc(gap.sourceTitle || 'No source screen selected')+'</dd><dt>What needs to be built</dt><dd>'+esc(gap.note || 'Create or import the missing wireframe face, then map this click to it.')+'</dd></dl></section></main></body></html>';
}
function renderFace(){
  if (currentGap) {
    els.previewShell.dataset.mode = 'gap';
    els.previewShell.dataset.device = 'gap';
    els.chips.innerHTML = '<span class="chip red">Gap</span><span class="chip blue">'+esc(currentGap.device || 'unassigned')+'</span><span class="chip gold">'+esc(currentGap.sourceId || 'No source')+'</span>';
    els.title.textContent = 'Gap: ' + currentGap.missing;
    els.meta.textContent = 'Clicked "' + currentGap.trigger + '" from ' + (currentGap.sourceTitle || currentGap.sourceId || 'the gap index') + '.';
    els.preview.removeAttribute('src');
    els.preview.srcdoc = gapHtml(currentGap);
    els.original.href = currentGap.sourceId && byId.get(currentGap.sourceId) ? 'canon/' + byId.get(currentGap.sourceId).file : '#';
  } else {
    els.previewShell.dataset.mode = 'face';
    els.previewShell.dataset.device = current.device;
    els.chips.innerHTML = '<span class="chip gold">'+esc(current.id)+'</span><span class="chip blue">'+esc(current.domain)+'</span><span class="chip">'+esc(current.device)+'</span><span class="chip">'+esc(current.system.routeStatus)+'</span><span class="chip">'+esc(current.system.gate)+'</span>';
    els.title.textContent = current.h1 || current.title;
    els.meta.textContent = current.file + ' · route: ' + current.system.owningRoute + ' · spine: ' + current.system.spineDependency + (current.canonCorrection ? ' · ' + current.canonCorrection : '');
    els.preview.removeAttribute('srcdoc');
    els.preview.src = 'canon/' + current.file;
    els.original.href = 'canon/' + current.file;
  }
  els.trail.textContent = trail.length ? 'Trail: ' + trail.slice(-5).join(' / ') : 'Trail: none';
}
function renderTransitions(){
  if (currentGap) {
    els.transitions.innerHTML = '<button class="tbtn" data-gap-back="true"><span class="row"><b>Back to source screen</b><span class="arrow">→ '+esc(currentGap.sourceId || 'Home')+'</span></span><small>Return to the face that exposed this missing path.</small></button><button class="tbtn" data-home="true"><span class="row"><b>Start over at Home</b><span class="arrow">→ F-A1</span></span></button>';
    return;
  }
  els.transitions.innerHTML = current.transitions.map((t, i) => {
    const cls = t.missing ? 'missing' : t.state ? 'state' : '';
    const to = t.target || t.missing || 'same face';
    return '<button class="tbtn '+cls+'" data-i="'+i+'"><span class="row"><b>'+esc(t.trigger)+'</b><span class="arrow">→ '+esc(to)+'</span></span><small>gate: '+esc(t.gate || 'navigation')+' · spine: '+esc(t.spine || 'domain_navigation')+'</small>'+(t.note?'<small>'+esc(t.note)+'</small>':'')+'</button>';
  }).join('');
}
function renderControls(){
  if (currentGap) {
    els.controls.innerHTML = '<div class="raw"><code>gap</code><span>'+esc(currentGap.missing)+'</span></div><div class="raw"><code>route</code><span>'+esc(currentGap.intendedRoute || 'Route decision required')+'</span></div><div class="raw"><code>gate</code><span>'+esc(currentGap.gate || 'gap_build_required')+'</span></div><div class="raw"><code>spine</code><span>'+esc(currentGap.spineDependency || 'missing_face_backlog')+'</span></div><div class="raw"><code>source</code><span>'+esc(currentGap.sourceId || 'No source')+' · '+esc(currentGap.trigger)+'</span></div>';
    return;
  }
  const systemRows = '<div class="raw"><code>route</code><span>'+esc(current.system.owningRoute)+'</span></div><div class="raw"><code>status</code><span>'+esc(current.system.routeStatus)+'</span></div><div class="raw"><code>gate</code><span>'+esc(current.system.gate)+'</span></div><div class="raw"><code>spine</code><span>'+esc(current.system.spineDependency)+'</span></div>';
  if (!current.controls.length) {
    els.controls.innerHTML = systemRows + '<div class="raw"><span>No buttons/links were extractable from this static face.</span></div>';
    return;
  }
  els.controls.innerHTML = systemRows + current.controls.map(c => '<div class="raw"><code>'+esc(c.kind)+'</code><span>'+esc(c.label)+'</span>'+(c.href?'<span>href='+esc(c.href)+'</span>':'')+(c.dataGo?'<span>state='+esc(c.dataGo)+'</span>':'')+'</div>').join('');
}
function renderMissing(){
  const gaps = filteredMissingFaces();
  els.missingList.innerHTML = gaps.length
    ? gaps.map((g) => '<button class="gapbtn" data-gap-index="'+g.index+'"><span class="deviceTag">'+esc(g.device)+'</span><b>'+esc(g.label)+'</b><span>'+esc(g.neededFor)+' — '+esc(g.why)+'</span><span>route: '+esc(g.intendedRoute || 'decision required')+' · gate: '+esc(g.gate || 'gap_build_required')+'</span></button>').join('')
    : '<div class="raw"><span>No missing faces for this device filter.</span></div>';
}
function renderDeviceBreakdown(){
  const unassigned = DATA.missingFaces.filter((gap) => gap.device === 'unassigned').length;
  els.deviceBreakdown.innerHTML = DATA.deviceBreakdown.map((row) => '<button class="deviceStat" data-device-filter-side="'+esc(row.device)+'"><b>'+esc(row.device)+'</b><span>'+row.faces+' faces · '+row.edges+' edges</span><span>'+row.transitionGaps+' mapped transition gaps · '+row.missingFaces+' missing faces</span></button>').join('') + '<div class="deviceStat"><b>Unassigned gaps</b><span>'+unassigned+' missing faces need a mobile/desktop decision.</span></div>';
}
function render(){
  renderList();
  renderFace();
  renderTransitions();
  renderControls();
  renderMissing();
  renderDeviceBreakdown();
}
els.list.addEventListener('click', e => {
  const btn = e.target.closest('[data-face]');
  if (btn) selectFace(btn.dataset.face);
});
els.transitions.addEventListener('click', e => {
  const back = e.target.closest('[data-gap-back]');
  if (back) {
    selectFace(currentGap?.sourceId || 'F-A1');
    return;
  }
  const home = e.target.closest('[data-home]');
  if (home) {
    trail = [];
    selectFace('F-A1');
    return;
  }
  const btn = e.target.closest('[data-i]');
  if (!btn) return;
  const t = current.transitions[Number(btn.dataset.i)];
  if (t?.target) selectFace(t.target, current.id + ' · ' + t.trigger);
  else if (t?.missing) showGap(t, current);
});
els.missingList.addEventListener('click', e => {
  const btn = e.target.closest('[data-gap-index]');
  if (!btn) return;
  const g = DATA.missingFaces[Number(btn.dataset.gapIndex)];
  if (g) showGap({ trigger: 'Gap index', missing: g.label, note: g.neededFor + ' — ' + g.why }, null);
});
els.deviceTabs.addEventListener('click', e => {
  const btn = e.target.closest('[data-device-filter]');
  if (!btn) return;
  activeDevice = btn.dataset.deviceFilter;
  render();
});
els.deviceBreakdown.addEventListener('click', e => {
  const btn = e.target.closest('[data-device-filter-side]');
  if (!btn) return;
  activeDevice = btn.dataset.deviceFilterSide;
  render();
});
els.search.addEventListener('input', renderList);
els.domain.addEventListener('change', renderList);
document.getElementById('startHome').addEventListener('click', () => { trail = []; selectFace('F-A1'); });
document.getElementById('showGaps').addEventListener('click', () => {
  els.search.value = '';
  els.domain.value = 'All domains';
  const firstGap = faces.find(f => deviceMatches(f.device) && f.transitions.some(t => t.missing));
  if (firstGap) {
    current = firstGap;
    showGap(firstGap.transitions.find(t => t.missing), firstGap);
    return;
  }
  const firstMissing = filteredMissingFaces()[0];
  if (firstMissing) showGap({ trigger: 'Gap index', missing: firstMissing.label, note: firstMissing.neededFor + ' — ' + firstMissing.why }, null);
});
renderDomainOptions();
render();
</script>
</body>
</html>`;

writeFileSync(outFile, html);
writeFileSync(backlogFile, buildBacklogMarkdown());
writeFileSync(dispatchFile, buildLaneDispatchesMarkdown());
writeFileSync(gapRegisterFile, buildGapRegisterMarkdown());
console.log(`Wrote ${path.relative(root, outFile)} from ${faces.length} canon faces.`);
console.log(`Wrote ${path.relative(root, backlogFile)} from ${buildCards.length} face implementation cards.`);
console.log(`Wrote ${path.relative(root, dispatchFile)} from ${new Set(buildCards.map(laneForGap)).size} lane dispatches.`);
console.log(`Wrote ${path.relative(root, gapRegisterFile)} from ${missingFaces.length} missing faces and ${transitionGapRows().length} transition gaps.`);
