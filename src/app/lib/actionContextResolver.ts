/**
 * Phase 1D L0.4 harden · AST-walker companion to the regex check at
 * `tests/surface-irreversibility-wrap.test.ts`.
 *
 * The regex check accepts string literals, `t()` calls, and identifier
 * references at the call site (sufficient to enforce rule #10 i18n
 * compatibility). This module is the deeper check: it RESOLVES each
 * actionContext expression to its concrete string value and rejects
 * boilerplate copy regardless of call-site form.
 *
 * Banked rule this enforces: "build ≠ gate · semantic vs syntactic"
 * — the L0.3 validator catches enum membership; this module catches
 * semantic-correctness for actionContext copy.
 *
 * Resolver handles three call-site forms:
 *   - String literal:   actionContext="..."        / actionContext='...'
 *                       actionContext={'...'}      / actionContext={"..."}
 *                       actionContext={`...`}
 *   - i18n call:        actionContext={t('key')}   / actionContext={t("key")}
 *   - Identifier ref:   actionContext={someVar}    (traced to frontmatter const)
 *
 * Rejects: omitted entirely · actionContext={} · actionContext={null}
 * · expressions the resolver cannot trace to a concrete string.
 *
 * Walker output is a list of ResolvedActionContext entries. The validator
 * then runs the boilerplate-rejection + substantive-copy heuristic over
 * each resolved string.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// ============================================================================
// Public types
// ============================================================================

export interface ResolvedActionContext {
  /** Absolute path to the .astro file containing the wrap. */
  readonly file: string;
  /** 1-indexed line number where the wrap's opening tag starts. */
  readonly line: number;
  /** Raw expression as it appeared in source (for diagnostics). */
  readonly expression: string;
  /**
   * Resolution status. 'resolved' carries a concrete string. 'unresolved'
   * means the resolver could not trace the expression to a string (e.g.
   * complex expression, unknown identifier, dynamic i18n key).
   * 'missing' means the wrap had kind="irreversibility" without an
   * actionContext attribute, or with actionContext={}/null.
   */
  readonly status: 'resolved' | 'unresolved' | 'missing';
  /** Concrete resolved string (only when status === 'resolved'). */
  readonly resolved?: string;
  /** Reason text when status !== 'resolved'. */
  readonly reason?: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

// ============================================================================
// Boilerplate rejection list + substantive-copy heuristics
// ============================================================================

/**
 * Phrases that ALWAYS fail validation regardless of context. These are the
 * boilerplate strings D-048 explicitly rejects ("ask scope, not approval").
 * Extend this list as new boilerplate patterns surface in review.
 */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /\bare you sure\b\??/i,
  /\bthis action cannot be undone\b/i,
  /\bcannot be undone\b/i,
  /^\s*confirm\??\s*$/i,
  /\byes\s*\/\s*no\b/i,
  /^\s*proceed\??\s*$/i,
  /^\s*continue\??\s*$/i,
  /\bclick (ok|yes) to (confirm|continue|proceed)\b/i,
];

/**
 * Heuristic action verbs that indicate the copy names what's happening.
 * Both inflected (sending, releasing) and root (send, release) forms.
 * Extend as the surface count grows.
 */
const ACTION_VERBS: readonly string[] = [
  'send', 'sending', 'submit', 'submitting', 'release', 'releasing',
  'lock', 'locks', 'locking', 'delete', 'deleting', 'remove', 'removing',
  'approve', 'approving', 'write', 'writes', 'writing', 'create', 'creating',
  'cascade', 'cascading', 'trigger', 'triggers', 'triggering',
  'commit', 'committing', 'persist', 'persists', 'persisting',
  'export', 'exporting', 'finalize', 'finalizing', 'archive', 'archiving',
];

/**
 * Heuristic artifact nouns naming what's affected. Extend as new surfaces
 * introduce new artifacts.
 */
const ARTIFACT_NOUNS: readonly string[] = [
  'proposal', 'capture', 'measurement', 'invoice', 'packet', 'order',
  'draft', 'estimate', 'change-order', 'change order', 'co',
  'daily log', 'daily-log', 'project', 'client', 'fab order', 'fab',
  'workflow', 'version', 'record', 'audit', 'transcript',
];

/** Minimum resolved string length to count as "substantive." */
export const MIN_SUBSTANTIVE_LENGTH = 30;

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a resolved actionContext string.
 *
 * REJECTS:
 *   - Empty/whitespace-only
 *   - Matches any BOILERPLATE_PATTERN
 *   - Length < MIN_SUBSTANTIVE_LENGTH
 *   - Contains no recognized action verb
 *   - Contains no recognized artifact noun
 *
 * The verb/noun lists are heuristic and intentionally surface-extensible.
 * False positives prefer review-surfacing over silent acceptance.
 */
export function validateActionContextCopy(resolved: string): ValidationResult {
  const trimmed = resolved.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty or whitespace-only actionContext' };
  }
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        reason: `actionContext matches boilerplate pattern ${pattern.source}: "${trimmed}"`,
      };
    }
  }
  if (trimmed.length < MIN_SUBSTANTIVE_LENGTH) {
    return {
      ok: false,
      reason: `actionContext too short (${trimmed.length} < ${MIN_SUBSTANTIVE_LENGTH}): "${trimmed}"`,
    };
  }
  const lower = trimmed.toLowerCase();
  const hasVerb = ACTION_VERBS.some((v) => lower.includes(v));
  if (!hasVerb) {
    return {
      ok: false,
      reason: `actionContext contains no recognized action verb: "${trimmed}"`,
    };
  }
  const hasNoun = ARTIFACT_NOUNS.some((n) => lower.includes(n));
  if (!hasNoun) {
    return {
      ok: false,
      reason: `actionContext contains no recognized artifact noun: "${trimmed}"`,
    };
  }
  return { ok: true };
}

// ============================================================================
// Astro file walker
// ============================================================================

/**
 * Recursively collect .astro files under a directory.
 * Skips directories whose names start with '_' (Astro-private convention,
 * e.g. `_kit/` holds template fixtures, not real surfaces).
 */
export async function walkAstroFiles(
  dir: string,
  options: { includeKit?: boolean } = {},
): Promise<string[]> {
  const { includeKit = false } = options;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!includeKit && entry.name.startsWith('_')) {
        continue; // skip Astro-private dirs (e.g. _kit/)
      }
      files.push(...(await walkAstroFiles(full, options)));
    } else if (entry.name.endsWith('.astro')) {
      files.push(full);
    }
  }
  return files.sort();
}

// ============================================================================
// Astro source extraction
// ============================================================================

interface FrontmatterBindings {
  /** Map from identifier name to its string-literal-bound value, if any. */
  readonly stringConsts: ReadonlyMap<string, string>;
  /** Whether `import { ... t } from '...'` brings in a translator function. */
  readonly hasTranslator: boolean;
  /** i18n EN keys table (populated when caller passes it for resolution). */
  readonly i18nKeys: ReadonlyMap<string, string>;
}

/**
 * Parse the Astro frontmatter (--- ... --- block at file top) and extract:
 *   - String-literal const bindings (`const foo = 'value';`)
 *   - Whether a t() function is imported
 *
 * This is intentionally constrained — we resolve simple direct-binding
 * cases. Complex expressions (function calls, conditionals, template
 * literals with interpolation) resolve as 'unresolved' and surface for
 * manual review.
 */
function parseFrontmatter(source: string, i18nKeys: ReadonlyMap<string, string>): FrontmatterBindings {
  const stringConsts = new Map<string, string>();
  const frontMatch = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!frontMatch) {
    return { stringConsts, hasTranslator: false, i18nKeys };
  }
  const front = frontMatch[1] ?? '';
  const hasTranslator = /\bt\s*:\s*[^,\n]*\s*\}\s*=\s*createTranslator/.test(front)
    || /import\s*\{[^}]*\bt\b[^}]*\}/.test(front);

  const constRe = /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]*)\2\s*;?/g;
  let match: RegExpExecArray | null;
  while ((match = constRe.exec(front)) !== null) {
    const name = match[1];
    const value = match[3];
    if (name && value !== undefined) {
      stringConsts.set(name, value);
    }
  }
  return { stringConsts, hasTranslator, i18nKeys };
}

/**
 * Load EN i18n keys from `src/i18n/en.ts` as a Map<key, value>.
 * Uses regex extraction (no module import) to avoid coupling test runtime
 * to the Astro+TS build. False negatives on multi-line entries are tolerated;
 * the walker reports those as 'unresolved'.
 */
export async function loadI18nKeysFromEnFile(enPath: string): Promise<Map<string, string>> {
  const src = await fs.readFile(enPath, 'utf8');
  const keys = new Map<string, string>();

  // Single-line: 'key.path': 'value', / "key.path": "value",
  const singleRe = /['"]([\w.]+)['"]\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(src)) !== null) {
    const key = m[1];
    const raw = m[3] ?? '';
    if (key) {
      keys.set(key, raw.replace(/\\(['"\\])/g, '$1'));
    }
  }

  // Multi-line shape from Phase 1C:
  //   'f_pv2.irreversibility.context':
  //     'Sending locks ...',
  const multiRe = /['"]([\w.]+)['"]\s*:\s*\n\s*(['"])((?:\\.|(?!\2).)*)\2\s*,?/g;
  while ((m = multiRe.exec(src)) !== null) {
    const key = m[1];
    const raw = m[3] ?? '';
    if (key && !keys.has(key)) {
      keys.set(key, raw.replace(/\\(['"\\])/g, '$1'));
    }
  }

  return keys;
}

// ============================================================================
// Wrap extraction + actionContext resolution
// ============================================================================

interface WrapElement {
  readonly file: string;
  readonly line: number;
  readonly openingTag: string;
}

/**
 * Find every <SurfaceIrreversibilityWrap ...> opening tag in a source file.
 * Handles both single-line and multi-line element openings.
 */
function findWrapElements(file: string, source: string): WrapElement[] {
  const elements: WrapElement[] = [];
  // Match opening tag — non-greedy up to first > (we don't care about
  // self-closing wraps; they wouldn't have a slot anyway)
  const re = /<SurfaceIrreversibilityWrap\b([\s\S]*?)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const openingTag = match[0];
    const before = source.slice(0, match.index);
    const line = before.split('\n').length;
    elements.push({ file, line, openingTag });
  }
  return elements;
}

/**
 * Check whether a wrap opening tag declares kind="irreversibility".
 */
function isIrreversibilityWrap(openingTag: string): boolean {
  return /\bkind\s*=\s*(["'])irreversibility\1/.test(openingTag)
    || /\bkind\s*=\s*\{\s*(["'])irreversibility\1\s*\}/.test(openingTag);
}

/**
 * Extract the raw actionContext expression from a wrap opening tag.
 * Returns the matched expression (everything after `actionContext=` up to
 * the next attribute or the closing `>`), or null if not present.
 */
function extractActionContextExpression(openingTag: string): string | null {
  // Try `actionContext={expr}` first (most common form)
  const braceMatch = openingTag.match(/\bactionContext\s*=\s*\{([\s\S]*?)\}(?=\s|>|\/)/);
  if (braceMatch) {
    return `{${(braceMatch[1] ?? '').trim()}}`;
  }
  // Try `actionContext="literal"` / `actionContext='literal'`
  const quoteMatch = openingTag.match(/\bactionContext\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/);
  if (quoteMatch) {
    return `${quoteMatch[1]}${quoteMatch[2]}${quoteMatch[1]}`;
  }
  return null;
}

/**
 * Resolve an actionContext expression to a concrete string when possible.
 *
 * Resolution shapes:
 *   "literal"                          → literal
 *   'literal'                          → literal
 *   {'literal'}                        → literal
 *   {"literal"}                        → literal
 *   {`literal-no-interp`}              → literal
 *   {t('key')}                         → i18nKeys.get('key')
 *   {t("key")}                         → i18nKeys.get('key')
 *   {identifier}                       → frontmatter.stringConsts.get(identifier)
 *   {}                                 → status='missing', empty
 *   {null}                             → status='missing', explicit null
 *   anything else                      → status='unresolved'
 */
function resolveExpression(
  expression: string,
  bindings: FrontmatterBindings,
): { status: 'resolved' | 'unresolved' | 'missing'; resolved?: string; reason?: string } {
  // Quoted literal at the call site (no braces)
  const directQuote = expression.match(/^(["'])((?:\\.|(?!\1).)*)\1$/);
  if (directQuote) {
    return { status: 'resolved', resolved: (directQuote[2] ?? '').replace(/\\(['"\\])/g, '$1') };
  }
  // Brace-wrapped expressions
  const braceContent = expression.match(/^\{([\s\S]*)\}$/);
  if (!braceContent) {
    return { status: 'unresolved', reason: `unrecognized expression shape: ${expression}` };
  }
  const inner = (braceContent[1] ?? '').trim();
  if (inner.length === 0) {
    return { status: 'missing', reason: 'empty braces · actionContext={}' };
  }
  if (inner === 'null' || inner === 'undefined') {
    return { status: 'missing', reason: `explicit ${inner}` };
  }
  // Quoted/template literal inside braces
  const quoted = inner.match(/^(["'`])((?:\\.|(?!\1).)*)\1$/);
  if (quoted) {
    return { status: 'resolved', resolved: (quoted[2] ?? '').replace(/\\(['"\\`])/g, '$1') };
  }
  // t('key') or t("key") call
  const tCall = inner.match(/^t\s*\(\s*(["'])([\w.]+)\1\s*\)$/);
  if (tCall) {
    const key = tCall[2] ?? '';
    const resolved = bindings.i18nKeys.get(key);
    if (resolved === undefined) {
      return { status: 'unresolved', reason: `i18n key not found in en.ts: ${key}` };
    }
    return { status: 'resolved', resolved };
  }
  // Plain identifier
  const ident = inner.match(/^([A-Za-z_$][\w$]*)$/);
  if (ident) {
    const name = ident[1] ?? '';
    const resolved = bindings.stringConsts.get(name);
    if (resolved === undefined) {
      return {
        status: 'unresolved',
        reason: `identifier ${name} could not be resolved to a string literal in frontmatter`,
      };
    }
    return { status: 'resolved', resolved };
  }
  return { status: 'unresolved', reason: `complex expression: ${inner}` };
}

/**
 * Walk a directory of .astro files, find every irreversibility wrap,
 * and resolve each actionContext to a concrete string when possible.
 */
export async function resolveActionContextsInDir(
  dir: string,
  options: { i18nKeys?: ReadonlyMap<string, string>; includeKit?: boolean } = {},
): Promise<ResolvedActionContext[]> {
  const { i18nKeys = new Map<string, string>(), includeKit = false } = options;
  const files = await walkAstroFiles(dir, { includeKit });
  const results: ResolvedActionContext[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const bindings = parseFrontmatter(source, i18nKeys);
    const wraps = findWrapElements(file, source);
    for (const wrap of wraps) {
      if (!isIrreversibilityWrap(wrap.openingTag)) {
        continue;
      }
      const expression = extractActionContextExpression(wrap.openingTag);
      if (expression === null) {
        results.push({
          file: wrap.file,
          line: wrap.line,
          expression: '<missing>',
          status: 'missing',
          reason: 'irreversibility wrap with no actionContext attribute',
        });
        continue;
      }
      const resolution = resolveExpression(expression, bindings);
      results.push({
        file: wrap.file,
        line: wrap.line,
        expression,
        status: resolution.status,
        resolved: resolution.resolved,
        reason: resolution.reason,
      });
    }
  }
  return results;
}
