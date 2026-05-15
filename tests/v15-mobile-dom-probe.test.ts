/**
 * Unit tests for V1.5 mobile DOM probe helpers (harness dev utility).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOBILE_PROBE_QUERY_PARAM,
  MOBILE_PROBE_MESSAGE_TYPE,
  MOBILE_VALIDATION_ROUTES,
  auditHorizontalOverflow,
  auditSmallTouchTargets,
  isMobileProbeEnabled,
} from '../src/examples/v15-vertical-slice/m-dom-probe.js';

test('isMobileProbeEnabled is true only when kerf_m_probe=1', () => {
  assert.equal(isMobileProbeEnabled(''), false);
  assert.equal(isMobileProbeEnabled('?foo=1'), false);
  assert.equal(isMobileProbeEnabled(`?${MOBILE_PROBE_QUERY_PARAM}=1`), true);
  assert.equal(isMobileProbeEnabled(`?${MOBILE_PROBE_QUERY_PARAM}=0`), false);
});

test('auditHorizontalOverflow keeps elements wider than client box', () => {
  const findings = auditHorizontalOverflow([
    { descriptor: '.ok', scrollWidth: 100, clientWidth: 100 },
    { descriptor: '.wide', scrollWidth: 420, clientWidth: 375 },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.descriptor, '.wide');
});

test('auditSmallTouchTargets flags interactive elements under 44×44px', () => {
  const findings = auditSmallTouchTargets([
    { descriptor: 'button.ok', width: 48, height: 48 },
    { descriptor: 'a.small', width: 32, height: 40 },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.descriptor, 'a.small');
});

test('MOBILE_VALIDATION_ROUTES lists four V1.5 surfaces', () => {
  assert.deepEqual(MOBILE_VALIDATION_ROUTES, [
    '/dashboard',
    '/field-capture',
    '/transcript-review',
    '/draft-review',
  ]);
  assert.equal(MOBILE_PROBE_MESSAGE_TYPE, 'kerf-v15-mobile-dom-probe');
});
