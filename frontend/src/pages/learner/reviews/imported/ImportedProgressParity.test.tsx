import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportedReviewSection } from './ImportedReviewSection';
import { hasImportedProgress, normalizeImportedProgress } from './presentation';
import { metricParityExample } from './presentationFixtures';

afterEach(cleanup);

function show(value: unknown) {
  return render(<ImportedReviewSection section={{ id: 'example-progress', name: 'Learning progress', order: 0,
    fields: [{ label: 'progress', value }], tables: [], rawText: '', historicalPresentation: false }} />);
}
function card(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('article')!);
}

describe('imported Aptem metric preservation and non-historical presentation', () => {
  it.each([
    { current: 14, max: 87, completedCount: 29, totalCount: 87, target: 20, expected: 16, remaining: 58 },
    { current: 19, max: 143, completedCount: 37, totalCount: 143, target: 24, expected: 13, remaining: 106 },
  ])('uses current/max for the main metric, preserving separate counts ($current/$max)', example => {
    const source = Object.freeze({ ...example, progressType: 2, targetCount: example.target });
    const before = JSON.stringify(source);
    const model = normalizeImportedProgress(source)[0];
    expect(model.kind).toBe('activities');
    if (model.kind !== 'activities') throw new Error('Missing learning plan metric');
    expect(model.percentage).toBeCloseTo(example.current / example.max * 100, 12);
    expect(model.percentage).not.toBeCloseTo(example.completedCount / example.totalCount * 100);
    show(source);
    const view = card('Learning Plan Progress');
    expect(view.getByText(`${example.expected}%`)).toBeVisible();
    expect(view.getByText(`${example.completedCount} of ${example.totalCount} completed`)).toBeVisible();
    expect(view.getByText('Activity completion counts')).toBeVisible();
    expect(view.getByText(String(example.remaining))).toBeVisible();
    expect(view.getByText('Not recorded')).toBeVisible();
    expect(view.getByText('Target count')).toBeVisible();
    expect(view.getByText(String(example.target))).toBeVisible();
    const bar = view.getByRole('img');
    expect(bar.firstElementChild).toHaveStyle({ width: `${example.current / example.max * 100}%` });
    expect(bar.querySelector('i')).toHaveStyle({ left: `${example.target / example.max * 100}%` });
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each([{ current: null, max: 10 }, { current: 3, max: null }, { current: 3, max: 0 }, { current: 3, max: -1 }, { current: 'invalid', max: 10 }])(
    'never substitutes the completion ratio for missing/invalid progress: %j', values => {
      show({ progressType: 2, completedCount: 7, totalCount: 10, targetCount: 8, ...values });
      const view = card('Learning Plan Progress');
      expect(view.getByRole('img')).toHaveAccessibleName('Learning Plan Progress: Not recorded');
      expect(view.queryByText('70%')).not.toBeInTheDocument();
      expect(view.getByText('7 of 10 completed')).toBeVisible();
      expect(view.getByText('8')).toBeVisible();
      expect(view.getByRole('img').querySelector('i')).toBeNull();
    },
  );

  it('keeps percentage targets distinct from activity target counts, including explicit zero submissions', () => {
    show({ progressType: 2, current: 25, max: 100, target: 40, completedCount: 7, totalCount: 10, targetCount: 8, submittedCount: 0 });
    const view = card('Learning Plan Progress');
    expect(view.getByText('Target: 40%')).toBeVisible();
    expect(view.getByText('8')).toBeVisible();
    expect(view.getByText('0')).toBeVisible();
    expect(view.getByText('3')).toBeVisible();
  });

  it('retains source standard progress/target and shows the rounded raw variance, not PDF-specific rounding', () => {
    show(metricParityExample[1]);
    const view = card('Standard progress');
    expect(view.getByText('79%')).toBeVisible();
    expect(view.getByText('Target: 86%')).toBeVisible();
    expect(view.getByText('6% Below')).toHaveAttribute('title', 'Difference from target in percentage points');
    expect(view.queryByText('7% Below')).not.toBeInTheDocument();
    expect(view.getByRole('img').querySelector('i')).toHaveStyle({ left: '85.71428571428571%' });
  });

  it('uses minTarget when no standard target was captured', () => {
    show({ progressType: 4, current: 18, max: 20, minTarget: 16 });
    const view = card('Standard progress');
    expect(view.getByText('90%')).toBeVisible();
    expect(view.getByText('Target: 80%')).toBeVisible();
    expect(view.getByText('10% Above')).toBeVisible();
  });

  it.each([[10, 'On target'], [9.9, '0% Below'], [10.1, '0% Above']] as const)(
    'uses the exact source direction without a tolerance threshold: %s', (current, label) => {
      show({ progressType: 4, current, max: 100, target: 10 });
      expect(card('Standard progress').getByText(label)).toBeVisible();
    },
  );

  it('restores the OTJ target and numeric variance while preserving source hour units', () => {
    show(metricParityExample[2]);
    const view = card('Off-The-Job Hours');
    ['12%', 'Target: 20%', '8% Below', '557h', '576h', '69h', '587h'].forEach(value => expect(view.getByText(value)).toBeVisible());
    expect(view.getByRole('img').querySelector('i')).toHaveStyle({ left: '20.32854209445585%' });
    const model = normalizeImportedProgress(metricParityExample[2])[0];
    expect(model).toMatchObject({ kind: 'hours', completed: 4169 / 60, planned: 576 });
  });

  it('does not invent an OTJ target when its denominator is absent', () => {
    show({ progressType: 6, completedTime: 60, plannedHours: 10, target: 120 });
    const view = card('Off-The-Job Hours');
    expect(view.getByText('10%')).toBeVisible();
    expect(view.getByText('Target: Not recorded')).toBeVisible();
    expect(view.getByRole('img').querySelector('i')).toBeNull();
    expect(view.queryByText(/Above|Below|On target/)).not.toBeInTheDocument();
  });

  it('shows numeric Programme progress separately from the historical timeline position', () => {
    show(metricParityExample[3]);
    const numeric = card('Programme progress'), timeline = card('Programme timeline');
    expect(numeric.getByText('14%')).toBeVisible();
    expect(numeric.getByText('Target: 0%')).toBeVisible();
    expect(numeric.getByText('14% Above')).toBeVisible();
    expect(parseFloat((numeric.getByRole('img').firstElementChild as HTMLElement).style.width)).toBeCloseTo(13.75, 12);
    expect(numeric.getByRole('img').querySelector('i')).toHaveStyle({ left: '0%' });
    expect(timeline.getByRole('img')).toHaveAccessibleName('Programme time elapsed at review snapshot: 17%');
    ['23/10/2025', '29/01/2026', '22/02/2027', '22/05/2027'].forEach(value => expect(timeline.getByText(value)).toBeVisible());
    expect(numeric.queryByText('17%')).not.toBeInTheDocument();
    expect(timeline.queryByText('14% Above')).not.toBeInTheDocument();
  });

  it('keeps numeric Programme progress usable without timeline dates or any PDF', () => {
    const value = { progressType: 7, current: 10, max: 20, target: 8 };
    show(value);
    expect(card('Programme progress').getByText('50%')).toBeVisible();
    expect(card('Programme timeline').getByText('Programme dates were not recorded in this review.')).toBeVisible();
    expect(hasImportedProgress([{ id: 'example', title: 'Learning progress', enabled: true, displayOrder: 0, estimatedMinutes: 0,
      fields: [{ id: 'progress', title: 'progress', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: { imported: true }, answer: value }] }])).toBe(true);
  });

  it('recognizes reordered source items, wrappers and strings without mutating the payload', () => {
    const source = [...metricParityExample].reverse();
    const before = JSON.stringify(source);
    const expected = normalizeImportedProgress(source);
    expect(normalizeImportedProgress(before)).toEqual(expected);
    expect(normalizeImportedProgress({ progress: source })).toEqual(expected);
    expect(expected.map(item => item.kind)).toEqual(['programme', 'timeline', 'hours', 'standard', 'activities']);
    expect(JSON.stringify(source)).toBe(before);
  });
});
