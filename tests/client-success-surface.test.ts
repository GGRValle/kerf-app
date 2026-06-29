import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SUCCESS = path.join(ROOT, 'src/app/pages/client-success/index.astro');
const SURFACE_CONTEXT = path.join(ROOT, 'src/app/lib/surfaceContext.ts');

function clientSuccessSource(): string {
  return readFileSync(CLIENT_SUCCESS, 'utf8');
}

test('client success is a searchable CRM with review, referral, warranty, and social lanes', () => {
  const src = clientSuccessSource();
  assert.match(src, /Every customer, every time\./);
  assert.match(src, /Client CRM/);
  assert.match(src, /id="client-success-search"/);
  assert.match(src, /data-client-card/);
  assert.match(src, /Review asks/);
  assert.match(src, /Status and feedback/);
  assert.match(src, /Referral program/);
  assert.match(src, /Social media connections/);
  assert.match(src, /Warranty/);
  assert.match(src, /Every customer gets a review decision/);
});

test('client success keeps consequential sends behind Right Hand or detail surfaces', () => {
  const src = clientSuccessSource();
  assert.match(src, /Draft review ask/);
  assert.match(src, /Ask Right Hand/);
  assert.doesNotMatch(src, /\/review\/send/);
  assert.doesNotMatch(src, /\/social\/post/);
  assert.doesNotMatch(src, /Send review ask/);
  assert.doesNotMatch(src, /Post to Instagram/);
});

test('client success emits a machine-readable surface context', () => {
  const src = clientSuccessSource();
  const surfaceContext = readFileSync(SURFACE_CONTEXT, 'utf8');
  assert.match(src, /surface: 'client_success'/);
  assert.match(src, /phase: 'client_care'/);
  assert.match(surfaceContext, /\| 'client_success'/);
  assert.match(surfaceContext, /value === 'client_success'/);
});
