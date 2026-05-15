// Phase 0 intake tagging — closed taxonomies for project type and scope.
//
// Per Thread 6 brief: variance-band computation depends on (project_type ×
// scope) dimensions to find historical comparables. Without these tags every
// variance lookup resolves to INSUFFICIENT_DATA forever, breaking the per-tenant
// labor productivity moat per D-039. This module ships the foundation; a
// later thread implements the variance-band lookup itself.
//
// Both unions are CLOSED for V1 — no `string` fallback, no `'other'` escape
// hatch. Taxonomy expansion is a Decision Log change, not a code change. If
// a real-world project doesn't cleanly fit the taxonomy, that's a signal to
// extend the taxonomy via canon, not to widen the type to `string`.
//
// Naming: snake_case field names (`project_type_tag`, `scope_tags`) match the
// blackboard/altitude entity convention (where `decision_authority`,
// `action_class`, `decision_altitude` already use snake_case). The fixture-
// level wrapper field (`tags` on SeedProject) follows the fixture file's own
// camelCase convention.

import { ValidationError } from '../shared/errors.js';

// ──────────────────────────────────────────────────────────────────────────
// ProjectTypeTag — what KIND of project this is, at the broadest cut.
// Required (single-valued) on every Project entity.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The closed list of project type tags. Listed in (rough) operator-frequency
 * order so drop-down UIs render the common cases first.
 *
 * Mapping rationale grounded in worked examples:
 *   - kitchen_remodel        → Clem Kitchen; the kitchen portion of M+G when
 *                              tagged separately.
 *   - primary_bath_remodel   → Coring Primary Bath; the bath-only portions of
 *                              Ault and Dunne when one room dominates the scope.
 *   - secondary_bath_remodel → guest/secondary bath scopes.
 *   - multi_room_remodel     → BOUNDED multi-room work (typically 2 rooms,
 *                              up to ~3-4 rooms but not whole-home). M+G
 *                              (kitchen + primary bath), Ault (primary bath
 *                              + bedroom), and Dunne (primary bath + bedroom
 *                              refresh) all live here. Distinct from
 *                              whole_home_remodel because variance bands need
 *                              to discriminate "kitchen-only $30K" from
 *                              "kitchen + primary bath $90K" — different
 *                              archetypes with different cost realities.
 *   - whole_home_remodel     → full-house gut covering most/all rooms.
 *   - addition               → square-footage addition.
 *   - adu                    → accessory dwelling unit (San Diego market common).
 *   - targeted_remodel       → bounded scope that doesn't fit a room-typed
 *                              category: flooring-only refresh, deck rebuild,
 *                              exterior repaint, single-system replacement,
 *                              etc. NOT a catch-all — if a project genuinely
 *                              doesn't fit any tag, that's a Decision Log
 *                              signal to extend the taxonomy.
 *   - cabinetry_only         → Valle scope: Moore Cabinet Run; cabinetry-only
 *                              projects executed without a paired remodel.
 *   - millwork_only          → Valle scope: trim/built-ins delivered as a
 *                              standalone scope, no cabinets.
 *   - vanity_only            → Valle e-commerce scope: a single-vanity sale
 *                              from the online vanity collection.
 *   - deck                   → deck rebuild / new deck — wood, composite, or
 *                              hybrid; distinct from whole-room remodels.
 *   - outdoor_kitchen        → built-in outdoor cooking + counter runs
 *                              (parallel scaffold brief).
 *   - patio_or_hardscape     → patios, walks, flatwork (reserved; scaffold TBD).
 */
export const PROJECT_TYPE_TAGS = [
  'kitchen_remodel',
  'primary_bath_remodel',
  'secondary_bath_remodel',
  'multi_room_remodel',
  'whole_home_remodel',
  'addition',
  'adu',
  'targeted_remodel',
  'cabinetry_only',
  'millwork_only',
  'vanity_only',
  'deck',
  'outdoor_kitchen',
  'patio_or_hardscape',
] as const;

export type ProjectTypeTag = (typeof PROJECT_TYPE_TAGS)[number];

const PROJECT_TYPE_TAG_SET: ReadonlySet<string> = new Set(PROJECT_TYPE_TAGS);

export function isProjectTypeTag(value: unknown): value is ProjectTypeTag {
  return typeof value === 'string' && PROJECT_TYPE_TAG_SET.has(value);
}

// ──────────────────────────────────────────────────────────────────────────
// ScopeTag — what TRADES/PHASES this project includes.
// Multi-valued on every Project entity (zero or more tags allowed).
// ──────────────────────────────────────────────────────────────────────────

/**
 * The closed list of scope tags. Listed in (rough) construction-sequence order
 * so the variance-band UI can render them in execution-time order when needed.
 *
 * Distinctions worth noting:
 *   - `plumbing` is rough plumbing (under-slab, in-wall).
 *     `plumbing_fixtures` is finish plumbing (faucets, fixtures install).
 *   - `electrical` is rough + panel work; `lighting` is finish (fixtures,
 *     dimmers, switches). The two split because they're often subbed to
 *     different crews and tracked separately on cost sheets.
 *   - `windows_doors` is its own scope: distinct supplier (e.g. WinDor on
 *     M+G), distinct install crew, distinct cost dynamics. Doesn't fold into
 *     framing (different trades) or exterior (interior doors are scope too).
 *   - `cabinetry` and `millwork` are both wood scopes but distinct:
 *     cabinetry = cabinets + countertops install; millwork = trim, built-ins,
 *     panels. Valle treats them as separate revenue streams.
 *   - `tile` covers floor + wall tile + grouting.
 *   - `flooring` covers non-tile floor (LVP, hardwood, carpet).
 *   - `paint` is interior + exterior paint as one category for V1; split if
 *     variance shows distinct labor patterns.
 */
export const SCOPE_TAGS = [
  'demolition',
  'framing',
  'windows_doors',
  'structural',
  'foundation',
  'plumbing',
  'electrical',
  'hvac',
  'drywall',
  'tile',
  'flooring',
  'cabinetry',
  'millwork',
  'countertops',
  'appliances',
  'plumbing_fixtures',
  'lighting',
  'paint',
  'exterior',
] as const;

export type ScopeTag = (typeof SCOPE_TAGS)[number];

const SCOPE_TAG_SET: ReadonlySet<string> = new Set(SCOPE_TAGS);

export function isScopeTag(value: unknown): value is ScopeTag {
  return typeof value === 'string' && SCOPE_TAG_SET.has(value);
}

// ──────────────────────────────────────────────────────────────────────────
// ProjectTags — the canonical pair carried on every Project entity.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The intake-tag pair that variance-band computation reads. Required on every
 * project entity. `scope_tags` may be empty at project creation time (scope
 * solidifies post-intake) but must always be present as an array.
 */
export interface ProjectTags {
  readonly project_type_tag: ProjectTypeTag;
  readonly scope_tags: readonly ScopeTag[];
}

/**
 * Validate a `ProjectTags` value. Throws ValidationError on:
 *   - `project_type_tag` not in PROJECT_TYPE_TAGS
 *   - `scope_tags` not an array
 *   - any scope_tags entry not in SCOPE_TAGS
 *   - duplicate scope_tags entries
 *
 * Empty scope_tags is ACCEPTED — that's the valid "scope not yet solidified"
 * state at project creation.
 */
export function validateProjectTags(tags: ProjectTags): void {
  if (!isProjectTypeTag(tags.project_type_tag)) {
    throw new ValidationError(
      `validateProjectTags: project_type_tag "${String(tags.project_type_tag)}" is not in the closed taxonomy. ` +
        `Valid values: ${PROJECT_TYPE_TAGS.join(', ')}.`,
    );
  }
  if (!Array.isArray(tags.scope_tags)) {
    throw new ValidationError(
      `validateProjectTags: scope_tags must be an array, got ${typeof tags.scope_tags}.`,
    );
  }
  const seen = new Set<string>();
  for (const tag of tags.scope_tags) {
    if (!isScopeTag(tag)) {
      throw new ValidationError(
        `validateProjectTags: scope_tags entry "${String(tag)}" is not in the closed taxonomy. ` +
          `Valid values: ${SCOPE_TAGS.join(', ')}.`,
      );
    }
    if (seen.has(tag)) {
      throw new ValidationError(
        `validateProjectTags: scope_tags contains duplicate "${tag}". ` +
          `Each scope tag may appear at most once.`,
      );
    }
    seen.add(tag);
  }
}
