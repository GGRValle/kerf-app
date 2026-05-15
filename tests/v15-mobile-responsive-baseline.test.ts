/**
 * V1.5 mobile-responsive baseline — pattern locks (PR mobile-responsive-baseline).
 *
 * @see docs/agent-briefs/mobile-responsive-baseline-2026-05-15.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP_CSS = new URL('../src/examples/v15-vertical-slice/app.css', import.meta.url);
const F33_CSS = new URL('../src/examples/v15-vertical-slice/f33-embed.css', import.meta.url);
const F35_CSS = new URL('../src/examples/v15-vertical-slice/f35-embed.css', import.meta.url);
const F37_CSS = new URL('../src/examples/v15-vertical-slice/f37-embed.css', import.meta.url);

const MEDIA_720 = /@media\s*\(\s*max-width\s*:\s*720px\s*\)/;

test('app.css contains @media (max-width: 720px) mobile baseline block', () => {
  const css = readFileSync(APP_CSS, 'utf8');
  assert.match(css, MEDIA_720);
  assert.match(css, /Mobile baseline \(PR mobile-responsive-baseline/);
});

test('f35-embed.css contains @media (max-width: 720px) block', () => {
  const css = readFileSync(F35_CSS, 'utf8');
  assert.match(css, MEDIA_720);
});

test('f33-embed.css contains @media (max-width: 720px) block', () => {
  const css = readFileSync(F33_CSS, 'utf8');
  assert.match(css, MEDIA_720);
});

test('f37-embed.css contains @media (max-width: 720px) block', () => {
  const css = readFileSync(F37_CSS, 'utf8');
  assert.match(css, MEDIA_720);
});

test('app.css mobile scope sets Record control (.kerf-fc-voice-btn) min-height ≥ 44px', () => {
  const css = readFileSync(APP_CSS, 'utf8');
  const mobileIdx = css.indexOf('@media (max-width: 720px)');
  assert.ok(mobileIdx >= 0);
  const fromMobile = css.slice(mobileIdx);
  const voiceIdx = fromMobile.indexOf('.kerf-fc-voice-btn');
  assert.ok(voiceIdx >= 0, 'expected .kerf-fc-voice-btn inside mobile @media block');
  const rule = fromMobile.slice(voiceIdx, voiceIdx + 220);
  assert.match(rule, /min-height\s*:\s*(?:44|48|56)px/);
});

test('f33-embed.css photo grid uses two columns under 720px breakpoint', () => {
  const css = readFileSync(F33_CSS, 'utf8');
  assert.match(css, /\.kerf-fc-photo-grid[^}]*grid-template-columns[^;]*repeat\s*\(\s*2/s);
});
