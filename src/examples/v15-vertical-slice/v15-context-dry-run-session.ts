import type { Actor, EntityId, ISO8601, SourceRef } from '../../blackboard/index.js';
import type { DraftReviewLine, ScopeLine } from '../../demo/types.js';
import {
  fieldCaptureDryRunToVerticalSliceDemoFixture,
  verticalSliceFieldCaptureDemoFixture,
  VERTICAL_SLICE_FLOW_PACKET_ID,
  type VerticalSliceDryRunDemoFixture,
} from '../../demo/index.js';
import {
  dryRunFieldCaptureDecision,
  type FieldCaptureScopeLine,
  type FieldCaptureTranscriptSegment,
  type FieldCaptureInput,
} from '../../workflows/index.js';
import {
  readFieldCaptureHandoffFromSessionStorage,
  type FieldCaptureHandoffV1,
} from '../field-capture-mock.js';
import {
  deriveV15ClarificationQuestions,
  type V15ClarificationQuestion,
} from './v15-context-clarifications.js';

export const V15_CONTEXT_DRY_RUN_STORAGE_KEY = 'kerf_v15_context_dry_run_fixture_v1';

let activeContextFixture: VerticalSliceDryRunDemoFixture | null = null;

export function v15GetContextDryRunFixture(): VerticalSliceDryRunDemoFixture | null {
  if (activeContextFixture !== null) {
    return activeContextFixture;
  }
  const stored = readStoredContextFixture();
  if (stored !== null) {
    activeContextFixture = stored;
  }
  return activeContextFixture;
}

export function v15GetActiveVerticalSliceFixture(): VerticalSliceDryRunDemoFixture {
  return v15GetContextDryRunFixture() ?? verticalSliceFieldCaptureDemoFixture;
}

export function v15PersistContextDryRunFromHandoff(
  handoff: FieldCaptureHandoffV1,
): VerticalSliceDryRunDemoFixture | null {
  const contextText = contextTextFromHandoff(handoff);
  if (contextText.length === 0) {
    v15ClearContextDryRunFixture();
    return null;
  }
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff);
  activeContextFixture = fixture;
  writeStoredContextFixture(fixture);
  return fixture;
}

export function v15RefreshContextDryRunFromSession(
  clarificationAnswers: Readonly<Record<string, string>>,
): VerticalSliceDryRunDemoFixture | null {
  const handoff = readFieldCaptureHandoffFromSessionStorage();
  if (handoff === null) {
    return null;
  }
  const fixture = v15BuildContextDryRunFixtureFromHandoff(handoff, clarificationAnswers);
  activeContextFixture = fixture;
  writeStoredContextFixture(fixture);
  return fixture;
}

export function v15ClearContextDryRunFixture(): void {
  activeContextFixture = null;
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(V15_CONTEXT_DRY_RUN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function v15BuildContextDryRunFixtureFromHandoff(
  handoff: FieldCaptureHandoffV1,
  clarificationAnswers: Readonly<Record<string, string>> = {},
): VerticalSliceDryRunDemoFixture {
  const contextText = contextTextFromHandoff(handoff);
  const capturedAt = safeIso(handoff.created_at_iso);
  const captureId = `field_capture_context_${slug(handoff.project_id)}`;
  const evidenceId = `evidence_context_${slug(handoff.project_id)}`;
  const transcriptId = `transcript_context_${slug(handoff.project_id)}`;
  const transcriptRef: SourceRef = {
    kind: 'transcript',
    uri: `kerf://local-demo/${handoff.project_id}/transcripts/context-note`,
    excerpt: excerpt(contextText),
  };
  const photoRefs = handoff.photos.map((photo, index): SourceRef => ({
    kind: 'photo',
    uri: `kerf://local-demo/${handoff.project_id}/photos/${photo.id}`,
    excerpt: photo.tags.length > 0
      ? `${photo.label} · tags: ${photo.tags.join(', ')}`
      : photo.label,
  }));
  const sourceRefs = [transcriptRef, ...photoRefs];
  const segments = transcriptSegmentsFor(transcriptId, contextText, transcriptRef);
  const scopeLines = scopeLinesForContext(captureId, segments, transcriptRef, photoRefs);
  const actor: Actor = {
    id: 'browser_operator' as EntityId,
    role: 'owner',
  };
  const input: FieldCaptureInput = {
    capture_id: captureId as EntityId,
    tenant_id: 'tenant_ggr' as EntityId,
    project_id: handoff.project_id as EntityId,
    evidence_id: evidenceId as EntityId,
    transcript_id: transcriptId as EntityId,
    transcript_original: contextText,
    transcript_segments: segments,
    transcript_language: languageFor(contextText),
    transcript_confidence: 0.76,
    scope_lines: scopeLines,
    captured_at: capturedAt,
    captured_by: actor,
    capture_surface: 'standard_ui',
    jurisdiction: handoff.location,
    transcript_uri: transcriptRef.uri,
    source_refs: sourceRefs,
    review_focus: `${handoff.workflow.replace(/_/g, ' ')} context for ${handoff.project_name}`,
  };
  const dryRun = dryRunFieldCaptureDecision(input, {
    evaluated_at: capturedAt,
    packet_id: VERTICAL_SLICE_FLOW_PACKET_ID,
    gate_run_id: `gate_context_${slug(handoff.project_id)}`,
    model_suggested_altitude: 'L1',
  });

  const fixture = fieldCaptureDryRunToVerticalSliceDemoFixture(dryRun, {
    project_name: handoff.project_name,
    client_name: handoff.client_name,
    title: `${handoff.project_name} - field context review`,
    model_metadata: {
      model_route: 'local_dev',
      model_family: 'audit_redacted',
      model_provider: 'audit_redacted',
    },
  });

  return annotateFixtureWithClarifications(fixture, clarificationAnswers);
}

function readStoredContextFixture(): VerticalSliceDryRunDemoFixture | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(V15_CONTEXT_DRY_RUN_STORAGE_KEY);
    if (raw === null || raw.trim().length === 0) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isVerticalSliceDryRunDemoFixture(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredContextFixture(fixture: VerticalSliceDryRunDemoFixture): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(V15_CONTEXT_DRY_RUN_STORAGE_KEY, JSON.stringify(fixture));
  } catch {
    /* ignore */
  }
}

function isVerticalSliceDryRunDemoFixture(value: unknown): value is VerticalSliceDryRunDemoFixture {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const decision = record['decision_packet'];
  const raw = record['decision_packet_raw'];
  return record['workflow'] === 'field_capture' &&
    typeof decision === 'object' &&
    decision !== null &&
    typeof (decision as Record<string, unknown>)['id'] === 'string' &&
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as Record<string, unknown>)['packet_id'] === 'string';
}

function contextTextFromHandoff(handoff: FieldCaptureHandoffV1): string {
  const parts = [handoff.text_note.trim(), handoff.manual_transcript.trim()].filter((part) => part.length > 0);
  return parts.join('\n\n[Pasted transcript]\n').trim();
}

function transcriptSegmentsFor(
  transcriptId: EntityId,
  contextText: string,
  sourceRef: SourceRef,
): FieldCaptureTranscriptSegment[] {
  return sentenceChunks(contextText).map((text, index) => ({
    segment_id: `${transcriptId}:segment_${String(index + 1).padStart(3, '0')}`,
    transcript_id: transcriptId,
    text,
    start_ms: index * 4_000,
    end_ms: index * 4_000 + Math.max(1_000, text.length * 30),
    speaker_label: 'Operator',
    source_ref: sourceRef,
  }));
}

function scopeLinesForContext(
  captureId: string,
  segments: readonly FieldCaptureTranscriptSegment[],
  transcriptRef: SourceRef,
  photoRefs: readonly SourceRef[],
): FieldCaptureScopeLine[] {
  const refs = photoRefs.length > 0 ? [transcriptRef, photoRefs[0]!] : [transcriptRef];
  const lines = segments
    .map((segment, index): FieldCaptureScopeLine | null => {
      const description = cleanDescription(segment.text);
      if (description.length < 12) {
        return null;
      }
      return {
        line_id: `${captureId}:scope_${String(index + 1).padStart(3, '0')}` as EntityId,
        description,
        area: areaFor(segment.text),
        trade: tradeFor(segment.text),
        ...quantityFor(segment.text),
        source_segment_ids: [segment.segment_id],
        source_refs: refs,
      };
    })
    .filter((line): line is FieldCaptureScopeLine => line !== null)
    .slice(0, 8);

  if (lines.length > 0) {
    return lines;
  }

  return [{
    line_id: `${captureId}:scope_001` as EntityId,
    description: 'Review captured field context and identify scope, missing information, and next action.',
    trade: 'field_capture',
    source_segment_ids: segments.map((segment) => segment.segment_id),
    source_refs: refs,
  }];
}

function sentenceChunks(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const matches = normalized.match(/[^.!?\n]+[.!?]?/g);
  const chunks = (matches ?? [normalized]).map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  return chunks.length > 0 ? chunks.slice(0, 10) : [normalized];
}

function cleanDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trimEnd()}...` : trimmed;
}

function tradeFor(value: string): string {
  const text = value.toLowerCase();
  if (hasAny(text, ['outlet', 'switch', 'wire', 'panel', 'circuit', 'light', 'recessed'])) return 'electrical';
  if (hasAny(text, ['cabinet', 'pantry', 'shelf', 'shelves'])) return 'cabinetry';
  if (hasAny(text, ['trim', 'baseboard', 'crown', 'built-in', 'millwork'])) return 'millwork';
  if (hasAny(text, ['counter', 'quartz', 'stone', 'granite'])) return 'countertops';
  if (hasAny(text, ['tile', 'backsplash', 'grout'])) return 'tile';
  if (hasAny(text, ['faucet', 'sink', 'toilet', 'shower', 'drain', 'water line', 'p-trap'])) return 'plumbing';
  if (hasAny(text, ['drywall', 'sheetrock', 'patch', 'texture'])) return 'drywall';
  if (hasAny(text, ['paint', 'primer'])) return 'paint';
  if (hasAny(text, ['floor', 'lvp', 'hardwood'])) return 'flooring';
  if (hasAny(text, ['door', 'window'])) return 'windows_doors';
  return 'field_capture';
}

function areaFor(value: string): string | undefined {
  const text = value.toLowerCase();
  for (const area of ['kitchen', 'pantry', 'bath', 'bathroom', 'primary bath', 'bedroom', 'laundry', 'garage', 'dining', 'living room']) {
    if (text.includes(area)) {
      return area;
    }
  }
  return undefined;
}

function quantityFor(value: string): { quantity?: number; unit?: string } {
  const match = /\b(\d+(?:\.\d+)?)\s*(linear feet|lineal feet|lf|sq ft|sf|square feet|feet|ft|inches|inch|in|outlets?|lights?|doors?|windows?|shelves|shelf|each|ea)\b/i.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return {};
  }
  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity)) {
    return {};
  }
  return {
    quantity,
    unit: unitFor(match[2]),
  };
}

function unitFor(raw: string): string {
  const unit = raw.toLowerCase();
  if (unit === 'linear feet' || unit === 'lineal feet' || unit === 'lf') return 'lf';
  if (unit === 'sq ft' || unit === 'sf' || unit === 'square feet') return 'sq ft';
  if (unit === 'feet' || unit === 'ft') return 'ft';
  if (unit === 'inches' || unit === 'inch' || unit === 'in') return 'in';
  if (unit.startsWith('outlet')) return 'outlet';
  if (unit.startsWith('light')) return 'light';
  if (unit.startsWith('door')) return 'door';
  if (unit.startsWith('window')) return 'window';
  if (unit === 'shelf' || unit === 'shelves') return 'shelf';
  return 'ea';
}

function languageFor(value: string): 'en' | 'es' {
  const text = value.toLowerCase();
  return hasAny(text, ['baño', 'cocina', 'gabinete', 'azulejo', 'puerta', 'ventana']) ? 'es' : 'en';
}

function hasAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function excerpt(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}...`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function safeIso(value: string): ISO8601 {
  const t = Date.parse(value);
  return (Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString()) as ISO8601;
}

function annotateFixtureWithClarifications(
  fixture: VerticalSliceDryRunDemoFixture,
  clarificationAnswers: Readonly<Record<string, string>>,
): VerticalSliceDryRunDemoFixture {
  const questions = deriveV15ClarificationQuestions(fixture);
  if (questions.length === 0) {
    return fixture;
  }

  const questionMap = new Map<string, readonly V15ClarificationQuestion[]>();
  for (const question of questions) {
    if (question.target_line_id === undefined) {
      continue;
    }
    const current = questionMap.get(question.target_line_id) ?? [];
    questionMap.set(question.target_line_id, [...current, question]);
  }

  const scopeLines = fixture.field_capture_payload.scope_lines.map((line) =>
    annotateScopeLine(line, questionMap.get(line.id) ?? [], clarificationAnswers)
  );
  const lineIndex = new Map(scopeLines.map((line) => [line.id, line]));
  const draftLines = fixture.draft_review_payload_ui.draft_lines.map((line) =>
    annotateDraftLine(line, lineIndex.get(line.scope_line_id), questionMap.get(line.scope_line_id) ?? [], clarificationAnswers)
  );
  const summary = clarificationSummary(questions, clarificationAnswers);

  return {
    ...fixture,
    field_capture_payload: {
      ...fixture.field_capture_payload,
      scope_lines: scopeLines,
    },
    draft_review_payload_ui: {
      ...fixture.draft_review_payload_ui,
      scope_lines: scopeLines,
      draft_lines: draftLines,
    },
    blackboard_write_preview: {
      ...fixture.blackboard_write_preview,
      summary,
      proposed_markdown: appendClarificationMarkdown(
        fixture.blackboard_write_preview.proposed_markdown,
        questions,
        clarificationAnswers,
      ),
    },
  };
}

function annotateScopeLine(
  line: ScopeLine,
  questions: readonly V15ClarificationQuestion[],
  clarificationAnswers: Readonly<Record<string, string>>,
): ScopeLine {
  let quantity = line.quantity;
  let unit = line.unit;
  const missing = new Set(line.missing_info ?? []);
  const assumptions = new Set(line.assumptions ?? []);

  for (const question of questions) {
    const answer = clarificationAnswers[question.id]?.trim() ?? '';
    const flag = missingFlagForQuestion(question);
    const parsedQuantity = question.kind === 'quantity' ? parseClarifiedQuantity(answer) : null;

    if (question.kind === 'quantity') {
      quantity = undefined;
      unit = undefined;
    }

    if (answer.length === 0) {
      missing.add(flag);
      continue;
    }

    assumptions.add(`Operator clarification: ${answer}`);
    if (question.kind === 'quantity') {
      if (parsedQuantity !== null) {
        missing.delete(flag);
        quantity = parsedQuantity.quantity;
        unit = parsedQuantity.unit;
        assumptions.add(`Quantity clarified by operator: ${parsedQuantity.quantity} ${parsedQuantity.unit}`);
      } else {
        missing.add(flag);
      }
      continue;
    }
    missing.delete(flag);
  }

  return {
    ...line,
    ...(quantity !== undefined ? { quantity } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(quantity === undefined ? {} : {}),
    missing_info: [...missing],
    assumptions: [...assumptions],
  };
}

function annotateDraftLine(
  line: DraftReviewLine,
  scopeLine: ScopeLine | undefined,
  questions: readonly V15ClarificationQuestion[],
  clarificationAnswers: Readonly<Record<string, string>>,
): DraftReviewLine {
  const assumptionFlags = new Set(line.assumption_flags);
  const missingFlags = new Set(scopeLine?.missing_info ?? line.missing_info_flags);
  let sourceBasis = line.source_basis;
  let quantity = scopeLine?.quantity ?? line.quantity;
  let unit = scopeLine?.unit ?? line.unit;

  for (const question of questions) {
    const answer = clarificationAnswers[question.id]?.trim() ?? '';
    if (answer.length === 0) {
      missingFlags.add(missingFlagForQuestion(question));
      continue;
    }
    assumptionFlags.add('operator_clarified');
    sourceBasis = 'Field capture transcript plus operator clarification; no pricing authority assigned in dry run.';
    if (question.kind === 'quantity') {
      const parsed = parseClarifiedQuantity(answer);
      if (parsed !== null) {
        missingFlags.delete(missingFlagForQuestion(question));
        quantity = parsed.quantity;
        unit = parsed.unit;
      } else {
        missingFlags.add(missingFlagForQuestion(question));
      }
      continue;
    }
    missingFlags.delete(missingFlagForQuestion(question));
  }

  return {
    ...line,
    quantity,
    unit,
    source_basis: sourceBasis,
    assumption_flags: [...assumptionFlags],
    missing_info_flags: [...missingFlags],
  };
}

function missingFlagForQuestion(question: V15ClarificationQuestion): string {
  switch (question.kind) {
    case 'quantity':
      return 'Quantity requires operator review';
    case 'scope':
      return 'Scope inclusion requires operator review';
    case 'allowance':
      return 'Allowance detail requires operator review';
    case 'verification':
      return 'Operator assumption required before draft';
  }
}

function parseClarifiedQuantity(
  answer: string,
): { quantity: number; unit: string } | null {
  if (answer.trim().length === 0) {
    return null;
  }
  const match = /\b(\d+(?:\.\d+)?)\s*(linear feet|lineal feet|lf|sq ft|sf|square feet|feet|ft|inches|inch|in|outlets?|lights?|doors?|windows?|shelves|shelf|each|ea)?\b/i.exec(answer);
  if (match === null || match[1] === undefined) {
    return null;
  }
  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity)) {
    return null;
  }
  const unit = match[2] !== undefined ? unitFor(match[2]) : inferClarifiedUnit(answer);
  return { quantity, unit };
}

function inferClarifiedUnit(answer: string): string {
  const lower = answer.toLowerCase();
  if (lower.includes('shelf')) return 'shelf';
  if (lower.includes('outlet')) return 'outlet';
  if (lower.includes('light')) return 'light';
  if (lower.includes('door')) return 'door';
  if (lower.includes('window')) return 'window';
  return 'ea';
}

function clarificationSummary(
  questions: readonly V15ClarificationQuestion[],
  clarificationAnswers: Readonly<Record<string, string>>,
): string {
  const answered = questions.filter((question) => (clarificationAnswers[question.id]?.trim().length ?? 0) > 0).length;
  const pending = questions.length - answered;
  if (questions.length === 0) {
    return 'No clarification questions surfaced from this field capture.';
  }
  if (answered === 0) {
    return `${pending} clarification question${pending === 1 ? '' : 's'} still open; dry run proceeds with flagged assumptions.`;
  }
  return `${answered} clarification answer${answered === 1 ? '' : 's'} recorded; ${pending} still open for review.`;
}

function appendClarificationMarkdown(
  base: string,
  questions: readonly V15ClarificationQuestion[],
  clarificationAnswers: Readonly<Record<string, string>>,
): string {
  if (questions.length === 0) {
    return base;
  }
  const lines = questions.map((question) => {
    const answer = clarificationAnswers[question.id]?.trim();
    if (answer !== undefined && answer.length > 0) {
      return `- Answered: ${question.prompt} -> ${answer}`;
    }
    return `- Pending: ${question.prompt}`;
  });
  return `${base.trimEnd()}\n\n## Clarification review\n${lines.join('\n')}\n`;
}
