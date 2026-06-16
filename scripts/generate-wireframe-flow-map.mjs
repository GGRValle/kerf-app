import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const canonDir = path.join(root, 'docs/wireframes/canon');
const outFile = path.join(root, 'docs/wireframes/wireframe-flow-map.html');

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
  if (/^F-(A|P|AO|TO|SH|ES|C|FL|SU)\d/.test(id)) return 'Role homes';
  if (/^F-(S1|D1|RH|CAM|RC)/.test(id)) return 'Global phone chrome';
  if (/^F-(PR|PS|ML|CO|W1|PA)/.test(id)) return 'Projects';
  if (/^F-(SL|LD|PV|B1|B2|G1)/.test(id)) return 'Sales / decisions';
  if (/^F-(MN|BK|PU|VC)/.test(id)) return 'Money';
  if (/^F-(CL|CA|CS|WW)/.test(id)) return 'Clients';
  if (/^F-(E1|FD|FU|F1)/.test(id)) return 'Field capture';
  if (/^F-(SC|SB|CR|HR|SP|RR|AD|BC)/.test(id)) return 'Ops / admin';
  if (/^F-(MK)/.test(id)) return 'Marketing';
  if (/^F-(RP|AV|H1|TD)/.test(id)) return 'Reports / queues';
  return 'Other';
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
    controls: extractControls(source),
    transitions: [],
  };
  faceById.set(id, face);
  return face;
});

function target(id, note = '') {
  return { target: id, missing: '', note };
}

function missing(label, note = '') {
  return { target: '', missing: label, note };
}

function state(note = '') {
  return { target: '', state: true, missing: '', note };
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
  { trigger: 'Speak / center mic', ...target('F-RH1', 'Global Right Hand overlay; external F-RH7 bubble still missing from repo canon') },
  { trigger: 'Camera', ...target('F-CAM1', 'Global camera face') },
  { trigger: 'More', ...target('F-D1', 'More sidebar') },
];

add(['F-A1', 'F-A2'], [
  ...bottomNav,
  { trigger: 'One Thing / priority card', ...target('F-B1', 'Decision or review item selected from home') },
  { trigger: 'Project pulse tile', ...target('F-PR2', 'Project detail / project lens') },
  { trigger: 'Money pulse', ...target('F-MN1', 'Money domain') },
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
  { trigger: 'Clients', ...target('F-CL1') },
  { trigger: 'Marketing', ...target('F-MK1') },
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
  { trigger: 'Bubble transition', ...missing('F-RH7_bubble_transitions.html', 'Referenced by current canon, not present in repo canon') },
]);
add(['F-CAM1'], [
  { trigger: 'Open camera here / choose job', ...target('F-CAM1', 'Internal state: job picked -> camera') },
  { trigger: 'Walkthru mode', ...target('F-CAM1', 'Internal camera mode') },
  { trigger: 'Photo mode', ...target('F-CAM1', 'Internal camera mode') },
  { trigger: 'Scan mode', ...target('F-CAM1', 'Internal camera mode; document source for estimate/CO') },
  { trigger: 'Done', ...missing('F-DL1_mobile_daily_log.html', 'Capture should file to Daily Log or project media; Daily Log face missing from repo canon') },
  { trigger: 'Room scan', ...target('F-RC1') },
]);
add(['F-RC1'], [
  { trigger: 'Back to camera/start', ...target('F-CAM1') },
  { trigger: 'Add to project', ...target('F-PR2') },
  { trigger: 'Release preview', ...target('F-B1', 'Consequence gate if source becomes durable artifact') },
]);

add(['F-E1'], [
  { trigger: 'Take photo', ...target('F-CAM1') },
  { trigger: 'Attach file', ...state('File picker / preflight state') },
  { trigger: 'Type note', ...state('Typed note state') },
  { trigger: 'Done / submit', ...missing('F-DL1_mobile_daily_log.html', 'Canon Daily Log face missing') },
  { trigger: 'Office review', ...target('F-FU1') },
  { trigger: 'Transcript review', ...target('F-F1') },
  { trigger: 'Field detail', ...target('F-FD1') },
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
  { trigger: 'Daily Log', ...missing('F-DL1_mobile_daily_log.html', 'Missing Canon file') },
  { trigger: 'Work order', ...target('F-W1') },
  { trigger: 'Closeout', ...target('F-CO1a') },
  { trigger: 'Money lens', ...target('F-MN1') },
  { trigger: 'Proposal', ...target('F-PV1') },
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
add(['F-SL3', 'F-SL4'], [
  { trigger: 'Pipeline', ...target('F-SL1') },
  { trigger: 'Design workspace', ...missing('Design workspace face', 'Live app route exists; Canon file missing') },
  { trigger: 'Estimate builder', ...missing('F-EST1_mobile_estimate_builder.html') },
  { trigger: 'Proposal preview', ...target('F-PV1') },
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
add(['F-CL2', 'F-CL4', 'F-CL5', 'F-CL6'], [
  { trigger: 'Back clients', ...target('F-CL1') },
  { trigger: 'Project row', ...target('F-PR2') },
  { trigger: 'New project', ...missing('Project setup / new project face') },
  { trigger: 'Warranty', ...target('F-WW1a') },
  { trigger: 'Client success', ...target('F-CS1') },
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
add(['F-WW1a', 'F-WW1b'], [
  { trigger: 'Client record', ...target('F-CL5') },
  { trigger: 'Project', ...target('F-PR2') },
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
  { trigger: 'Connections', ...missing('Connections face', 'Live route exists; Canon file missing') },
]);
add(['F-SP1a'], [
  { trigger: 'Back settings', ...target('F-SP1') },
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
}

const missingFaces = [
  {
    label: 'F-A1b_mobile_owner_home_v5_pulse.html',
    neededFor: 'Updated owner home with 5 brain questions / pulse',
    why: 'Referenced in current conductor/user canon, not present in docs/wireframes/canon.',
  },
  {
    label: 'F-RH7_bubble_transitions.html',
    neededFor: 'Right Hand bottom bloom / side Tap to talk pill',
    why: 'Referenced in current conductor/user canon, not present in docs/wireframes/canon.',
  },
  {
    label: 'F-EST1_mobile_estimate_builder.html',
    neededFor: 'Estimate builder',
    why: 'Referenced repeatedly as the estimate face; not present in repo canon.',
  },
  {
    label: 'F-CHG1_mobile_change_order_builder.html',
    neededFor: 'Change order builder before F-B1 decision',
    why: 'Referenced by sprint dispatch; not present in repo canon.',
  },
  {
    label: 'F-DL1_mobile_daily_log.html',
    neededFor: 'Flat Daily Log surface',
    why: 'Referenced by Cursor C and current canon; not present in repo canon.',
  },
  {
    label: 'Per-job invoice list face',
    neededFor: 'Deposit / progress / final invoices under one job',
    why: 'User canon calls for this; repo only has money/AR/AP faces, not this explicit page.',
  },
  {
    label: 'Project setup / new project face',
    neededFor: 'Projects/new and client-to-project creation',
    why: 'Live app route exists; no dedicated Canon face.',
  },
  {
    label: 'Design workspace face',
    neededFor: 'Deal detail -> design -> estimate bridge',
    why: 'Live app route exists; no dedicated Canon face.',
  },
  {
    label: 'Connections / KB / Blackboard faces',
    neededFor: 'Settings integrations and knowledge-ingestion holding routes',
    why: 'Live app routes exist; no dedicated Canon faces.',
  },
];

const data = {
  generatedAt: new Date().toISOString(),
  source: 'docs/wireframes/canon/*.html',
  faces,
  missingFaces,
};

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
.app{display:grid;grid-template-columns:320px minmax(480px,1fr) 390px;min-height:100vh}
.rail{border-right:1px solid var(--line);background:#0a0f15;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.brand{padding:16px;border-bottom:1px solid var(--line);display:grid;gap:8px}.brand h1{font-size:16px;margin:0}.brand p{margin:0;color:var(--muted);font-size:12px}.brand strong{color:var(--gold)}
.tools{display:grid;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.tools input,.tools select{width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:9px}
.counts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.count{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:7px;text-align:center}.count b{display:block;color:var(--gold);font-size:15px}.count span{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.list{overflow:auto;padding:10px;display:grid;gap:6px}.facebtn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:9px;text-align:left;display:grid;gap:3px}.facebtn[aria-current=true]{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}.facebtn .top{display:flex;gap:8px;align-items:center}.id{color:var(--gold);font-weight:800}.device{margin-left:auto;color:var(--muted);font-size:10px;text-transform:uppercase}.file{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.main{min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr)}
.topbar{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:rgba(12,17,23,.92);position:sticky;top:0;z-index:4;backdrop-filter:blur(10px)}.topbar button,.topbar a{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:var(--r);padding:8px 10px;text-decoration:none}.topbar .primary{background:var(--gold);color:#1b1302;border-color:var(--gold);font-weight:800}.trail{margin-left:auto;color:var(--muted);font-size:12px;max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hero{padding:16px;border-bottom:1px solid var(--line);display:grid;gap:10px}.hero h2{font-size:24px;margin:0}.hero p{margin:0;color:var(--muted)}.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border-radius:999px;border:1px solid var(--line);background:var(--panel);padding:4px 8px;font-size:11px;color:var(--muted)}.chip.gold{border-color:rgba(231,170,59,.45);background:var(--soft-gold);color:var(--gold)}.chip.blue{border-color:rgba(47,109,240,.45);background:var(--soft-blue);color:#8fb0ff}.chip.red{border-color:rgba(183,56,56,.5);background:var(--soft-red);color:#ffb4b4}
.content{overflow:auto;padding:16px;display:grid;grid-template-columns:minmax(320px,500px) minmax(360px,1fr);gap:16px;align-items:start}.card{border:1px solid var(--line);background:var(--panel);border-radius:var(--r);padding:14px}.card h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin:0 0 10px;color:var(--muted)}.card p{margin:0 0 10px;color:var(--muted)}
.transitions{display:grid;gap:8px}.tbtn{width:100%;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);color:var(--ink);padding:10px;text-align:left;display:grid;gap:5px}.tbtn:hover{border-color:var(--gold)}.tbtn .row{display:flex;gap:8px;align-items:center}.tbtn .arrow{margin-left:auto;color:var(--muted)}.tbtn small{color:var(--muted)}.tbtn.missing{border-color:rgba(183,56,56,.5);background:var(--soft-red)}.tbtn.state{border-color:rgba(47,109,240,.35);background:var(--soft-blue)}
.controls{display:grid;gap:6px}.raw{display:flex;gap:6px;align-items:flex-start;border:1px solid var(--line);border-radius:var(--r);padding:7px;background:#101720}.raw code{color:var(--gold);font-size:11px}.raw span{color:var(--muted)}
.preview{height:70vh;min-height:520px;border:1px solid var(--line);border-radius:var(--r);background:#fff;overflow:hidden}.preview iframe{width:100%;height:100%;border:0;background:#fff}
.side{border-left:1px solid var(--line);background:#0a0f15;position:sticky;top:0;height:100vh;overflow:auto;padding:14px;display:grid;gap:12px;align-content:start}.gap{border:1px solid rgba(183,56,56,.45);background:var(--soft-red);border-radius:var(--r);padding:10px}.gap b{display:block;color:#ffb4b4}.gap span{color:var(--muted)}
.mini{border:1px solid var(--line);background:var(--panel);border-radius:var(--r);padding:10px}.mini h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.mini ul{margin:0;padding-left:18px;color:var(--muted)}.mini li{margin:0 0 6px}.hidden{display:none!important}
@media(max-width:1050px){.app{grid-template-columns:1fr}.rail,.side{position:relative;height:auto}.content{grid-template-columns:1fr}.trail{display:none}}
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
      <div class="leftcol">
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
      <div class="preview"><iframe id="preview" title="Original wireframe preview"></iframe></div>
    </section>
  </main>
  <aside class="side">
    <div class="mini">
      <h3>Missing Faces To Build</h3>
      <div id="missingList"></div>
    </div>
    <div class="mini">
      <h3>How To Use</h3>
      <ul>
        <li>Pick a face on the left.</li>
        <li>Use Expected Click Paths as the contract.</li>
        <li>Red paths mean the target face does not exist yet.</li>
        <li>The iframe is the original wireframe, not app UI.</li>
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
let trail = [];
const els = {
  search: document.getElementById('search'),
  domain: document.getElementById('domain'),
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
  original: document.getElementById('openOriginal'),
  missingList: document.getElementById('missingList'),
  trail: document.getElementById('trail'),
};
function esc(s){return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function domains(){return ['All domains', ...Array.from(new Set(faces.map(f=>f.domain))).sort()];}
function renderDomainOptions(){els.domain.innerHTML = domains().map(d => '<option>'+esc(d)+'</option>').join('');}
function filteredFaces(){
  const q = els.search.value.trim().toLowerCase();
  const d = els.domain.value;
  return faces.filter(f => (d === 'All domains' || f.domain === d) && (!q || [f.id,f.file,f.title,f.h1,f.domain].join(' ').toLowerCase().includes(q)));
}
function renderList(){
  const list = filteredFaces();
  els.list.innerHTML = list.map(f => '<button class="facebtn" data-face="'+esc(f.id)+'" aria-current="'+(f.id===current.id)+'"><span class="top"><span class="id">'+esc(f.id)+'</span><span class="device">'+esc(f.device)+'</span></span><span>'+esc(f.h1 || f.title)+'</span><span class="file">'+esc(f.file)+'</span></button>').join('');
  els.faceCount.textContent = faces.length;
  els.edgeCount.textContent = faces.reduce((n,f)=>n+f.transitions.length,0);
  els.gapCount.textContent = DATA.missingFaces.length + faces.reduce((n,f)=>n+f.transitions.filter(t=>t.missing).length,0);
}
function selectFace(id, trigger){
  const next = byId.get(id);
  if (!next) return;
  if (trigger) trail.push(trigger + ' → ' + id);
  current = next;
  render();
}
function renderFace(){
  els.chips.innerHTML = '<span class="chip gold">'+esc(current.id)+'</span><span class="chip blue">'+esc(current.domain)+'</span><span class="chip">'+esc(current.device)+'</span>';
  els.title.textContent = current.h1 || current.title;
  els.meta.textContent = current.file + ' · ' + current.title;
  els.preview.src = 'canon/' + current.file;
  els.original.href = 'canon/' + current.file;
  els.trail.textContent = trail.length ? 'Trail: ' + trail.slice(-5).join(' / ') : 'Trail: none';
}
function renderTransitions(){
  els.transitions.innerHTML = current.transitions.map((t, i) => {
    const cls = t.missing ? 'missing' : t.state ? 'state' : '';
    const to = t.target || t.missing || 'same face';
    return '<button class="tbtn '+cls+'" data-i="'+i+'"><span class="row"><b>'+esc(t.trigger)+'</b><span class="arrow">→ '+esc(to)+'</span></span>'+(t.note?'<small>'+esc(t.note)+'</small>':'')+'</button>';
  }).join('');
}
function renderControls(){
  if (!current.controls.length) {
    els.controls.innerHTML = '<div class="raw"><span>No buttons/links were extractable from this static face.</span></div>';
    return;
  }
  els.controls.innerHTML = current.controls.map(c => '<div class="raw"><code>'+esc(c.kind)+'</code><span>'+esc(c.label)+'</span>'+(c.href?'<span>href='+esc(c.href)+'</span>':'')+(c.dataGo?'<span>state='+esc(c.dataGo)+'</span>':'')+'</div>').join('');
}
function renderMissing(){
  els.missingList.innerHTML = DATA.missingFaces.map(g => '<div class="gap"><b>'+esc(g.label)+'</b><span>'+esc(g.neededFor)+' — '+esc(g.why)+'</span></div>').join('');
}
function render(){
  renderList();
  renderFace();
  renderTransitions();
  renderControls();
  renderMissing();
}
els.list.addEventListener('click', e => {
  const btn = e.target.closest('[data-face]');
  if (btn) selectFace(btn.dataset.face);
});
els.transitions.addEventListener('click', e => {
  const btn = e.target.closest('[data-i]');
  if (!btn) return;
  const t = current.transitions[Number(btn.dataset.i)];
  if (t?.target) selectFace(t.target, current.id + ' · ' + t.trigger);
});
els.search.addEventListener('input', renderList);
els.domain.addEventListener('change', renderList);
document.getElementById('startHome').addEventListener('click', () => { trail = []; selectFace('F-A1'); });
document.getElementById('showGaps').addEventListener('click', () => {
  els.search.value = '';
  els.domain.value = 'All domains';
  const firstGap = faces.find(f => f.transitions.some(t => t.missing));
  if (firstGap) selectFace(firstGap.id);
});
renderDomainOptions();
render();
</script>
</body>
</html>`;

writeFileSync(outFile, html);
console.log(`Wrote ${path.relative(root, outFile)} from ${faces.length} canon faces.`);
