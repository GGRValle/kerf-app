import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPROVED_HOSTING_ENDPOINTS,
  HOSTING_ROUTE_CHECK_ACTION,
  approvedHostingEndpoint,
  checkHostingRoute,
  type ApprovedHostingEndpoint,
  type HostingRouteCheckRequest,
} from '../src/hosting/index.js';

const BASE_REQUEST = {
  invocation_id: 'invocation_w1_001',
  tenant_id: 'tenant_ggr',
  endpoint: 'groq://llama-70b',
  source_model: 'llama-3.3-70b',
  purpose: 'chief_of_staff_draft',
  requested_at: '2026-05-02T16:00:00.000Z',
  workflow: 'invoice_followup',
} as const satisfies HostingRouteCheckRequest;

test('approved hosting endpoint registry is seeded from D-023 (70b + Scout + Whisper Tier 1)', () => {
  assert.deepEqual(APPROVED_HOSTING_ENDPOINTS, [
    {
      endpoint: 'groq://llama-70b',
      provider: 'groq',
      model: 'llama-3.3-70b',
      tier: 'cheap_fast',
      approved_by_decision: 'D-023',
      approved_at: '2026-04-22T00:00:00.000Z',
      status: 'approved',
    },
    {
      endpoint: 'groq://llama-4-scout',
      provider: 'groq',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      tier: 'cheap_fast',
      approved_by_decision: 'D-023',
      approved_at: '2026-05-06T00:00:00.000Z',
      status: 'approved',
    },
    {
      endpoint: 'groq://whisper-large-v3-turbo',
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      tier: 'cheap_fast',
      approved_by_decision: 'D-023',
      approved_at: '2026-05-08T00:00:00.000Z',
      status: 'approved',
    },
  ]);
  assert.equal(approvedHostingEndpoint('groq://llama-70b')?.approved_by_decision, 'D-023');
  assert.equal(approvedHostingEndpoint('groq://llama-4-scout')?.approved_by_decision, 'D-023');
  assert.equal(approvedHostingEndpoint('groq://whisper-large-v3-turbo')?.approved_by_decision, 'D-023');
});

test('checkHostingRoute allows approved hosted endpoints with adapter audit action', () => {
  const result = checkHostingRoute(BASE_REQUEST, {
    checkedAt: '2026-05-02T16:00:01.000Z',
  });

  assert.equal(result.adapter_action, HOSTING_ROUTE_CHECK_ACTION);
  assert.equal(result.allowed, true);
  assert.equal(result.endpoint, 'groq://llama-70b');
  assert.equal(result.provider, 'groq');
  assert.equal(result.model, 'llama-3.3-70b');
  assert.equal(result.tier, 'cheap_fast');
  assert.equal(result.approved_by_decision, 'D-023');
  assert.equal(result.checked_at, '2026-05-02T16:00:01.000Z');
});

test('checkHostingRoute blocks endpoints that are not in the approved registry', () => {
  const result = checkHostingRoute({ ...BASE_REQUEST, endpoint: 'local://mac-mini' });

  assert.equal(result.adapter_action, 'hosting_route_check');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'endpoint_not_approved');
  assert.equal(result.provider, undefined);
});

test('checkHostingRoute blocks source model mismatches for approved endpoints', () => {
  const result = checkHostingRoute({ ...BASE_REQUEST, source_model: 'claude-3.5-sonnet' });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'source_model_mismatch');
});

test('checkHostingRoute blocks retired endpoints even when they are in the registry', () => {
  const registry = [
    {
      endpoint: 'groq://llama-70b',
      provider: 'groq',
      model: 'llama-3.3-70b',
      tier: 'cheap_fast',
      approved_by_decision: 'D-023',
      approved_at: '2026-04-22T00:00:00.000Z',
      status: 'retired',
    },
  ] as const satisfies readonly ApprovedHostingEndpoint[];

  const result = checkHostingRoute(BASE_REQUEST, { registry });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'endpoint_not_active');
});

test('checkHostingRoute blocks malformed route requests deterministically', () => {
  const result = checkHostingRoute({ ...BASE_REQUEST, invocation_id: '   ' });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'malformed_route_request');
  assert.equal(result.checked_at, BASE_REQUEST.requested_at);
});

test('hosting route check module has no network client dependency', () => {
  const source = readFileSync(new URL('../src/hosting/routeCheck.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /axios/i);
  assert.doesNotMatch(source, /https?:\/\//i);
});
