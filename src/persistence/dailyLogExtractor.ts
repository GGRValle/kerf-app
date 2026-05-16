/**
 * V1.5 Field Daily — Daily Log Extracted Facts (Step B.2 substrate).
 *
 * This file ships in two stages:
 *   - B.1 (this commit): defines the `DailyLogExtractedFacts` type and
 *     ships `extractDailyLogFacts` as a stub returning empty-shape facts.
 *     Lets the Field Capture play in `fieldCapture.ts` be tested in
 *     isolation against a known-shape extractor.
 *   - B.2 (next commit): replaces the stub body with the real
 *     deterministic regex + classifier extractor. Locks against the
 *     Henderson golden fixture from `kerf_wireframes_mobile_v2.html`
 *     FRAME 7.
 *
 * ARCHITECTURE INVARIANTS:
 *   - Deterministic core; no LLM, no fetch, no external services
 *   - Pure function: same transcript + entry_kind → same facts
 *   - Returns the 9-field shape per Field Daily §3
 *   - Empty arrays for unknown categories; never null in array fields
 *   - `schedule_status` defaults to 'unknown' when not derivable
 *
 * SCOPE FOR B.1:
 *   - Type definition + empty-shape stub
 *   - Tests verify the stub returns the right shape for any input
 *
 * NOT IN B.1:
 *   - Regex tables (B.2)
 *   - Classifier logic (B.2)
 *   - Henderson golden fixture lock (B.2)
 *   - Coverage of entry_kinds other than progress_update (B.3+ as Field
 *     Daily Step C expands)
 */

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

/** Empty 9-field shape. Returned by the stub; used by callers as a
 *  starting point when no transcript is present (clock events,
 *  photo-only entries). */
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

/**
 * Extract the 9-field structured facts from a transcript.
 *
 * **B.1 STUB**: returns empty-shape facts for any input.
 * **B.2 REPLACES**: regex + classifier logic, locked against the Henderson
 * golden fixture.
 *
 * @param transcript - The Whisper transcript (or operator-typed note) text.
 *                     Empty string is valid (clock events, photo-only).
 * @param entryKind  - Discriminator from the captured event. The B.2 extractor
 *                     uses this to bias category emphasis (e.g., 'blocker'
 *                     entries weight blocked_work; 'safety_note' weights
 *                     safety_notes).
 */
export function extractDailyLogFacts(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transcript: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entryKind: string,
): DailyLogExtractedFacts {
  // STUB: B.2 replaces this with real extraction logic.
  // The stub returns empty-shape so the Field Capture play (B.1)
  // can be wired and tested without depending on the extractor's
  // real logic. Tests in B.1 verify the play's plumbing; tests in
  // B.2 verify the extraction itself.
  return EMPTY_EXTRACTED_FACTS;
}
