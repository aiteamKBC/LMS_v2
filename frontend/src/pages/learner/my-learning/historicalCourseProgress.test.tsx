import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { SubjectCard } from './SubjectWorkspace';
import { buildUnifiedLearningSummary, subjectsFrom, type Subject } from './learningSummary';

const reference = { percent: 92, capturedAt: '2026-10-30T12:00:00+00:00' };
afterEach(cleanup);

describe('component-derived course progress', () => {
  it('shows only activity completion and updates it independently of the saved old percentage', () => {
    const subject: Subject = { id: 'legacy:50', title: 'Synthetic course', source: 'legacy', activities: [],
      legacyProgressReference: reference, acceptedHours: 2,
      card: { activityCount: 2, completedActivityCount: 1, progress: 50, status: 'In progress', finalTestPassed: false } };
    const view = (value: Subject) => <MemoryRouter><SubjectCard subject={value} onOpen={vi.fn()} template={null} csrfToken="" /></MemoryRouter>;
    const { rerender } = render(view(subject));
    expect(screen.queryByText(/Old LMS progress:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Historical course progress')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 completed')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /activities progress/ })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('In progress')).toBeVisible();
    expect(screen.getByText('Completed 2h')).toBeVisible();
    rerender(view({ ...subject, card: { ...subject.card!, completedActivityCount: 2, progress: 100, status: 'Completed' } }));
    expect(screen.queryByText(/Old LMS progress:/)).not.toBeInTheDocument();
    expect(screen.getByText('2 of 2 completed')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /activities progress/ })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('Completed', { exact: true })).toBeVisible();
    expect(screen.getByText('Completed 2h')).toBeVisible();
  });

  it('never uses a zero, full, unavailable or invalid snapshot to change component completion', () => {
    const subject: Subject = { id: 'legacy:50', title: 'Synthetic course', source: 'legacy', activities: [],
      card: { activityCount: 2, completedActivityCount: 1, progress: 50, status: 'In progress', finalTestPassed: false } };
    const view = (value: Subject['legacyProgressReference']) => <MemoryRouter><SubjectCard subject={{ ...subject, legacyProgressReference: value }} onOpen={vi.fn()} template={null} csrfToken="" /></MemoryRouter>;
    const { rerender } = render(view(undefined));
    for (const value of [undefined, { ...reference, percent: 0 }, { ...reference, percent: 100 },
      { ...reference, percent: 101 }, { ...reference, percent: Number.NaN },
      { ...reference, capturedAt: 'invalid' }]) {
      rerender(view(value));
      expect(screen.queryByLabelText('Historical course progress')).not.toBeInTheDocument();
      expect(screen.queryByText(/Old LMS progress:/)).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /activities progress/ })).toHaveAttribute('aria-valuenow', '50');
      expect(screen.getByText('1 of 2 completed')).toBeVisible();
      expect(screen.getByText('In progress')).toBeVisible();
    }
  });

  it('passes the reference through detailed historical subjects without changing summary totals', () => {
    const data = { subjects: [{ id: 50, name: 'Old', legacyProgressReference: reference }],
      activities: [], progress_basis: 'catalogue_activities' } as unknown as StudentActivityResponse;
    const before = buildUnifiedLearningSummary({ ...data, subjects: [{ id: 50, name: 'Old' }] }, null);
    const after = buildUnifiedLearningSummary(data, null);
    expect(after.subjects[0].legacyProgressReference).toEqual(reference);
    expect({ ...after, subjects: [] }).toEqual({ ...before, subjects: [] });
    const selected = subjectsFrom(null, null, { covers: {}, current_subjects: [{ id: 'M1', title: 'Current' }],
      legacy_progress_references: { 'current:M1': reference } });
    expect(selected[0].legacyProgressReference).toEqual(reference);
    expect(selected[0].activities).toEqual([]);
  });
});
