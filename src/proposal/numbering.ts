/**
 * Proposal numbering helpers — GGR-YYYY-NNN format.
 *
 * Grounded in real GGR practice (Dunne proposal = GGR-2026-514). The
 * format is: <TENANT_PREFIX>-<YEAR>-<SEQUENCE> where:
 *   TENANT_PREFIX:  "GGR" or "V" (Valle) or "HPG" (Heat Pump Guys)
 *   YEAR:           4-digit calendar year
 *   SEQUENCE:       1-or-more-digit ordinal (counter resets each year)
 *
 * Numbering policy:
 *   - System auto-generates on draft creation
 *   - Operator CAN override the proposal_number on a draft (one plain-text
 *     field) — useful for migrating historical sequences or matching a
 *     QBO/external counter
 *   - Approved proposals (status === 'accepted') cannot rotate their
 *     proposal_number — validateProposal locks the number once accepted
 *
 * Counter durability:
 *   - This module is PURE. It does NOT read or write a counter file.
 *   - Callers pass `existing_numbers` (list of all proposal_number strings
 *     already in the system for this tenant+year) and `nextProposalNumber`
 *     computes the next available ordinal.
 *   - The persistence layer (PR #170 projection cache) is where the
 *     existing_numbers list lives; this module stays testable + side-effect-free.
 */

import type { ProposalTenantId } from './types.js';

const PROPOSAL_NUMBER_REGEX = /^([A-Z]{1,4})-(\d{4})-(\d+)$/;

/**
 * Tenant → number prefix mapping. Matches real GGR / Valle / HPG practice.
 * HPG = Heat Pump Guys (third internal tenant per Lane 0.7 · V1 launch).
 */
export const TENANT_NUMBER_PREFIX: Readonly<Record<ProposalTenantId, string>> = {
  tenant_ggr: 'GGR',
  tenant_valle: 'V',
  tenant_hpg: 'HPG',
  tenant_other: 'OTH',
};

/**
 * Parse a proposal number into its components. Returns null on malformed input.
 */
export function parseProposalNumber(num: string): { prefix: string; year: number; sequence: number } | null {
  const match = PROPOSAL_NUMBER_REGEX.exec(num);
  if (match === null) return null;
  const [, prefix, yearStr, seqStr] = match;
  const year = Number(yearStr);
  const sequence = Number(seqStr);
  if (!Number.isInteger(year) || !Number.isInteger(sequence)) return null;
  return { prefix: prefix!, year, sequence };
}

/**
 * Compute the next available proposal number for a tenant+year, given
 * the list of existing numbers in the system. Pure function.
 *
 * Returns "GGR-2026-001" formatted as 3-digit-padded ordinal when the
 * sequence is < 1000; "GGR-2026-1042" (unpadded) for higher sequences.
 * Real GGR practice uses 3-digit padding minimum (Dunne = GGR-2026-514).
 *
 * @param tenant - the tenant
 * @param year - 4-digit year for the new proposal
 * @param existingNumbers - all proposal_number values currently in use
 *                          (filter applied internally to tenant+year scope)
 */
export function nextProposalNumber(
  tenant: ProposalTenantId,
  year: number,
  existingNumbers: readonly string[],
): string {
  const prefix = TENANT_NUMBER_PREFIX[tenant];
  let maxSequence = 0;
  for (const num of existingNumbers) {
    const parsed = parseProposalNumber(num);
    if (parsed === null) continue;
    if (parsed.prefix === prefix && parsed.year === year && parsed.sequence > maxSequence) {
      maxSequence = parsed.sequence;
    }
  }
  const nextSeq = maxSequence + 1;
  const seqStr = nextSeq < 1000 ? String(nextSeq).padStart(3, '0') : String(nextSeq);
  return `${prefix}-${year}-${seqStr}`;
}

/**
 * Validate that a string is a syntactically well-formed proposal number.
 * Doesn't check tenant alignment or uniqueness — those are caller concerns.
 */
export function isWellFormedProposalNumber(num: unknown): num is string {
  return typeof num === 'string' && PROPOSAL_NUMBER_REGEX.test(num);
}
