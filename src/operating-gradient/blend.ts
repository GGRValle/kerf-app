import { getArchetypeDefinition, getConstructionOperatingGradientFixture, getDogfoodTenantMapping } from './fixture.js';
import type {
  ArchetypeAxes,
  ArchetypeMixEntry,
  BlendRuleId,
  BlendedOperatingPosture,
  DogfoodTenantId,
  OperatingAxis,
} from './types.js';

function normalizeMix(mix: readonly ArchetypeMixEntry[]): ArchetypeMixEntry[] {
  const weightSum = mix.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightSum <= 0) {
    throw new Error('archetype_mix weights must sum to a positive number');
  }
  return mix.map((entry) => ({
    archetype_id: entry.archetype_id,
    weight: entry.weight / weightSum,
  }));
}

function blendAxisScores(
  mix: readonly ArchetypeMixEntry[],
  axis: OperatingAxis,
): number {
  let weighted = 0;
  for (const entry of mix) {
    weighted += entry.weight * getArchetypeDefinition(entry.archetype_id).axes[axis];
  }
  return roundScore(weighted);
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

/** Resolve per-axis scores from a weighted archetype mix. */
export function blendArchetypeAxes(mix: readonly ArchetypeMixEntry[]): ArchetypeAxes {
  const normalized = normalizeMix(mix);
  const fixture = getConstructionOperatingGradientFixture();
  const axes = {} as ArchetypeAxes;
  for (const axis of fixture.axes) {
    axes[axis] = blendAxisScores(normalized, axis);
  }
  return axes;
}

function axisScoreForMix(
  mix: readonly ArchetypeMixEntry[],
  axis: OperatingAxis,
  rule: 'max' | 'weighted_average',
): number {
  if (rule === 'max') {
    return Math.max(
      ...mix.map((entry) => getArchetypeDefinition(entry.archetype_id).axes[axis]),
    );
  }
  return blendAxisScores(mix, axis);
}

/** Apply a named blend rule (max or weighted_average) to a mix. */
export function resolveBlendRuleScore(
  mix: readonly ArchetypeMixEntry[],
  ruleId: BlendRuleId,
): number {
  const normalized = normalizeMix(mix);
  const rule = getConstructionOperatingGradientFixture().blend_rules[ruleId];
  const axisScores = rule.axes.map((axis) =>
    axisScoreForMix(normalized, axis, rule.rule),
  );

  if (rule.rule === 'max') {
    return Math.max(...axisScores);
  }

  return roundScore(axisScores.reduce((sum, score) => sum + score, 0) / axisScores.length);
}

/** Full blended posture for onboarding defaults and route-wiring tests. */
export function resolveBlendedPosture(
  mix: readonly ArchetypeMixEntry[],
): BlendedOperatingPosture {
  const normalized = normalizeMix(mix);
  const fixture = getConstructionOperatingGradientFixture();
  const blendScores = {} as Record<BlendRuleId, number>;

  for (const ruleId of Object.keys(fixture.blend_rules) as BlendRuleId[]) {
    blendScores[ruleId] = resolveBlendRuleScore(normalized, ruleId);
  }

  const primary = [...normalized].sort((a, b) => b.weight - a.weight)[0];
  if (!primary) {
    throw new Error('archetype_mix must contain at least one entry');
  }

  return {
    mix: normalized,
    axes: blendArchetypeAxes(normalized),
    blend_scores: blendScores,
    primary_archetype: primary.archetype_id,
  };
}

/** Dogfood tenant shortcut — seeds TenantMemoryProfile.archetype_mix for V1. */
export function resolveDogfoodTenantPosture(
  tenantId: DogfoodTenantId,
): BlendedOperatingPosture {
  const tenant = getDogfoodTenantMapping(tenantId);
  return resolveBlendedPosture(tenant.archetype_mix);
}

/** Whether a surface should use compression defaults (3 vs 50+ active items). */
export function shouldUseDenseListDefaults(posture: BlendedOperatingPosture): boolean {
  return posture.blend_scores.ui_density_compression >= 5;
}

/** Whether capture/review should emphasize ambiguity confirmation. */
export function shouldEmphasizeCaptureReviewConfirmation(
  posture: BlendedOperatingPosture,
): boolean {
  return posture.blend_scores.field_capture_posture >= 4;
}
