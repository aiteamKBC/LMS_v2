import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import * as api from '@/api/studentActivity';
import { ModulesTab, StudentActivityPanel } from './page';

// AppIcon is normally supplied by the app build's auto-import plugin.
vi.stubGlobal('AppIcon', () => <span />);

const data: StudentActivityResponse = {
  learner_name: 'Anna Rundell', count: 2, unique_activity_count: 2,
  module_count: 1, completed_count: 1, actual_total: 0, planned_total: null,
  mapped_count: 1, planned_mapped_count: 0,
  activities: [
    { activity_id: 'la:1:10', source_activity_id: 10, group_id: 1, group_name: 'Leadership',
      date: null, category: 'video', activity: 'Introduction', status: 'completed',
      completed: true, actual: 0, planned: 0, hours_mapped: true, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
    { activity_id: 'la:1:11', source_activity_id: 11, group_id: 1, group_name: 'Leadership',
      date: null, category: 'reading', activity: 'Reflection', status: null,
      completed: false, actual: 0, planned: 0, hours_mapped: false, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
  ],
};

describe('learner subject cards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads on opening Modules and ignores an old learner response after navigation', async () => {
    let resolveAnna!: (value: StudentActivityResponse) => void;
    const fetch = vi.spyOn(api, 'fetchStudentActivity')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAnna = resolve; }))
      .mockResolvedValueOnce({ ...data, learner_name: 'Amy-Marie Field' });
    const real = { studentActivityAvailable: true } as LearnerDetail;
    const { rerender } = render(<ModulesTab key="132" real={real} loading={false} loadError={null} kind="commercial" id="132" showReadOnlyNotice={false} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('commercial', '132', expect.any(AbortSignal)));
    rerender(<ModulesTab key="133" real={real} loading={false} loadError={null} kind="commercial" id="133" showReadOnlyNotice={false} />);
    expect(await screen.findByText('Amy-Marie Field')).toBeInTheDocument();
    await act(async () => { resolveAnna(data); });
    expect(screen.queryByText('Anna Rundell')).not.toBeInTheDocument();
    expect(fetch.mock.calls[0][2]?.aborted).toBe(true);
  });
  it('opens a subject card and distinguishes missing OTJH from recorded zero', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Anna Rundell')).toBeInTheDocument();
    expect(within(screen.getByText('Planned OTJH').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(within(screen.getByText('Recorded OTJH').parentElement!).queryByText('Unavailable')).not.toBeInTheDocument();
    const module = screen.getByRole('button', { name: /Leadership/ });
    fireEvent.click(module);
    expect(screen.getByRole('button', { name: 'All subjects' })).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Not complete')).toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
    expect(screen.getByText(/OTJH: Unavailable/)).toBeInTheDocument();
  });

  it('filters activities without changing the full module completion or hours summary', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Reflection' } });
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expect(screen.getByText('1 of 2 completed')).toBeInTheDocument();
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
  });

  it('offers retry on a failed fetch', () => {
    const retry = vi.fn();
    render(<StudentActivityPanel data={null} loading={false} error="Database unavailable" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
