// Surface-Grammar parity analyzer (Goal 0 enforcement, powers the Goal 1/2 gate).
//
// Deterministic, source-level: given a surface's .astro source, extract the
// canon-grammar signals and report conformance violations. This is the mechanical
// half of "matches the prototype" — it gates the GRAMMAR (canon tokens + kg-*
// primitives, no parallels, red-as-chip, singleton chrome). The pixel/flow parity
// on the deployed phone stays the conductor's gate; this stops the drift classes
// from ever reaching that gate.
//
// Reusable: import { canonViolations } and run it on one file (a Cursor lane can
// self-check before PR) or over the whole tree (the suite does this).

/** A surface adopts the canon layer by putting this on its root. */
export const CANON_OPT_IN = 'data-grammar="canon"';

/**
 * App tokens the canon layer SUPERSEDES (SURFACE_GRAMMAR.md §1). A canon surface
 * that uses these in its own <style> is running a parallel palette — the exact
 * drift ("the look never matched") Goal 0 exists to kill.
 */
export const SUPERSEDED_TOKENS: readonly string[] = [
  '--right-hand', '--kerf-amber', // → --gold
  '--kerf-bg', '--kerf-bg-2', // → --bg
  '--kerf-surface', '--kerf-surface-2', // → --panel
  '--kerf-text', '--kerf-text-dim', '--kerf-text-mute', '--kerf-muted', // → --ink / --muted
  '--kerf-border', '--kerf-border-soft', '--kerf-line', // → --line
  '--kerf-blue', // → --blue
  '--field-green', // → --green
  '--kerf-red', // → --red
];

/** Raw palette hex that should be a canon token (app dark palette + canon accents). */
export const PALETTE_HEX: readonly string[] = [
  '#c9a961', '#0a0d11', '#14181f', '#1a1f28', '#232936', '#2a3140', '#1f2530',
  '#e8ecf1', '#98a1b3', '#6a7282', '#f5b544', '#38c977', '#4ade80', '#f87171',
  '#e7aa3b', '#2f6df0', '#22784a', '#b73838', '#aa6719', // canon accents — still tokens, never raw
];

/** The canon grammar primitives (surface-grammar.css). */
export const KG_PRIMITIVES: readonly string[] = [
  'kg-card', 'kg-chip', 'kg-routechip', 'kg-grid', 'kg-span', 'kg-pagehead', 'kg-passdot', 'kg-warndot',
];

export interface SurfaceGrammarReport {
  readonly optsCanon: boolean;
  readonly kgPrimitives: readonly string[];
  readonly parallelPaletteTokens: readonly string[];
  readonly parallelPaletteHex: readonly string[];
  readonly parallelGrid: boolean;
  readonly redRail: boolean;
  readonly debugCard: boolean;
  readonly hasSurfaceContext: boolean;
  readonly bottomBarCount: number;
  readonly bubbleCount: number;
}

/** The component's own <style> blocks — where a parallel palette/grid would live. */
function styleBlocks(source: string): string {
  return (source.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? []).join('\n');
}

export function analyzeSurfaceGrammar(source: string): SurfaceGrammarReport {
  const style = styleBlocks(source).toLowerCase();
  return {
    optsCanon: source.includes(CANON_OPT_IN),
    kgPrimitives: KG_PRIMITIVES.filter((p) => source.includes(p)),
    parallelPaletteTokens: SUPERSEDED_TOKENS.filter((t) => style.includes(t)),
    parallelPaletteHex: PALETTE_HEX.filter((h) => style.includes(h)),
    // A canon surface lays out with kg-grid/kg-span — never a bespoke multi-column
    // layout grid in its own style. (Small kv grids like `max-content 1fr` are fine;
    // the `repeat(...)` signature is the parallel-layout-grid tell.)
    parallelGrid: /grid-template-columns\s*:\s*repeat\(/.test(style),
    // The red row-rail antipattern: a red LEFT/inline-start border on a row. Red
    // status must be a chip/dot (kg-chip.red / kg-passdot / kg-warndot), never a
    // rail. Scoped to left/inline-start so a legit full red border isn't flagged.
    redRail: /border-(?:left|inline-start)(?:-color)?\s*:[^;{}]*(?:--red|#b73838|#f87171|\bred\b)/.test(style),
    // No visible debug / canon-contract card may ship on an operator surface.
    debugCard: /data-debug\b|kg-debug\b|class="[^"]*debug-card|canon contract|grammar debug/i.test(source),
    // The Phase-1 SurfaceContext tag must be kept (page surfaces).
    hasSurfaceContext: /surfaceContext=\{\{/.test(source)
      || /__KERF_SURFACE_CONTEXT__|kerf-surface-context/.test(source),
    bottomBarCount: (source.match(/<MobileBottomNav\b/g) ?? []).length,
    bubbleCount: (source.match(/<RightHandBubble\b/g) ?? []).length,
  };
}

export interface CanonContract {
  /** kg-* primitives this surface must use (e.g. ['kg-grid','kg-card']). */
  readonly requiredPrimitives?: readonly string[];
  /** Page surfaces must keep emitting their SurfaceContext tag. */
  readonly requireSurfaceContext?: boolean;
}

/**
 * The gate. Returns the list of canon-conformance violations for a surface; an
 * empty list = PASS. A surface that has NOT opted into canon returns the single
 * "not opted in" note — callers decide whether that's expected (untouched surface)
 * or a failure (a surface that was supposed to be rebuilt).
 */
export function canonViolations(source: string, contract: CanonContract = {}): string[] {
  const r = analyzeSurfaceGrammar(source);
  if (!r.optsCanon) return ['does not opt into [data-grammar="canon"]'];
  const v: string[] = [];
  for (const t of r.parallelPaletteTokens) v.push(`parallel palette: superseded token ${t} in <style> (use the canon token)`);
  for (const h of r.parallelPaletteHex) v.push(`parallel palette: raw hex ${h} in <style> (use a canon token)`);
  if (r.parallelGrid) v.push('parallel grid: grid-template-columns in <style> (use kg-grid / kg-span-N)');
  if (r.redRail) v.push('red row-rail: red border-left/inline-start (use kg-chip.red / kg-passdot / kg-warndot)');
  if (r.debugCard) v.push('visible debug / canon-contract card on an operator surface');
  if (r.bottomBarCount > 1) v.push(`bottom bar not singleton (${r.bottomBarCount}× MobileBottomNav)`);
  if (r.bubbleCount > 1) v.push(`Right Hand bubble not singleton (${r.bubbleCount}× RightHandBubble)`);
  for (const p of contract.requiredPrimitives ?? []) {
    if (!source.includes(p)) v.push(`missing required grammar primitive: ${p}`);
  }
  if (contract.requireSurfaceContext && !r.hasSurfaceContext) v.push('missing SurfaceContext tag');
  return v;
}
