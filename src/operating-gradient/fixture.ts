import rawFixture from './construction-operating-gradient.v1.json' with { type: 'json' };
import type {
  ArchetypeDefinition,
  ArchetypeId,
  ConstructionOperatingGradientFixture,
  DogfoodTenantId,
  DogfoodTenantMapping,
  OperatingAxis,
  ReplayCase,
  RouteWiringStressCase,
} from './types.js';

const fixture = rawFixture as ConstructionOperatingGradientFixture;

const archetypeById = new Map<ArchetypeId, ArchetypeDefinition>(
  fixture.archetypes.map((archetype) => [archetype.id, archetype]),
);

const dogfoodTenantById = new Map<DogfoodTenantId, DogfoodTenantMapping>(
  fixture.dogfood_tenants.map((tenant) => [tenant.tenant_id, tenant]),
);

const replayCaseById = new Map<string, ReplayCase>(
  fixture.replay_cases.map((replayCase) => [replayCase.id, replayCase]),
);

/** Canonical V1 construction operating gradient fixture (research prior, not doctrine). */
export function getConstructionOperatingGradientFixture(): ConstructionOperatingGradientFixture {
  return fixture;
}

export function getArchetypeDefinition(archetypeId: ArchetypeId): ArchetypeDefinition {
  const archetype = archetypeById.get(archetypeId);
  if (!archetype) {
    throw new Error(`Unknown archetype_id "${archetypeId}"`);
  }
  return archetype;
}

export function getDogfoodTenantMapping(tenantId: DogfoodTenantId): DogfoodTenantMapping {
  const tenant = dogfoodTenantById.get(tenantId);
  if (!tenant) {
    throw new Error(`Unknown dogfood tenant_id "${tenantId}"`);
  }
  return tenant;
}

export function getReplayCase(replayCaseId: string): ReplayCase {
  const replayCase = replayCaseById.get(replayCaseId);
  if (!replayCase) {
    throw new Error(`Unknown replay_case id "${replayCaseId}"`);
  }
  return replayCase;
}

export function listReplayCases(): readonly ReplayCase[] {
  return fixture.replay_cases;
}

export function listRouteWiringStressCases(): readonly RouteWiringStressCase[] {
  return fixture.route_wiring_stress_cases;
}

export function listOperatingAxes(): readonly OperatingAxis[] {
  return fixture.axes;
}

export function assertFixtureIntegrity(): void {
  if (fixture.axes.length !== 12) {
    throw new Error(`Expected 12 operating axes, got ${fixture.axes.length}`);
  }

  for (const archetype of fixture.archetypes) {
    for (const axis of fixture.axes) {
      const score = archetype.axes[axis];
      if (score < fixture.scale.min || score > fixture.scale.max) {
        throw new Error(
          `Archetype "${archetype.id}" axis "${axis}" score ${score} out of range`,
        );
      }
    }
  }

  for (const tenant of fixture.dogfood_tenants) {
    const weightSum = tenant.archetype_mix.reduce((sum, entry) => sum + entry.weight, 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      throw new Error(
        `Dogfood tenant "${tenant.tenant_id}" archetype_mix weights sum to ${weightSum}, expected 1`,
      );
    }
    for (const entry of tenant.archetype_mix) {
      getArchetypeDefinition(entry.archetype_id);
    }
  }

  for (const stressCase of fixture.route_wiring_stress_cases) {
    getArchetypeDefinition(stressCase.primary_archetype);
    for (const replayCaseId of stressCase.replay_case_ids) {
      getReplayCase(replayCaseId);
    }
  }
}
