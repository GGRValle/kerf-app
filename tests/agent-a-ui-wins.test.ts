/**
 * Agent A · three quick UI wins (2026-06-13)
 * Structural guards for capture-origin, proposal mobile reflow, home red-chip-tier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

test('Capture Origin · session links are human-readable and hide dle_ ids', async () => {
  const source = await readFile(
    path.join(ROOT, 'src/app/components/CaptureOriginPanel.astro'),
    'utf8',
  );
  assert.match(source, /data-session-id=\{session\.session_id\}/);
  assert.match(source, /Field capture|Captura de campo/);
  assert.doesNotMatch(source, /\{id\}/);
  assert.doesNotMatch(source, /session_link/);
});

test('Proposal print styles · mobile reflow avoids justify gaps and stacked division headers', async () => {
  const source = await readFile(path.join(ROOT, 'src/proposal/print-style.ts'), 'utf8');
  assert.match(source, /@media screen and \(max-width: 600px\)/);
  assert.match(source, /\.kerf-proposal__scope-narrative[\s\S]*text-align: left/);
  assert.match(source, /\.kerf-proposal__terms-list li[\s\S]*text-align: left/);
  assert.match(source, /\.kerf-proposal__division-header[\s\S]*flex-direction: column/);
  assert.match(source, /\.kerf-proposal__division-subtotal[\s\S]*white-space: nowrap/);
});

test('Home · red-is-chip-tier overrides keep rails neutral on risk_changed cards', async () => {
  const source = await readFile(
    path.join(ROOT, 'src/app/components/RightHandHomeSurface.astro'),
    'utf8',
  );
  assert.match(source, /\.rh-home \.aa-card\[data-attention-state='risk_changed'\]/);
  assert.match(source, /\.aa-card__rail[\s\S]*background: var\(--kerf-border-soft\)/);
  assert.match(source, /\.aa-card__state[\s\S]*color: var\(--kerf-red\)/);
});
