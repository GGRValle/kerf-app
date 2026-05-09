import type {
  LineComponentReleaseAction,
  LineComponentReleaseCategory,
  LineComponentReleaseDecision,
  LineComponentReleaseIssue,
  LineComponentReleaseType,
  LineComponentQuantityFence,
  ReleaseRequirement,
} from './types.js';

const SENSITIVE_RELEASE_CATEGORIES: ReadonlySet<LineComponentReleaseCategory> = new Set([
  'cabinetry',
  'stone',
  'glass',
  'tight_millwork',
]);

export function canReleaseLineComponent(
  component: LineComponentQuantityFence,
  releaseType: LineComponentReleaseType,
): LineComponentReleaseDecision {
  const blocked: LineComponentReleaseIssue[] = [];
  const warnings: LineComponentReleaseIssue[] = [];
  const requiredActions: LineComponentReleaseAction[] = [];

  const sensitive = SENSITIVE_RELEASE_CATEGORIES.has(component.release_category);
  const releaseRequiresVerification =
    releaseType !== 'estimate' &&
    (sensitive ||
      component.quantity_use_label === 'verify_before_release' ||
      component.quantity_use_label === 'manual_required' ||
      component.release_requirement !== 'none');

  if (releaseType === 'estimate') {
    if (component.quantity_use_label !== 'estimate_safe') {
      warnings.push({
        code: 'estimate_only_quantity',
        message: 'Quantity may support estimating, but must not be released without verification.',
        component_id: component.component_id,
        release_requirement: component.release_requirement,
        verification_status: component.verification_status,
      });
    }
    if (sensitive || component.quantity_use_label === 'verify_before_release') {
      warnings.push({
        code: 'release_will_require_verification',
        message: 'This line component will require verification before ordering, fabrication, or field release.',
        component_id: component.component_id,
        release_requirement: effectiveReleaseRequirement(component),
        verification_status: component.verification_status,
      });
    }
    addExpirationWarning(component, warnings);
    return decision(component, releaseType, blocked, warnings, requiredActions);
  }

  if (component.quantity_use_label === 'manual_required') {
    enforceManualVerification(component, blocked, requiredActions);
  } else if (releaseRequiresVerification) {
    enforceVerification(component, sensitive, blocked, requiredActions);
  }

  addExpirationWarning(component, warnings);

  return decision(component, releaseType, blocked, warnings, requiredActions);
}

export function isVerificationSensitiveCategory(
  category: LineComponentReleaseCategory,
): boolean {
  return SENSITIVE_RELEASE_CATEGORIES.has(category);
}

function enforceManualVerification(
  component: LineComponentQuantityFence,
  blocked: LineComponentReleaseIssue[],
  requiredActions: LineComponentReleaseAction[],
): void {
  if (
    component.verification_status === 'verified' &&
    hasVerificationLog(component) &&
    component.verification_method === 'manual_template'
  ) {
    return;
  }

  blocked.push({
    code: 'manual_verification_required',
    message: 'Manual-required quantity cannot be released until manual verification is logged.',
    component_id: component.component_id,
    release_requirement: 'manual_template',
    verification_status: component.verification_status,
  });
  requiredActions.push({
    code: 'log_manual_verification',
    message: 'Log manual verification with method, verifier, and timestamp.',
    component_id: component.component_id,
    release_requirement: 'manual_template',
  });
}

function enforceVerification(
  component: LineComponentQuantityFence,
  sensitive: boolean,
  blocked: LineComponentReleaseIssue[],
  requiredActions: LineComponentReleaseAction[],
): void {
  if (component.verification_status === 'expired') {
    blocked.push({
      code: 'verification_expired',
      message: 'Verification is expired; re-verify before release.',
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
      verification_status: component.verification_status,
    });
    requiredActions.push(requiredActionFor(component));
    return;
  }

  if (component.verification_status === 'pending') {
    blocked.push({
      code: 'verification_pending',
      message: 'Verification is pending; release is blocked until verification is complete.',
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
      verification_status: component.verification_status,
    });
    requiredActions.push(requiredActionFor(component));
    return;
  }

  if (component.verification_status !== 'verified') {
    blocked.push({
      code: sensitive
        ? 'sensitive_component_requires_verification'
        : 'verification_required',
      message: sensitive
        ? 'Cabinetry, stone, glass, and tight millwork require verification before release.'
        : 'Line component requires verification before release.',
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
      verification_status: component.verification_status,
    });
    requiredActions.push(requiredActionFor(component));
    return;
  }

  if (!hasVerificationLog(component)) {
    blocked.push({
      code: 'verification_log_incomplete',
      message: 'Verified line component is missing verification method, verifier, or timestamp.',
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
      verification_status: component.verification_status,
    });
    requiredActions.push({
      code: 'verify_quantity',
      message: 'Complete the verification log before release.',
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
    });
  }
}

function hasVerificationLog(component: LineComponentQuantityFence): boolean {
  return Boolean(
    component.verification_logged_at &&
      component.verification_method &&
      component.verified_by,
  );
}

function addExpirationWarning(
  component: LineComponentQuantityFence,
  warnings: LineComponentReleaseIssue[],
): void {
  if (
    component.verification_status === 'verified' &&
    component.verification_expires_at
  ) {
    warnings.push({
      code: 'verification_expires',
      message: `Verification expires at ${component.verification_expires_at}.`,
      component_id: component.component_id,
      release_requirement: effectiveReleaseRequirement(component),
      verification_status: component.verification_status,
    });
  }
}

function requiredActionFor(component: LineComponentQuantityFence): LineComponentReleaseAction {
  const requirement = effectiveReleaseRequirement(component);
  switch (requirement) {
    case 'tape_verify':
      return {
        code: 'tape_verify',
        message: 'Complete tape verification before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
    case 'laser_verify':
      return {
        code: 'laser_verify',
        message: 'Complete laser verification before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
    case 'manual_template':
      return {
        code: 'complete_manual_template',
        message: 'Complete manual verification template before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
    case 'supervisor_signoff':
      return {
        code: 'supervisor_signoff',
        message: 'Capture supervisor signoff before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
    case 'multi_method':
      return {
        code: 'multi_method_verify',
        message: 'Complete multi-method verification before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
    case 'none':
      return {
        code: 'verify_quantity',
        message: 'Verify quantity before release.',
        component_id: component.component_id,
        release_requirement: requirement,
      };
  }
}

function effectiveReleaseRequirement(
  component: LineComponentQuantityFence,
): ReleaseRequirement {
  if (component.quantity_use_label === 'manual_required') {
    return 'manual_template';
  }
  return component.release_requirement;
}

function decision(
  component: LineComponentQuantityFence,
  releaseType: LineComponentReleaseType,
  blocked: readonly LineComponentReleaseIssue[],
  warnings: readonly LineComponentReleaseIssue[],
  requiredActions: readonly LineComponentReleaseAction[],
): LineComponentReleaseDecision {
  return {
    allowed: blocked.length === 0,
    release_type: releaseType,
    component_id: component.component_id,
    blocked,
    warnings,
    required_actions: requiredActions,
  };
}

