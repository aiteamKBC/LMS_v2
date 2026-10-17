import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi } from '@/api/feedback';
import { FormBuilder } from './FormBuilder';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe('post-lecture feedback delivery scope', () => {
  it('creates a five-star rating with a description for every score and previews it', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Question 1 type' }), 'rating');
    expect(screen.getByRole('combobox', { name: 'Rating style' })).toHaveValue('stars');

    const labels = ['Very limited knowledge', 'Basic awareness', 'Moderate understanding', 'Good understanding', 'Very confident'];
    for (const [index, label] of labels.entries()) {
      await user.type(screen.getByRole('textbox', { name: `${index + 1} star description` }), label);
    }

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('radio', { name: '1 star: Very limited knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '5 stars: Very confident' })).toBeInTheDocument();
    const scale = screen.getByLabelText('Rating scale descriptions');
    expect(scale).toHaveTextContent('1 = Very limited knowledge');
    expect(scale).toHaveTextContent('5 = Very confident');
  });

  it('lets the creator choose section icons and previews sections as steps', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FormBuilder /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: '+ Add Section' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 2 icon' }), 'ri-chat-3-line');
    await user.clear(screen.getByRole('textbox', { name: 'Section 2 title' }));
    await user.type(screen.getByRole('textbox', { name: 'Section 2 title' }), 'Your thoughts');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('navigation', { name: 'Form progress' })).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

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
