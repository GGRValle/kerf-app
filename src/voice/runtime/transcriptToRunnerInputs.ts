// Voice transcript → RunnerInputs adapter.
//
// Pure function that maps a transcribed voice memo into the typed
// `RunnerInputs` shape consumed by `runEstimate()`. Per Thread 3 brief:
//
//   "Extracts scope_tags from transcript using simple keyword matching
//   against the closed `ScopeTag` enum from PR #126 (no LLM, no semantic
//   extraction beyond the closed enum)."
//
// V1 SCOPE: keyword matching + canonical synonyms per closed enum. No
// LLM-assisted scope extraction — that's a V1.5 question (whether the
// keyword approach captures enough operator phrasing). The test suite
// records baseline accuracy on canonical operator phrasings.
//
// Operator notes are set to the FULL transcript so downstream surfaces
// (DecisionQueue, audit trail) carry the operator's exact words.

import type { EntityId, ISO8601 } from '../../blackboard/types.js';
import {
  isScopeTag,
  type ProjectTypeTag,
  type ScopeTag,
} from '../../projects/index.js';
import type { RunnerInputs } from '../../runner/index.js';

export interface TranscriptToRunnerInputsRequest {
  readonly transcript: string;
  readonly voiceTranscriptId: EntityId;
  readonly tenantId: EntityId;
  readonly projectArchetype: ProjectTypeTag;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
  readonly projectId?: EntityId;
}

/**
 * Synonym lookup per closed `ScopeTag` enum. Each list is checked as a
 * case-insensitive substring against the transcript. Order does not
 * matter — final scope_tags is deduplicated by Set semantics.
 *
 * Synonyms are intentionally tight — a tradesperson's natural phrasing
 * for V1 GGR/Valle scope. Add new synonyms only if observed-failure
 * cases drive expansion (canon-keeper question, not a code question).
 */
const SCOPE_KEYWORDS: Record<ScopeTag, readonly string[]> = {
  demolition: ['demo', 'demolition', 'tear out', 'tear-out', 'tear down', 'tear-down', 'gut'],
  framing: ['framing', 'frame ', 'studs', 'stud wall'],
  windows_doors: ['window', 'door', 'windor'],
  structural: ['structural', 'beam', 'load bearing', 'load-bearing', 'header', 'shear wall'],
  foundation: ['foundation', 'footing', 'slab'],
  plumbing: ['plumbing', 'rough plumbing', 'drain line', 'drain pipe', 'water line', 'supply line'],
  electrical: ['electrical', 'wiring', 'panel', 'outlet', 'circuit', 'sub panel', 'sub-panel'],
  hvac: ['hvac', 'heating', 'cooling', 'air conditioning', 'a/c', 'furnace', 'duct', 'mini split', 'mini-split'],
  drywall: ['drywall', 'sheetrock', 'gypsum', 'mud and tape'],
  tile: ['tile', 'tilework', 'tiling', 'subway tile', 'mosaic'],
  flooring: ['flooring', 'lvp', 'lvt', 'hardwood', 'carpet', 'vinyl plank', 'engineered floor'],
  cabinetry: ['cabinet', 'cabinets', 'cabinetry', 'reface'],
  millwork: ['millwork', 'trim', 'molding', 'crown', 'baseboard', 'built-in', 'built-ins', 'wainscot'],
  countertops: ['countertop', 'counters', 'quartz', 'granite', 'butcher block', 'soapstone'],
  appliances: ['appliance', 'stove', 'range', 'refrigerator', 'dishwasher', 'oven', 'cooktop', 'microwave'],
  plumbing_fixtures: ['faucet', 'fixture', 'toilet', 'shower head', 'shower-head', 'tub', 'vanity'],
  lighting: ['lighting', 'lights', 'recessed', 'pendant', 'sconce', 'chandelier', 'led'],
  paint: ['paint', 'painting', 'primer'],
  exterior: ['exterior', 'siding', 'roof', 'roofing', 'gutter', 'fascia'],
};

export interface ExtractedScopeTagsResult {
  readonly scopeTags: readonly ScopeTag[];
  /** Tags found in the transcript by direct enum-name match (no synonym aid). */
  readonly directMatches: readonly ScopeTag[];
  /** Tags found via synonym only (not the canonical name). Useful for audit. */
  readonly synonymMatches: readonly ScopeTag[];
}

/**
 * Pure scope extraction. Exposed separately from `transcriptToRunnerInputs`
 * so tests can assert exactly which tags were found.
 */
export function extractScopeTagsFromTranscript(transcript: string): ExtractedScopeTagsResult {
  const haystack = transcript.toLowerCase();
  const scopeTags = new Set<ScopeTag>();
  const directMatches = new Set<ScopeTag>();
  const synonymMatches = new Set<ScopeTag>();

  for (const tag of Object.keys(SCOPE_KEYWORDS) as ScopeTag[]) {
    if (!isScopeTag(tag)) continue; // type-system safety net
    const tagAsPhrase = tag.replace(/_/g, ' ');
    if (haystack.includes(tagAsPhrase) || haystack.includes(tag)) {
      scopeTags.add(tag);
      directMatches.add(tag);
      continue;
    }
    const synonyms = SCOPE_KEYWORDS[tag];
    for (const syn of synonyms) {
      if (haystack.includes(syn.toLowerCase())) {
        scopeTags.add(tag);
        synonymMatches.add(tag);
        break;
      }
    }
  }

  return {
    scopeTags: [...scopeTags],
    directMatches: [...directMatches],
    synonymMatches: [...synonymMatches],
  };
}

/**
 * Convert a transcribed voice memo into `RunnerInputs`. Caller supplies
 * tenant + archetype context (the runner needs them; voice doesn't pick
 * archetype today). Synthetic claim_ids in the runner are replaced
 * downstream by claim_ids derived from the voice_transcript_id; this
 * function only produces the Runner-level inputs.
 */
export function transcriptToRunnerInputs(
  request: TranscriptToRunnerInputsRequest,
): RunnerInputs {
  const { scopeTags } = extractScopeTagsFromTranscript(request.transcript);

  return {
    tenantId: request.tenantId,
    projectArchetype: request.projectArchetype,
    scopeTags,
    operatorNotes: request.transcript,
    voiceTranscriptId: request.voiceTranscriptId,
    invocationId: request.invocationId,
    requestedAt: request.requestedAt,
    ...(request.projectId !== undefined ? { projectId: request.projectId } : {}),
  };
}
