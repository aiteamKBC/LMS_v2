import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi } from '@/api/feedback';
import { FormBuilder } from './FormBuilder';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe('post-lecture feedback delivery scope', () => {
  it('defaults to the fixed all-modules form and loads curriculum only for a module override', async () => {
    const curriculum = vi.spyOn(feedbackApi, 'curriculumOptions').mockResolvedValue({
      programmes: [{ id: 'PROG-1', name: 'Data' }],
      cohorts: [], groups: [], modules: [{ id: 'MOD-1', name: 'Foundations', programmeId: 'PROG-1', cohortId: 'C-1', groupId: 'G-1' }],
    });
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    expect(screen.getByRole('combobox', { name: /delivery scope/i })).toHaveValue('all_modules');
    expect(screen.queryByRole('combobox', { name: 'Programme' })).not.toBeInTheDocument();
    expect(curriculum).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /delivery scope/i }), 'module');

    expect(await screen.findByRole('combobox', { name: 'Programme' })).toBeInTheDocument();
    await waitFor(() => expect(curriculum).toHaveBeenCalledTimes(1));
  });
});
