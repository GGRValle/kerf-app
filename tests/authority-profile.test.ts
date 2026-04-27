import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_ACTION_CLASSES,
  AUTHORITY_RESOURCES,
  canAuthorize,
  DEFAULT_AUTHORITY_PROFILE,
  escalationChain,
  getBand,
  type AuthorityProfile,
  type AuthorityResource,
  type AuthorityActionClass,
} from '../src/authority/index.js';
import type { Role } from '../src/blackboard/index.js';
import { OWNER_MONEY_CEILING_CENTS } from '../src/permissions/index.js';

const ALL_ROLES: readonly Role[] = [
  'owner',
  'moo',
  'pm',
  'field_super',
  'office',
  'sub',
  'client',
];

test('default profile has a band for every (role × resource) pair', () => {
  for (const role of ALL_ROLES) {
    for (const resource of AUTHORITY_RESOURCES) {
      const band = getBand(DEFAULT_AUTHORITY_PROFILE, role, resource);
      assert.ok(
        band !== undefined,
        `missing band for role=${role} resource=${resource}`,
      );
      assert.equal(band?.role, role);
      assert.equal(band?.resource, resource);
    }
  }
});

test('owner money authority caps at OWNER_MONEY_CEILING_CENTS', () => {
  // At ceiling: allowed.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'owner',
      resource: 'money',
      amountCents: OWNER_MONEY_CEILING_CENTS,
    }),
    'allowed',
  );

  // One cent below: allowed.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'owner',
      resource: 'money',
      amountCents: OWNER_MONEY_CEILING_CENTS - 1,
    }),
    'allowed',
  );

  // One cent above: owner has no escalation target → denied.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'owner',
      resource: 'money',
      amountCents: OWNER_MONEY_CEILING_CENTS + 1,
    }),
    'denied',
  );
});

test('PM money over-ceiling escalates to MoO and owner', () => {
  // Below PM ceiling: allowed.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'pm',
      resource: 'money',
      amountCents: 25_000,
    }),
    'allowed',
  );

  // Above PM ceiling: requires escalation (MoO + owner are on the chain).
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'pm',
      resource: 'money',
      amountCents: 25_001,
    }),
    'requires_escalation',
  );

  assert.deepEqual(
    escalationChain(DEFAULT_AUTHORITY_PROFILE, 'pm', 'money'),
    ['moo', 'owner'],
  );
});

test("'recommend' bands always require escalation regardless of amount", () => {
  // field_super on money: 'recommend' → escalation, even at $0
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'field_super',
      resource: 'money',
      amountCents: 0,
    }),
    'requires_escalation',
  );

  // office on money: 'recommend' → escalation
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'office',
      resource: 'money',
      amountCents: 1_000,
    }),
    'requires_escalation',
  );
});

test("'observe' bands always deny", () => {
  // sub on every resource: observe → denied
  for (const resource of AUTHORITY_RESOURCES) {
    if (resource === 'client_share') continue; // sub is observe; this also denies
    assert.equal(
      canAuthorize(DEFAULT_AUTHORITY_PROFILE, { role: 'sub', resource }),
      'denied',
      `expected denied for sub/${resource}`,
    );
  }

  // client on money: observe → denied
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'client',
      resource: 'money',
      amountCents: 100,
    }),
    'denied',
  );
});

test("'approve_any' bands allow at any amount and need no escalation", () => {
  // Owner approve_any on scope: no escalation chain expected
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'owner',
      resource: 'scope',
      amountCents: 1_000_000_00, // $1M, no ceiling on scope
    }),
    'allowed',
  );

  assert.deepEqual(
    escalationChain(DEFAULT_AUTHORITY_PROFILE, 'owner', 'scope'),
    [],
  );

  // Client approve_any on client_share — they self-approve their own decisions
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'client',
      resource: 'client_share',
    }),
    'allowed',
  );
});

test('approve_under_ceiling without amountCents denies (ill-formed call)', () => {
  // PM is approve_under_ceiling on money. The band is gated on amount;
  // calling without one is ill-formed for this action class. Fail closed.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'pm',
      resource: 'money',
    }),
    'denied',
  );
});

test('approve_under_ceiling with negative amountCents denies (invalid input)', () => {
  // Negative cents are invalid for an authority decision; refunds/reversals
  // route through a different code path. Even a small negative number that
  // is technically <= maxAmountCents must not slip through.
  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'pm',
      resource: 'money',
      amountCents: -1,
    }),
    'denied',
  );

  assert.equal(
    canAuthorize(DEFAULT_AUTHORITY_PROFILE, {
      role: 'owner',
      resource: 'money',
      amountCents: -100_000,
    }),
    'denied',
  );
});

test("delegate band routes to canEscalateTo and denies when chain is empty", () => {
  // Custom profile to exercise the `delegate` action class (the default
  // profile has no delegate bands; that's V1.5+ scope when MoO surface lands).
  const delegateWithChain: AuthorityProfile = {
    version: '2026-04-27.1-test',
    bands: [
      { role: 'moo', resource: 'employment', actionClass: 'delegate', canEscalateTo: ['owner'] },
      { role: 'pm', resource: 'employment', actionClass: 'delegate' }, // empty chain
    ],
  };

  // With chain → requires_escalation (delegation routes to owner).
  assert.equal(
    canAuthorize(delegateWithChain, { role: 'moo', resource: 'employment' }),
    'requires_escalation',
  );

  // Without chain → denied (delegate without targets is fail-closed).
  assert.equal(
    canAuthorize(delegateWithChain, { role: 'pm', resource: 'employment' }),
    'denied',
  );
});

test("recommend band with no escalation chain denies (nowhere to route)", () => {
  // The default profile always pairs `recommend` with a non-empty
  // canEscalateTo, but a profile editor could mis-configure it. Verify
  // the fail-closed behavior.
  const recommendNoChain: AuthorityProfile = {
    version: '2026-04-27.1-test',
    bands: [
      { role: 'office', resource: 'compliance', actionClass: 'recommend' }, // no chain
    ],
  };

  assert.equal(
    canAuthorize(recommendNoChain, { role: 'office', resource: 'compliance' }),
    'denied',
  );
});

test('escalationChain returns priority-ordered roles', () => {
  // PM scope: recommend → escalates to moo, owner (in that order)
  assert.deepEqual(
    escalationChain(DEFAULT_AUTHORITY_PROFILE, 'pm', 'scope'),
    ['moo', 'owner'],
  );

  // field_super money: recommend → escalates to pm, moo, owner
  assert.deepEqual(
    escalationChain(DEFAULT_AUTHORITY_PROFILE, 'field_super', 'money'),
    ['pm', 'moo', 'owner'],
  );

  // owner money: at ceiling, no escalation chain
  assert.deepEqual(
    escalationChain(DEFAULT_AUTHORITY_PROFILE, 'owner', 'money'),
    [],
  );
});

test('AUTHORITY_ACTION_CLASSES enumerates every member of the union', () => {
  const expected: AuthorityActionClass[] = [
    'observe',
    'recommend',
    'approve_under_ceiling',
    'approve_any',
    'delegate',
  ];
  assert.deepEqual([...AUTHORITY_ACTION_CLASSES], expected);
});

test('AUTHORITY_RESOURCES enumerates every member of the union', () => {
  const expected: AuthorityResource[] = [
    'money',
    'scope',
    'schedule',
    'subcontractor',
    'client_share',
    'compliance',
    'employment',
  ];
  assert.deepEqual([...AUTHORITY_RESOURCES], expected);
});

test('profile version is date-stamped per the convention', () => {
  // Date-stamped: yyyy-mm-dd.N where N is the within-day revision counter.
  assert.match(DEFAULT_AUTHORITY_PROFILE.version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});
