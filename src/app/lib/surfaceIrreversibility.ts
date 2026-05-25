export type SurfaceIrreversibilityKind = 'daily' | 'irreversibility';

export interface SurfaceIrreversibilitySpec {
  kind: SurfaceIrreversibilityKind;
  safetyLineBudget?: number;
  actionContext?: string | null;
}

const SAFETY_COPY_RE = /<p[^>]*class="[^"]*\bsafety-copy\b[^"]*"[^>]*>/gi;

export function countSafetyCopyBlocks(html: string): number {
  return (html.match(SAFETY_COPY_RE) ?? []).length;
}

export function extractSafetyCopyBodies(html: string): string[] {
  const bodies: string[] = [];
  const blockRe = /<p[^>]*class="[^"]*\bsafety-copy\b[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    bodies.push(match[1] ?? '');
  }
  return bodies;
}

export function validateDailySafetyBudget(
  html: string,
  budget: number,
): { ok: true } | { ok: false; reason: string } {
  const count = countSafetyCopyBlocks(html);
  if (count > budget) {
    return {
      ok: false,
      reason: `daily surface exceeds safetyLineBudget (${count} > ${budget})`,
    };
  }
  return { ok: true };
}

export function validateIrreversibilityActionContext(
  html: string,
  actionContext: string,
): { ok: true } | { ok: false; reason: string } {
  const bodies = extractSafetyCopyBodies(html);
  if (bodies.length === 0) {
    return { ok: true };
  }
  const needle = actionContext.trim();
  if (needle.length === 0) {
    return { ok: false, reason: 'irreversibility surface requires non-empty actionContext' };
  }
  for (const body of bodies) {
    if (!body.includes(needle)) {
      return {
        ok: false,
        reason: `safety-copy block missing actionContext reference: "${needle}"`,
      };
    }
  }
  return { ok: true };
}
