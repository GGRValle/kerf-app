export type OperatingAxis =
  | 'work_item_volume'
  | 'outcome_latency'
  | 'cash_pressure'
  | 'proof_burden'
  | 'field_office_gap'
  | 'schedule_volatility'
  | 'material_volatility'
  | 'customer_comm_load'
  | 'adoption_friction'
  | 'voice_first_need'
  | 'operator_bottleneck'
  | 'learning_ambiguity';

export type ArchetypeId =
  | 'gc_remodeler'
  | 'design_build_bespoke_residential'
  | 'cabinet_shop_millwork'
  | 'hvac_plumbing_electrical_service'
  | 'maintenance_heavy_operator'
  | 'commercial_specialty_trade'
  | 'roofing_exterior_restoration'
  | 'solo_owner_operator_mixed_trade';

export type BlendRuleId =
  | 'ui_density_compression'
  | 'proof_irreversibility_weight'
  | 'onboarding_tone_friction'
  | 'right_hand_interrupt_posture'
  | 'cash_money_surface'
  | 'field_capture_posture';

export type BlendRuleKind = 'max' | 'weighted_average';

export type SpineSurface =
  | 'capture'
  | 'review'
  | 'capture_review'
  | 'project_detail'
  | 'home'
  | 'home_density'
  | 'draft_estimate'
  | 'approval_send_gate';

export type DogfoodTenantId = 'tenant_ggr' | 'tenant_valle' | 'tenant_hpg';

export type ConfidenceBand = 'low_medium' | 'medium' | 'medium_high';

export type ArchetypeAxes = Record<OperatingAxis, number>;

export interface ArchetypeMixEntry {
  readonly archetype_id: ArchetypeId;
  readonly weight: number;
}

export interface ArchetypeDefinition {
  readonly id: ArchetypeId;
  readonly label: string;
  readonly confidence: ConfidenceBand;
  readonly axes: ArchetypeAxes;
  readonly default_product_emphasis: readonly string[];
  readonly learning_proxy_signals: readonly string[];
}

export interface BlendRuleDefinition {
  readonly rule: BlendRuleKind;
  readonly axes: readonly OperatingAxis[];
  readonly product_meaning: string;
}

export interface DogfoodTenantMapping {
  readonly tenant_id: DogfoodTenantId;
  readonly label: string;
  readonly primary_archetype: ArchetypeId;
  readonly archetype_mix: readonly ArchetypeMixEntry[];
  readonly notes: string;
}

export interface ReplayCase {
  readonly id: string;
  readonly title: string;
  readonly tenant_id: DogfoodTenantId | null;
  readonly spine_surface: SpineSurface;
  readonly correction_scope: string;
  readonly memory_locality: readonly string[];
  readonly evidence_source_class: string;
  readonly action: string;
  readonly related_proxy_signals: readonly string[];
  readonly related_events: readonly string[];
}

export interface RouteWiringStressCase {
  readonly id: string;
  readonly spine_surface: SpineSurface;
  readonly primary_archetype: ArchetypeId;
  readonly blend_rule_ids: readonly BlendRuleId[];
  readonly min_blend_scores: Partial<Record<BlendRuleId, number>>;
  readonly replay_case_ids: readonly string[];
}

export interface BlendedOperatingPosture {
  readonly mix: readonly ArchetypeMixEntry[];
  readonly axes: ArchetypeAxes;
  readonly blend_scores: Record<BlendRuleId, number>;
  readonly primary_archetype: ArchetypeId;
}

export interface ConstructionOperatingGradientFixture {
  readonly id: string;
  readonly date: string;
  readonly status: string;
  readonly scale: {
    readonly min: number;
    readonly max: number;
    readonly meaning: string;
  };
  readonly axes: readonly OperatingAxis[];
  readonly blend_rules: Record<BlendRuleId, BlendRuleDefinition>;
  readonly surface_consumer_order: readonly {
    readonly order: number;
    readonly surface: string;
    readonly rationale: string;
  }[];
  readonly dogfood_tenants: readonly DogfoodTenantMapping[];
  readonly replay_cases: readonly ReplayCase[];
  readonly route_wiring_stress_cases: readonly RouteWiringStressCase[];
  readonly proxy_signal_event_map: Record<
    string,
    {
      readonly existing_events: readonly string[];
      readonly future_events: readonly string[];
    }
  >;
  readonly archetypes: readonly ArchetypeDefinition[];
}
