/**
 * V1.5 Field Daily — Daily Log Extracted Facts (Step B.2).
 *
 * Deterministic regex + classifier extractor for the 9-field
 * `DailyLogExtractedFacts` shape per Field Daily §3 canon.
 *
 * Locked against the Henderson golden fixture transcript (from
 * `kerf_wireframes_mobile_v2.html` FRAME 7 demo):
 *
 *   "Mike here at Henderson — we pulled the tub surround and there's
 *    galvanized all the way back to the main. Gotta replace about
 *    8 feet. Bumping you on the CO."
 *
 * Expected extraction on Henderson:
 *   completed_work:       ['pulled the tub surround']
 *   money_risk_flags:     ['galvanized']
 *   scope_change_flags:   ['galvanized all the way back to the main']
 *   schedule_status:      'behind' (from 'bumping you')
 *   materials_needed:     ['about 8 feet']
 *   (other 5 categories): empty
 *
 * ARCHITECTURE INVARIANTS:
 *   - Deterministic core; no LLM, no fetch, no external services
 *   - Pure function: same transcript + entry_kind → same facts
 *   - All 9 fields populated (empty arrays for no-match categories;
 *     never null in array fields)
 *   - `schedule_status` defaults to 'unknown' when no trigger fires
 *
 * STEP B.2 SCOPE:
 *   - `progress_update` entry kind is the canonical test case
 *   - Other entry kinds (`blocker`, `change_signal`, `safety_note`,
 *     `morning_brief`, `end_of_day`, `clock_event`) work but aren't
 *     explicitly tuned; Step C will expand coverage per kind
 *
 * MATERIALS_NEEDED LIMITATION (worth knowing):
 *   The extractor captures *quantity phrases* like "about 8 feet" but
 *   does NOT infer the material identity. The Henderson "galvanized
 *   → copper substitution" inference is human judgment, not extraction.
 *   The operator's relay-card review surfaces the extracted phrase +
 *   the source transcript; the operator confirms or refines the
 *   material identity. This is correct per Field Daily §3 — extracted
 *   facts are CANDIDATES, not commitments.
 */

// ──────────────────────────────────────────────────────────────────────────
// Type definition
// ──────────────────────────────────────────────────────────────────────────

/**
 * Structured residue of a Daily Log entry — what the Field Capture play
 * extracts from the transcript. Per Field Daily §3 (locked canon).
 *
 * **CANDIDATES, not commitments.** Right Hand surfaces these on the relay
 * card; nothing auto-fires.
 */
export interface DailyLogExtractedFacts {
  readonly completed_work: readonly string[];
  readonly blocked_work: readonly { description: string; blocker: string }[];
  readonly schedule_status: 'on_track' | 'behind' | 'ahead' | 'unknown';
  readonly new_task_candidates: readonly string[];
  readonly scope_change_flags: readonly string[];
  readonly money_risk_flags: readonly string[];
  readonly client_decision_flags: readonly string[];
  readonly materials_needed: readonly string[];
  readonly inspection_notes: readonly string[];
  readonly safety_notes: readonly string[];
}

/** Empty 9-field shape. Returned when transcript is empty (clock events,
 *  photo-only entries). Also useful as a test baseline. */
export const EMPTY_EXTRACTED_FACTS: DailyLogExtractedFacts = {
  completed_work: [],
  blocked_work: [],
  schedule_status: 'unknown',
  new_task_candidates: [],
  scope_change_flags: [],
  money_risk_flags: [],
  client_decision_flags: [],
  materials_needed: [],
  inspection_notes: [],
  safety_notes: [],
};

// ──────────────────────────────────────────────────────────────────────────
// Pattern tables — each category has its own regex set
// ──────────────────────────────────────────────────────────────────────────

/**
 * Completed-work triggers: action verb + work artifact.
 * Captures the work artifact phrase.
 */
const COMPLETED_WORK_PATTERN = /\b(?:we\s+)?(pulled|completed|finished|wrapped\s+up|knocked\s+out|installed|set|hung|laid|poured|demo'?d|demoed|got\s+(?:the|a)|done\s+with)\s+([a-z][^.,;!?]*?)(?=[.,;!?]|\s+and\b|\s+(?:but|so|then)\b|$)/gi;

/**
 * Blocked-work triggers with explicit cause.
 * "stuck on X because Y" / "can't do X due to Y"
 */
const BLOCKED_WORK_WITH_CAUSE_PATTERN = /\b(?:stuck\s+on|cannot|can'?t|blocked\s+(?:by|on))\s+([a-z][^.,;!?]*?)\s+(?:because|due\s+to|cause)\s+([a-z][^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Blocked-work bare (no cause stated).
 * "waiting on X" — cause inferred as the same phrase
 */
const BLOCKED_WORK_BARE_PATTERN = /\b(waiting\s+on|blocker\s+is|hung\s+up\s+on)\s+([a-z][^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Schedule status triggers. Priority order: behind > ahead > on_track.
 * (Conservative: if both behind and ahead trigger, treat as behind —
 * mixed signals are still a signal that the operator should review.)
 */
const SCHEDULE_BEHIND_TRIGGERS = /\b(bumping\s+you|running\s+late|delayed|going\s+to\s+slip|extra\s+(?:day|hour|days|hours)|couple\s+more\s+days|adds?\s+(?:about\s+)?\d+(?:\.\d+)?\s+(?:day|hour|days|hours)|set\s+us\s+back|had\s+to\s+push|going\s+to\s+take\s+longer|push(?:ing)?\s+(?:the\s+)?schedule)\b/i;
const SCHEDULE_AHEAD_TRIGGERS = /\b(ahead\s+of\s+(?:schedule|pace)|wrapped\s+up\s+early|got\s+it\s+done\s+quicker|finished\s+early|ahead\s+of\s+plan)\b/i;
const SCHEDULE_ON_TRACK_TRIGGERS = /\b(on\s+track|on\s+schedule|going\s+as\s+planned|everything'?s\s+(?:good|fine)|no\s+issues|all\s+good)\b/i;

/**
 * New-task candidates. "we should also", "while we're at it", etc.
 */
const NEW_TASK_PATTERN = /\b(?:we\s+(?:need|should)\s+to\s+also|also\s+need\s+to|should\s+(?:add|do|tackle)|while\s+we'?re\s+at\s+it|might\s+as\s+well|may\s+as\s+well)\s+([a-z][^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Scope-change explicit triggers.
 */
const SCOPE_CHANGE_EXPLICIT_PATTERN = /\b(?:owner\s+asked|they\s+want|they'?re\s+adding|change\s+order|extra\s+work\s+for|added?\s+scope)\s+(?:for\s+|to\s+|us\s+to\s+)?([a-z][^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Scope-change implicit triggers — hidden-condition findings that
 * expand the scope without an explicit "owner asked." E.g., galvanized
 * plumbing discovered → scope expansion is implicit.
 */
const SCOPE_CHANGE_IMPLICIT_PATTERN = /\b(galvanized|asbestos|knob[\s-]?and[\s-]?tube|lath\s+and\s+plaster|rotten\s+sub-?floor|water\s+damage|mold)\s+([^.,;!?]*?(?:back\s+to|all\s+the\s+way|throughout|behind|under)[^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Money-risk keywords. Single-keyword triggers (the keyword itself
 * is the flag; the operator can read the source transcript for
 * context).
 */
const MONEY_RISK_KEYWORDS = /\b(galvanized|asbestos|hidden|surprise|over\s+budget|substitution|had\s+to\s+replace|didn'?t\s+account|rotten|termite\s+damage|water\s+damage|mold|knob[\s-]?and[\s-]?tube)\b/gi;

/**
 * Client-decision triggers.
 */
const CLIENT_DECISION_PATTERN = /\b(owner\s+needs?\s+to\s+(?:pick|choose|decide|confirm)|client\s+(?:needs?\s+to\s+|to\s+)(?:decide|confirm|choose|pick)|homeowner\s+(?:has\s+to|needs\s+to)\s+(?:choose|pick|confirm|decide)|pending\s+owner\s+(?:sign-?off|approval|decision))\b([^.,;!?]*?)(?=[.,;!?]|$)/gi;

/**
 * Materials-needed. Captures quantity phrases following action verbs.
 * Also captures bare "X feet/ft/sf/lf of Y" patterns.
 */
const MATERIALS_NEEDED_PATTERN = /\b(?:need(?:s)?|bring|order|pickup|grab|gotta\s+(?:replace|get)|got(?:ta)?\s+to\s+(?:replace|get))\s+(?:about\s+)?([\d.½¼¾]+\s*(?:feet|ft|inches?|in|yards?|yd|sf|lf|square\s+feet|linear\s+feet)?(?:\s+(?:of\s+)?[a-z\d/.\-"' ]+?)?)(?=[.,;!?]|\s+(?:and|so|then|but)\b|$)/gi;

/**
 * Inspection notes.
 */
const INSPECTION_KEYWORDS = /\b(inspector(?:'?s)?\s+\w+|passed\s+inspection|failed\s+inspection|inspection\s+sign-?off|code\s+violation|to\s+code|not\s+to\s+code|red[\s-]?tagged|green[\s-]?tagged)\b/gi;

/**
 * Safety notes.
 */
const SAFETY_KEYWORDS = /\b(fall\s+hazard|scaffold|harness|PPE|lockout|tagout|near\s+miss|incident|OSHA|safety\s+(?:concern|issue|incident)|injured?|injury)\b/gi;

// ──────────────────────────────────────────────────────────────────────────
// Extraction helpers
// ──────────────────────────────────────────────────────────────────────────

/** Run a global regex against text, return all match group 1 values, deduped + trimmed. */
function extractMatches(pattern: RegExp, text: string, groupIdx = 1): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(pattern)) {
    const v = m[groupIdx];
    if (v === undefined) continue;
    const cleaned = v.trim().replace(/\s+/g, ' ');
    if (cleaned.length === 0) continue;
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push(cleaned);
  }
  return matches;
}

/** Extract blocked_work entries (description + blocker). */
function extractBlockedWork(text: string): { description: string; blocker: string }[] {
  const out: { description: string; blocker: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(BLOCKED_WORK_WITH_CAUSE_PATTERN)) {
    const desc = m[1]?.trim() ?? '';
    const blocker = m[2]?.trim() ?? '';
    if (desc.length === 0 || blocker.length === 0) continue;
    const key = `${desc.toLowerCase()}|${blocker.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ description: desc, blocker: blocker });
  }
  for (const m of text.matchAll(BLOCKED_WORK_BARE_PATTERN)) {
    const desc = m[2]?.trim() ?? '';
    if (desc.length === 0) continue;
    const key = `${desc.toLowerCase()}|`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ description: desc, blocker: desc });
  }
  return out;
}

/** Classify schedule status by trigger priority. Default unknown. */
function classifyScheduleStatus(
  text: string,
): DailyLogExtractedFacts['schedule_status'] {
  // Priority: behind > ahead > on_track > unknown
  if (SCHEDULE_BEHIND_TRIGGERS.test(text)) return 'behind';
  if (SCHEDULE_AHEAD_TRIGGERS.test(text)) return 'ahead';
  if (SCHEDULE_ON_TRACK_TRIGGERS.test(text)) return 'on_track';
  return 'unknown';
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extract the 9-field structured facts from a transcript.
 *
 * **Deterministic.** Same transcript + entry_kind → same facts.
 * **Pure.** No I/O, no LLM, no external state.
 *
 * @param transcript - The Whisper transcript (or operator-typed note) text.
 *                     Empty string returns EMPTY_EXTRACTED_FACTS.
 * @param entryKind  - Discriminator from the captured event. Currently
 *                     unused (B.2 ships extractor general to all kinds);
 *                     Step C may bias category emphasis per kind.
 */
export function extractDailyLogFacts(
  transcript: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entryKind: string,
): DailyLogExtractedFacts {
  const text = transcript.trim();
  if (text.length === 0) return EMPTY_EXTRACTED_FACTS;

  // Combine explicit + implicit scope-change triggers; dedupe.
  const scopeExplicit = extractMatches(SCOPE_CHANGE_EXPLICIT_PATTERN, text);
  const scopeImplicit: string[] = [];
  for (const m of text.matchAll(SCOPE_CHANGE_IMPLICIT_PATTERN)) {
    const head = m[1]?.trim();
    const tail = m[2]?.trim();
    if (head && tail) scopeImplicit.push(`${head} ${tail}`.replace(/\s+/g, ' '));
  }
  const scopeChangeFlags = [...scopeExplicit, ...scopeImplicit].filter(
    (v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
  );

  // For materials_needed, we capture quantity phrases. The operator's
  // relay-card review supplies the material identity if extraction
  // captured only the quantity.
  const materialsRaw = extractMatches(MATERIALS_NEEDED_PATTERN, text);
  const materialsNeeded = materialsRaw.map((s) => s.replace(/^\s+|\s+$/g, ''));

  return {
    completed_work: extractMatches(COMPLETED_WORK_PATTERN, text, 2),
    blocked_work: extractBlockedWork(text),
    schedule_status: classifyScheduleStatus(text),
    new_task_candidates: extractMatches(NEW_TASK_PATTERN, text),
    scope_change_flags: scopeChangeFlags,
    money_risk_flags: extractMatches(MONEY_RISK_KEYWORDS, text, 0).map((s) => s.toLowerCase().trim()),
    client_decision_flags: extractMatches(CLIENT_DECISION_PATTERN, text, 0),
    materials_needed: materialsNeeded,
    inspection_notes: extractMatches(INSPECTION_KEYWORDS, text, 0),
    safety_notes: extractMatches(SAFETY_KEYWORDS, text, 0),
  };
}
