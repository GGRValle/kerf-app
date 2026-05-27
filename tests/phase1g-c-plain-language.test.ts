import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/i18n/en.js';

const RAW_EVENT_SNIPPETS = [
  'transcript.reviewed',
  'correction.classified',
  'daily_log.entry_captured',
  'proposal.edited',
  'client.created event',
  'tenant_ggr',
  'shell port',
  'routeName',
];

const PRIMARY_UI_KEYS: (keyof typeof EN)[] = [
  'review.transcript.notice',
  'review.draft.notice',
  'nav.transcript_review',
  'nav.draft_review',
  'f_pv2.subtitle',
  'f_cl.form.subtitle',
];

test('Phase 1G-C · primary review/nav strings avoid raw event-type leakage', () => {
  for (const key of PRIMARY_UI_KEYS) {
    const value = EN[key];
    for (const raw of RAW_EVENT_SNIPPETS) {
      assert.equal(
        value.includes(raw),
        false,
        `${key} should not expose "${raw}" · got: ${value}`,
      );
    }
  }
});

test('Phase 1G-C · field-capture.astro is untouched by this lane', async () => {
  const source = readFileSync(join(process.cwd(), 'src/app/pages/field-capture.astro'), 'utf8');
  assert.doesNotMatch(source, /Phase 1G-C/);
});
