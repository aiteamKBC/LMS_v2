import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportedReviewSection } from './ImportedReviewSection';
import { aptemHistoricalProgressPresentation, normalizeImportedProgressData } from './presentation';
import { metricParityExample } from './presentationFixtures';

afterEach(cleanup);

const sourceExample = [
  { progressType: 2, current: 41, max: 95, target: 55, completedCount: 48, totalCount: 95, targetCount: 55, requiredCount: 0 },
  { progressType: 4, title: 'Example apprenticeship Standard', current: 41.397598395069686, max: 100, target: 63.19003813984633, submitted: 41.397598395069686 },
  { progressType: 6, completedTime: 17759, current: 17759, minimumRequiredTime: 33420, plannedHours: 576, forecastTime: 38219, target: 19870.22587268994, max: 34560 },
  { progressType: 7, current: 35.16483516483517, max: 100, target: 0, startDate: '2025-10-23T00:00:00', currentDate: '2026-07-30T11:47:00', plannedEndDate: '2027-02-22T00:00:00', expectedEndDate: '2027-07-22T00:00:00' },
];

function show(value: unknown) {
  return render(<ImportedReviewSection section={{ id: 'historical-progress', name: 'Learning progress', order: 0,
    fields: [{ label: 'progress', value }], tables: [], rawText: '', historicalPresentation: true }} />);
}
function card(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('article')!);
}

describe('Aptem historical web progress presentation', () => {
  it.each([
    [41, 95, 48, 55, 47], [19, 143, 37, 24, 106], [14, 87, 29, 20, 58],
  ])('shows activity counts instead of current/max (%s/%s)', (current, total, completed, target, remaining) => {
    const source = Object.freeze({ progressType: 2, current, max: total, target, completedCount: completed, totalCount: total, targetCount: target });
    const data = normalizeImportedProgressData(source);
    expect(data.source).toEqual(source);
    expect(data.cards[0]).toMatchObject({ percentage: current / total * 100, targetPercentage: target / total * 100 });
    show(source);
    const view = card('Learning Plan Activities');
    const ring = view.getByRole('img', { name: `${completed} of ${total} activities completed` });
    expect(ring).toBeVisible();
    expect(ring.querySelector('[pathLength]')).toHaveAttribute('stroke-dasharray', `${completed / total * 100} 100`);
    for (const [label, value] of [['Completed', completed], ['Remaining', remaining], ['Target', target]]) {
      expect(view.getByText(String(label)).nextElementSibling).toHaveTextContent(String(value));
    }
    expect(view.getByText('Submitted').nextElementSibling).toHaveTextContent('Not recorded');
    expect(view.queryByText(/%|Below|Above/)).not.toBeInTheDocument();
    expect(source.current).toBe(current);
  });

  it.each([{ submittedCount: 0 }, { submitted: 0 }, { submittedCount: 2 }])('uses only recorded activity submissions: %j', submitted => {
    show([{ ...sourceExample[0], ...submitted }, sourceExample[1]]);
    const view = card('Learning Plan Activities');
    expect(view.getByText('Submitted').nextElementSibling).toHaveTextContent(String(submitted.submittedCount ?? submitted.submitted));
    expect(view.getByText('Remaining').nextElementSibling).toHaveTextContent(String(47 - (submitted.submittedCount ?? submitted.submitted ?? 0)));
  });

  it('honours recorded remaining and keeps count targets separate from percentage targets', () => {
    show({ ...sourceExample[0], target: 70, targetCount: 55, remainingCount: 12 });
    const view = card('Learning Plan Activities');
    expect(view.getByText('Remaining').nextElementSibling).toHaveTextContent('12');
    expect(view.getByText('Target').nextElementSibling).toHaveTextContent('55');
    expect(view.queryByText('70')).not.toBeInTheDocument();
  });

  it('does not invent completion counts from current, or a ring ratio from a zero denominator', () => {
    const { rerender } = show({ progressType: 2, current: 41, max: 95, totalCount: 95 });
    expect(card('Learning Plan Activities').getByRole('img')).toHaveAccessibleName('Not recorded of 95 activities completed');
    expect(card('Learning Plan Activities').getByRole('img').querySelector('[pathLength]')).toBeNull();
    rerender(<ImportedReviewSection section={{ id: 'empty', name: 'Learning progress', order: 0, historicalPresentation: true,
      fields: [{ label: 'progress', value: { progressType: 2, completedCount: 0, totalCount: 0 } }], tables: [], rawText: '' }} />);
    expect(card('Learning Plan Activities').getByRole('img')).toHaveAccessibleName('0 of 0 activities completed');
    expect(card('Learning Plan Activities').getByRole('img').querySelector('[pathLength]')).toBeNull();
  });

  it('shows the Standard title, source percentage, semantic state and exact target marker', () => {
    const data = normalizeImportedProgressData(sourceExample);
    expect(data.cards[1]).toMatchObject({ targetPercentage: sourceExample[1].target,
      variancePercentage: Number(sourceExample[1].current) - Number(sourceExample[1].target) });
    show(sourceExample);
    const view = card('Progress');
    expect(view.getByText('Example apprenticeship Standard')).toBeVisible();
    expect(view.getByText('41%')).toBeVisible();
    expect(view.getByText('Behind')).toBeVisible();
    expect(view.getByRole('img').querySelector('i')).toHaveStyle({ left: '63.19003813984633%' });
    expect(view.queryByText(/Target:|Below|Above/)).not.toBeInTheDocument();
  });

  it.each([[10, 'On track'], [9.9, 'Behind'], [10.1, 'Ahead']] as const)('uses exact source direction for Standard: %s', (current, status) => {
    show({ progressType: 4, current, max: 100, target: 10 });
    expect(card('Progress').getByText(status)).toBeVisible();
  });

  it('does not invent a Standard status without a target', () => {
    show({ progressType: 4, current: 41, max: 100 });
    expect(card('Progress').queryByText(/Behind|Ahead|On track/)).not.toBeInTheDocument();
    expect(card('Progress').getByRole('img').querySelector('i')).toBeNull();
  });

  it('preserves every decoded source field and all numeric Programme/OTJ metrics while selecting only historical cards', () => {
    const source = Object.freeze({ progress: sourceExample.map(item => Object.freeze({ ...item })), captureMetadata: { version: 6 } });
    const before = JSON.stringify(source);
    const data = normalizeImportedProgressData(before);
    const cardsBefore = JSON.stringify(data.cards);
    expect(data.source).toEqual(source);
    expect(data.cards.find(c => c.kind === 'programme')).toMatchObject({ percentage: 35.16483516483517, targetPercentage: 0, variancePercentage: 35.16483516483517 });
    expect(data.cards.find(c => c.kind === 'hours')).toMatchObject({ targetPercentage: 19870.22587268994 / 34560 * 100 });
    expect(aptemHistoricalProgressPresentation(data).map(c => c.kind)).toEqual(['activities', 'standard', 'timeline', 'hours']);
    expect(JSON.stringify(data.cards)).toBe(cardsBefore);
    expect(JSON.stringify(source)).toBe(before);
    show(source);
    expect(screen.queryByRole('heading', { name: 'Programme progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('35% Above')).not.toBeInTheDocument();
    const timeline = card('Programme timeline');
    ['23/10/2025', '30/07/2026', '22/02/2027', '22/07/2027'].forEach(value => expect(timeline.getByText(value)).toBeVisible());
    expect(timeline.getByRole('img')).toHaveAccessibleName('Programme time elapsed at review snapshot: 44%');
    expect(timeline.queryByText('44%')).not.toBeInTheDocument();
  });

  it('shows OTJ overall progress and hours without promoting its target and variance', () => {
    show(sourceExample);
    const view = card('Off-The-Job Hours');
    expect(view.getByText('Overall Progress')).toBeVisible();
    expect(view.getByText('51%').parentElement).toHaveTextContent('51% (296h)');
    ['557h', '576h', '296h', '637h'].forEach(value => expect(view.getByText(value)).toBeVisible());
    expect(view.queryByText(/Target:|Below|Above/)).not.toBeInTheDocument();
    expect(view.getByRole('img').querySelector('i')).toBeNull();
  });

  it('orders the historical cards independently of export order without removing source items', () => {
    const source = [...metricParityExample].reverse();
    show(JSON.stringify(source));
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Learning Plan Activities', 'Progress', 'Programme timeline', 'Off-The-Job Hours']);
    expect(normalizeImportedProgressData({ progress: source }).source).toEqual({ progress: source });
  });

  it('keeps missing dates explicit and does not substitute numeric Programme progress', () => {
    show({ progressType: 7, current: 35, max: 100, target: 0 });
    expect(screen.queryByText('35%')).not.toBeInTheDocument();
    expect(card('Programme timeline').getByText('Programme dates were not recorded in this review.')).toBeVisible();
  });

  it('does not fabricate progress in an MCM summary without a progress section', () => {
    render(<ImportedReviewSection section={{ id: 'summary', name: 'Meeting Summary', order: 0, historicalPresentation: true,
      fields: [{ label: 'Summary', value: '<p>Recorded discussion</p>' }], tables: [], rawText: '' }} />);
    expect(screen.getByText('Recorded discussion')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Learning Plan Activities' })).not.toBeInTheDocument();
  });
});
