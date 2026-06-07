export interface WorkingDraftFields {
  readonly rawText: string;
  readonly clientName: string | null;
  readonly projectName: string | null;
  readonly archetypeHint: 'kitchen_remodel' | 'bath_refresh' | 'adu' | null;
  readonly scopeSummary: string | null;
  readonly scopeFacts: readonly string[];
  readonly needsNewClient: boolean;
  readonly needsNewProject: boolean;
}

const STOP_WORDS = new Set([
  'new',
  'project',
  'job',
  'client',
  'family',
  'flooring',
  'kitchen',
  'remodel',
  'name',
  'pantry',
  'the',
  'this',
  'that',
  'for',
  'our',
  'current',
]);

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCaseName(value: string): string {
  return compact(value)
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => (
      part.length <= 2 && part === part.toUpperCase()
        ? part
        : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
    ))
    .join(' ');
}

function stripTrailingNoise(value: string): string {
  return compact(value)
    .replace(/\b(?:project|job|client|family|remodel|estimate|scope)\b.*$/i, '')
    .replace(/[.,!?;:]+$/g, '')
    .trim();
}

function plausibleName(value: string): string | null {
  const clean = stripTrailingNoise(value);
  if (!clean) return null;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;
  if (tokens.some((token) => STOP_WORDS.has(token.toLowerCase()))) return null;
  if (!tokens.some((token) => /^[A-Z]/.test(token) || token.length >= 4)) return null;
  return titleCaseName(tokens.join(' '));
}

function detectClientName(text: string): string | null {
  const patterns = [
    /\b(?:client|customer)\s+(?:is|name\s+is|named)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/i,
    /\bfamily\s+name\s+is\s+(?:the\s+)?([A-Z][A-Za-z'-]+)(?:\s+family)?/i,
    /\b(?:the\s+)?([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+family\b/i,
    /\b([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)\s+(?:wants|needs|is\s+looking|would\s+like|asked)\b/i,
    /\b(?:for|with)\s+(?:the\s+)?([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})(?:\s+(?:family|project|job))?\b/i,
    /\b([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)\s+(?:project|job)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = plausibleName(match?.[1] ?? '');
    if (name) return name;
  }
  return null;
}

function detectArchetype(text: string): WorkingDraftFields['archetypeHint'] {
  const lower = text.toLowerCase();
  if (/\b(kitchen|cabinet|countertop|countertops|appliance|island|pantry|quartz)\b/.test(lower)) {
    return 'kitchen_remodel';
  }
  if (/\b(bath|bathroom|shower|tub|vanity)\b/.test(lower)) return 'bath_refresh';
  if (/\b(adu|addition)\b/.test(lower)) return 'adu';
  return null;
}

function projectSubject(clientName: string | null): string {
  if (!clientName) return '';
  const parts = clientName.split(/\s+/).filter(Boolean);
  if (/family$/i.test(clientName)) return clientName.replace(/\s+family$/i, '');
  return parts.at(-1) ?? clientName;
}

function detectProjectName(text: string, clientName: string | null, archetype: WorkingDraftFields['archetypeHint']): string | null {
  const explicit = text.match(/\b(?:project|job)\s+(?:is|name\s+is|named)\s+([A-Z][A-Za-z0-9' -]{2,80})/i);
  if (explicit?.[1]) {
    const clean = compact(explicit[1]).replace(/[.,!?;:]+$/g, '');
    if (clean.length > 2) return titleCaseName(clean);
  }
  const subject = projectSubject(clientName);
  if (!subject) return null;
  if (archetype === 'kitchen_remodel') return `${subject} kitchen remodel`;
  if (archetype === 'bath_refresh') return `${subject} bath remodel`;
  if (archetype === 'adu') return `${subject} ADU`;
  return `${subject} project`;
}

function extractScopeFacts(text: string): readonly string[] {
  const facts: string[] = [];
  const lower = text.toLowerCase();
  const candidates: readonly [RegExp, string][] = [
    [/\bkitchen\b/, 'kitchen remodel'],
    [/\bflooring\b|\bfloor\b/, 'flooring'],
    [/\bbaseboard/, 'baseboards'],
    [/\bpaint\b|\bpainting\b/, 'paint'],
    [/\bcabinet/, 'cabinetry'],
    [/\bquartz\b|\bcountertop/, 'countertops'],
    [/\bwhite oak\b/, 'white oak finish'],
    [/\b(?:\d{3,5}|thousand)\s+square\s+feet\b|\b\d{3,5}\s*sq\s*ft\b/, 'rough square footage'],
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(lower)) facts.push(label);
  }
  return facts;
}

export function deriveWorkingDraftFields(text: string, destinationLabel = ''): WorkingDraftFields {
  const rawText = compact(text).slice(0, 2400);
  const combined = compact(`${rawText} ${destinationLabel}`);
  const destinationName = plausibleName(destinationLabel);
  const clientName = detectClientName(combined) ?? destinationName;
  const archetypeHint = detectArchetype(combined);
  const projectName = detectProjectName(combined, clientName, archetypeHint);
  const lower = combined.toLowerCase();
  const scopeFacts = extractScopeFacts(combined);
  const needsNew = /\b(new project|new job|new client|start(?:ing)? (?:a )?(?:new )?(?:project|job|estimate)|open up a job file)\b/.test(lower);
  return {
    rawText,
    clientName,
    projectName,
    archetypeHint,
    scopeSummary: rawText || null,
    scopeFacts,
    needsNewClient: needsNew || !!clientName,
    needsNewProject: needsNew || !!projectName,
  };
}
