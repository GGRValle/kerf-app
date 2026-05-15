/**
 * Mobile validation harness HTML builder locks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileValidationHarnessHtml,
  MOBILE_VALIDATION_ROUTES,
} from '../src/examples/v15-vertical-slice/m-validation-harness.js';
import { MOBILE_PROBE_QUERY_PARAM } from '../src/examples/v15-vertical-slice/m-dom-probe.js';

test('buildMobileValidationHarnessHtml embeds 375px and 414px iframes', () => {
  const html = buildMobileValidationHarnessHtml('/field-capture');
  assert.match(html, /m-harness-frame-wrap--375/);
  assert.match(html, /m-harness-frame-wrap--414/);
  assert.match(html, /id="m-frame-375"/);
  assert.match(html, /id="m-frame-414"/);
  assert.match(html, new RegExp(`src="/field-capture\\?${MOBILE_PROBE_QUERY_PARAM}=1"`));
});

test('harness HTML includes tabbed route selector for all validation routes', () => {
  const html = buildMobileValidationHarnessHtml();
  for (const route of MOBILE_VALIDATION_ROUTES) {
    assert.match(html, new RegExp(`data-route="${route.replace('/', '\\/')}"`));
  }
  assert.match(html, /postMessage|addEventListener\('message'/);
  assert.match(html, /DOM probe results/);
});
