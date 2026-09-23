import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi } from '@/api/feedback';
import { FormBuilder } from './FormBuilder';

vi.mock('@/api/feedback', () => ({
  feedbackApi: {
    curriculumOptions: vi.fn(),
    getForm: vi.fn(),
    createForm: vi.fn(),
    updateForm: vi.fn(),
  },
}));

describe('FormBuilder curriculum scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(feedbackApi.curriculumOptions).mockResolvedValue({
      programmes: [{ id: 'PROG-1', name: 'Data Analyst' }, { id: 'PROG-2', name: 'Marketing' }],
      cohorts: [{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-1' }],
      groups: [{ id: 'GROUP-1', name: 'Group A', programmeId: 'PROG-1', cohortId: 'COHORT-1' }],
      modules: [{ id: 'MOD-1', name: 'Data Foundations', programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1' }],
    });
  });

  it('reveals each curriculum level only after its parent is selected', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    const programme = await screen.findByRole('combobox', { name: 'Programme' });
    const cohort = screen.getByRole('combobox', { name: 'Cohort' });
    const group = screen.getByRole('combobox', { name: 'Group' });
    const module = screen.getByRole('combobox', { name: 'Module' });
    expect(cohort).toBeDisabled();
    expect(group).toBeDisabled();
    expect(module).toBeDisabled();

    await user.selectOptions(programme, 'PROG-1');
    expect(cohort).toBeEnabled();
    await user.selectOptions(cohort, 'COHORT-1');
    expect(group).toBeEnabled();
    await user.selectOptions(group, 'GROUP-1');
    expect(module).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Data Foundations' })).toBeInTheDocument();
  });

  it('shows a retry action when curriculum options fail to load', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.curriculumOptions)
      .mockRejectedValueOnce(new Error('Curriculum options are temporarily unavailable.'))
      .mockResolvedValueOnce({ programmes: [], cohorts: [], groups: [], modules: [] });

    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Curriculum options are temporarily unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(feedbackApi.curriculumOptions).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('combobox', { name: 'Programme' })).toBeEnabled();
  });
});
