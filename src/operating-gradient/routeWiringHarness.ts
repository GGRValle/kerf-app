import { resolveBlendedPosture, resolveBlendRuleScore, resolveDogfoodTenantPosture } from './blend.js';
import {
  getConstructionOperatingGradientFixture,
  getReplayCase,
  listRouteWiringStressCases,
} from './fixture.js';
import type {
  ArchetypeMixEntry,
  BlendedOperatingPosture,
  DogfoodTenantId,
  ReplayCase,
  RouteWiringStressCase,
  SpineSurface,
} from './types.js';

export interface RouteWiringHarnessCaseResult {
  readonly stress_case: RouteWiringStressCase;
  readonly posture: BlendedOperatingPosture;
  readonly replay_cases: readonly ReplayCase[];
  readonly passes_min_scores: boolean;
}

export interface RouteWiringHarnessReport {
  readonly fixture_id: string;
  readonly surface_consumer_order: readonly string[];
  readonly cases: readonly RouteWiringHarnessCaseResult[];
  readonly all_pass: boolean;
}

function stressCasesForSurface(surface: SpineSurface): RouteWiringStressCase[] {
  return listRouteWiringStressCases().filter((stressCase) => {
    if (stressCase.spine_surface === surface) {
      return true;
    }
    if (surface === 'capture' || surface === 'review') {
      return stressCase.spine_surface === 'capture_review';
    }
    if (surface === 'home_density') {
      return stressCase.spine_surface === 'home';
    }
    return false;
  });
}

function evaluateStressCase(
  stressCase: RouteWiringStressCase,
  mix: readonly ArchetypeMixEntry[],
): RouteWiringHarnessCaseResult {
  const posture = resolveBlendedPosture(mix);
  const passesMinScores = Object.entries(stressCase.min_blend_scores).every(
    ([ruleId, minScore]) =>
      resolveBlendRuleScore(mix, ruleId as keyof typeof stressCase.min_blend_scores) >=
      (minScore ?? 0),
  );

  return {
    stress_case: stressCase,
    posture,
    replay_cases: stressCase.replay_case_ids.map((id) => getReplayCase(id)),
    passes_min_scores: passesMinScores,
  };
}

/** Run all fixture-defined route-wiring stress cases for a given archetype mix. */
export function runRouteWiringHarnessForMix(
  mix: readonly ArchetypeMixEntry[],
): RouteWiringHarnessReport {
  const fixture = getConstructionOperatingGradientFixture();
  const cases = listRouteWiringStressCases().map((stressCase) =>
    evaluateStressCase(stressCase, mix),
  );

  return {
    fixture_id: fixture.id,
    surface_consumer_order: fixture.surface_consumer_order.map((entry) => entry.surface),
    cases,
    all_pass: cases.every((result) => result.passes_min_scores),
  };
}

/** Run harness using each dogfood tenant's seeded archetype_mix. */
export function runRouteWiringHarnessForDogfoodTenants(): Record<
  DogfoodTenantId,
  RouteWiringHarnessReport
> {
  const fixture = getConstructionOperatingGradientFixture();
  const reports = {} as Record<DogfoodTenantId, RouteWiringHarnessReport>;

  for (const tenant of fixture.dogfood_tenants) {
    reports[tenant.tenant_id] = runRouteWiringHarnessForMix(tenant.archetype_mix);
  }

  return reports;
}

/** First consumer surface per fixture (capture_review). */
export function firstArchetypeConsumerSurface(): string {
  const ordered = getConstructionOperatingGradientFixture().surface_consumer_order;
  const first = ordered[0];
  if (!first) {
    throw new Error('surface_consumer_order is empty');
  }
  return first.surface;
}

/** Stress cases tagged for a spine surface — used by route-wiring lane tests. */
export function routeWiringStressCasesForSurface(
  surface: SpineSurface,
): readonly RouteWiringStressCase[] {
  return stressCasesForSurface(surface);
}

/** Posture snapshot for a dogfood tenant at a spine surface. */
export function dogfoodTenantSurfacePosture(
  tenantId: DogfoodTenantId,
  surface: SpineSurface,
): {
  readonly tenant_id: DogfoodTenantId;
  readonly surface: SpineSurface;
  readonly posture: BlendedOperatingPosture;
  readonly stress_cases: readonly RouteWiringStressCase[];
} {
  return {
    tenant_id: tenantId,
    surface,
    posture: resolveDogfoodTenantPosture(tenantId),
    stress_cases: stressCasesForSurface(surface),
  };
}
