import type { VerticalSlicePhase } from './router.js';

const STEPS: readonly { id: VerticalSlicePhase; label: string }[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'review', label: 'Review' },
  { id: 'draft', label: 'Draft' },
  { id: 'approve', label: 'Approve' },
  { id: 'audit', label: 'Audit' },
];

export function renderProgressStrip(active: VerticalSlicePhase): string {
  const items = STEPS.map((s) => {
    const isActive = active === s.id;
    const cls = isActive ? 'kerf-v15-progress__step kerf-v15-progress__step--active' : 'kerf-v15-progress__step';
    const current = isActive ? ' aria-current="step"' : '';
    return `<li class="${cls}"${current}><span class="kerf-v15-progress__label">${s.label}</span></li>`;
  }).join('');
  return `<nav class="kerf-v15-progress" aria-label="Vertical slice progress">
  <ol class="kerf-v15-progress__list">${items}</ol>
</nav>`;
}
