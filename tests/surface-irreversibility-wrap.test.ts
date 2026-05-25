/**
 * Lane 0.4 · SurfaceIrreversibilityWrap enforcement tests (D-048 Q2 dimension).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDailySafetyBudget,
  validateIrreversibilityActionContext,
  countSafetyCopyBlocks,
} from '../src/app/lib/surfaceIrreversibility.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PAGES_ROOT = path.resolve(__dirname, '../src/app/pages');

test('daily-cap: allows safety-copy blocks within budget', () => {
  const html = `
    <p class="safety-copy">Line 1</p>
    <p class="safety-copy">Line 2</p>
  `;
  assert.equal(countSafetyCopyBlocks(html), 2);
  assert.deepEqual(validateDailySafetyBudget(html, 3), { ok: true });
});

test('daily-cap: rejects when safety-copy blocks exceed budget', () => {
  const html = `
    <p class="safety-copy">1</p>
    <p class="safety-copy">2</p>
    <p class="safety-copy">3</p>
    <p class="safety-copy">4</p>
  `;
  const result = validateDailySafetyBudget(html, 3);
  assert.equal(result.ok, false);
});

test('irreversibility-context: requires actionContext in every safety-copy block', () => {
  const okHtml = '<p class="safety-copy">Sending EST-020 proposal is irreversible.</p>';
  assert.deepEqual(validateIrreversibilityActionContext(okHtml, 'EST-020 proposal'), { ok: true });

  const badHtml = '<p class="safety-copy">This action cannot be undone.</p>';
  const result = validateIrreversibilityActionContext(badHtml, 'EST-020 proposal');
  assert.equal(result.ok, false);
});

async function walkAstroPages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkAstroPages(full)));
    } else if (entry.name.endsWith('.astro')) {
      files.push(full);
    }
  }
  return files;
}

test('astro pages using kind="daily" respect default safetyLineBudget=3', async () => {
  const pages = await walkAstroPages(APP_PAGES_ROOT);
  const dailyPages = [];
  for (const page of pages) {
    const src = await fs.readFile(page, 'utf8');
    if (src.includes('kind="daily"') || src.includes("kind='daily'")) {
      dailyPages.push({ page, src });
    }
  }
  assert.ok(dailyPages.length > 0, 'expected at least one daily SurfaceIrreversibilityWrap page');
  for (const { page, src } of dailyPages) {
    const budgetMatch = src.match(/safetyLineBudget=\{(\d+)\}/);
    const budget = budgetMatch ? Number(budgetMatch[1]) : 3;
    const safetyBlocks = (src.match(/class="safety-copy"/g) ?? []).length;
    assert.ok(
      safetyBlocks <= budget,
      `${path.relative(APP_PAGES_ROOT, page)} has ${safetyBlocks} safety-copy blocks > budget ${budget}`,
    );
  }
});

test('astro irreversibility pages declare actionContext on wrap + safety-copy references it', async () => {
  const pages = await walkAstroPages(APP_PAGES_ROOT);
  for (const page of pages) {
    const src = await fs.readFile(page, 'utf8');
    if (!src.includes('kind="irreversibility"') && !src.includes("kind='irreversibility'")) {
      continue;
    }
    assert.match(
      src,
      /actionContext=\{?[`'"]/,
      `${path.relative(APP_PAGES_ROOT, page)} missing actionContext on irreversibility wrap`,
    );
    if (src.includes('class="safety-copy"')) {
      assert.match(src, /actionContext|EST-|audit packet|proposal/, page);
    }
  }
});
