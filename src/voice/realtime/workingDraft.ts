export interface WorkingDraftFields {
  readonly rawText: string;
  readonly clientName: string | null;
  readonly projectName: string | null;
  readonly archetypeHint: 'kitchen_remodel' | 'bath_refresh' | 'adu' | null;
  readonly scopeSummary: string | null;
  readonly scopeFacts: readonly string[];
  readonly needsNewClient: boolean;
  readonly needsNewProject: boolean;
  readonly scope: readonly string[];
  readonly known_entities: readonly WorkingDraftKnownEntity[];
  readonly open_items: readonly string[];
  readonly assumptions: readonly string[];
  readonly allowances: readonly string[];
  readonly next_action: string | null;
  readonly proposed_artifact: 'job_note' | 'project_intake' | 'estimate_draft' | null;
  readonly source_refs: readonly string[];
}

export interface WorkingDraftKnownEntity {
  readonly type: 'client' | 'project' | 'site' | 'lead';
  readonly kind?: 'client' | 'project' | 'site' | 'lead';
  readonly label: string;
  readonly source: 'operator' | 'tenant_context' | 'model';
  readonly id?: string;
}

export type WorkingDraftUpdate = Partial<Pick<
  WorkingDraftFields,
  | 'scope'
  | 'known_entities'
  | 'open_items'
  | 'assumptions'
  | 'allowances'
  | 'next_action'
  | 'proposed_artifact'
  | 'source_refs'
>>;

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
    /\b(?:the\s+)?([A-Z][A-Za-z'-]+)\s+(?:project|job)\b/i,
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
    if (clean.length > 2 && !/^(?:a|an|the)\s+/i.test(clean)) return titleCaseName(clean);
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
    [/\bdownstairs\b.*\bfloor|\bfloor.*\bdownstairs\b/, 'downstairs flooring'],
    [/\bbath(?:room)?\b/, 'bath remodel'],
    [/\bflooring\b|\bfloor\b/, 'flooring'],
    [/\btile\b.*\bcarpet\b|\bcarpet\b.*\btile\b/, 'tile/carpet flooring demo'],
    [/\bglue[-\s]?down\b.*\bwood\b|\bwood\b.*\bglue[-\s]?down\b/, 'glue-down wood flooring'],
    [/\bglue[-\s]?down\b/, 'glue-down flooring'],
    [/\bbaseboard/, 'baseboards'],
    [/\bpaint\b|\bpainting\b/, 'paint'],
    [/\bcabinet/, 'cabinetry'],
    [/\b(?:\d{1,3}|sixty)\s+(?:lineal|linear)\s+(?:feet|foot|ft)\b.*\bcabinet|\bcabinet.*\b(?:\d{1,3}|sixty)\s+(?:lineal|linear)\s+(?:feet|foot|ft)\b/, 'cabinetry allowance'],
    [/\bquartz\b|\bcountertop/, 'countertops'],
    [/\bquartzite\b/, 'quartzite countertops'],
    [/\bwhite oak\b/, 'white oak finish'],
    [/\b(?:\d{3,5}|thousand)\s+square\s+feet\b|\b\d{3,5}\s*sq\s*ft\b/, 'rough square footage'],
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(lower)) facts.push(label);
  }
  return facts;
}

function extractAllowances(text: string): readonly string[] {
  const allowances: string[] = [];
  const lower = text.toLowerCase();
  const cabinetryMatch = lower.match(/\b(?:about\s+|roughly\s+|around\s+)?(\d{1,3}|sixty)\s+(?:lineal|linear)\s+(?:feet|foot|ft)\b.*\bcabinet/);
  if (cabinetryMatch?.[1]) {
    const raw = cabinetryMatch[1] === 'sixty' ? '60' : cabinetryMatch[1];
    allowances.push(`${raw} LF cabinetry`);
  }
  const sqftMatch = lower.match(/\b(?:about\s+|roughly\s+|around\s+)?(\d{3,5}|a\s+thousand|thousand)\s+(?:square\s+feet|sq\s*ft|square\s+foot)\b/);
  if (sqftMatch?.[1]) {
    const raw = sqftMatch[1].replace(/^a\s+/, '') === 'thousand' ? '1000' : sqftMatch[1].replace(/^a\s+/, '');
    allowances.push(`${raw} sqft flooring`);
  }
  if (/\bquartzite\b.*\bcountertop|\bcountertop.*\bquartzite\b/.test(lower)) {
    allowances.push('quartzite countertops');
  }
  return allowances;
}

function scopeFromFacts(facts: readonly string[]): readonly string[] {
  const scope = facts.filter((fact) => fact !== 'rough square footage' && !fact.endsWith('allowance'));
  return Array.from(new Set(scope));
}

function uniqueStrings(...lists: readonly (readonly string[] | undefined)[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const clean = compact(item);
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function uniqueEntities(
  ...lists: readonly (readonly WorkingDraftKnownEntity[] | undefined)[]
): readonly WorkingDraftKnownEntity[] {
  const out: WorkingDraftKnownEntity[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const entity of list ?? []) {
      const type = entity.type;
      const label = compact(entity.label);
      if (!label) continue;
      const key = `${type}:${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type,
        kind: entity.kind ?? type,
        label,
        source: entity.source,
        ...(entity.id ? { id: entity.id } : {}),
      });
    }
  }
  return out;
}

export function mergeWorkingDraftFields(
  base: WorkingDraftFields,
  update: WorkingDraftUpdate | undefined,
): WorkingDraftFields {
  if (!update) return base;
  return {
    ...base,
    scope: uniqueStrings(base.scope, update.scope),
    known_entities: uniqueEntities(base.known_entities, update.known_entities),
    open_items: uniqueStrings(base.open_items, update.open_items),
    assumptions: uniqueStrings(base.assumptions, update.assumptions),
    allowances: uniqueStrings(base.allowances, update.allowances),
    next_action: update.next_action ?? base.next_action,
    proposed_artifact: update.proposed_artifact !== undefined
      ? update.proposed_artifact
      : base.proposed_artifact,
    source_refs: uniqueStrings(base.source_refs, update.source_refs),
  };
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
  const knownEntities: WorkingDraftKnownEntity[] = [];
  if (clientName) knownEntities.push({ type: 'client', kind: 'client', label: clientName, source: 'operator' });
  if (projectName) knownEntities.push({ type: 'project', kind: 'project', label: projectName, source: 'operator' });
  const assumptions: string[] = [];
  if (clientName && projectName && !/\b(?:project|job)\s+(?:is|name\s+is|named)\b/i.test(combined)) {
    assumptions.push('project name inferred from client and scope');
  }
  const openItems: string[] = [];
  if ((needsNew || scopeFacts.length > 0) && !clientName) openItems.push('client name');
  if ((needsNew || scopeFacts.length > 0) && !projectName) openItems.push('project name');
  const allowances = extractAllowances(combined);
  const scope = scopeFromFacts(scopeFacts);
  return {
    rawText,
    clientName,
    projectName,
    archetypeHint,
    scopeSummary: rawText || null,
    scopeFacts,
    needsNewClient: needsNew || !!clientName,
    needsNewProject: needsNew || !!projectName,
    scope,
    known_entities: knownEntities,
    open_items: openItems,
    assumptions,
    allowances,
    next_action: needsNew || scopeFacts.length > 0
      ? 'prepare project intake draft'
      : null,
    proposed_artifact: needsNew || scopeFacts.length > 0
      ? 'project_intake'
      : rawText
        ? 'job_note'
        : null,
    source_refs: rawText ? ['turn:working_draft'] : [],
  };
}
