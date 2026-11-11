import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from './GlobalSearch';

vi.mock('@/mocks/search', () => ({
  SEARCH_CATEGORIES: [{ slug: 'pages', label: 'Pages', icon: 'ri-file-line' }],
  RECENT_SEARCHES: ['Synthetic'],
  ALL_SEARCH_RESULTS: [
    { id: 'one', label: 'Synthetic first', subtitle: 'First page', category: 'pages', categoryLabel: 'Pages', icon: 'ri-file-line', href: '/users' },
    { id: 'two', label: 'Synthetic second', subtitle: 'Second page', category: 'pages', categoryLabel: 'Pages', icon: 'ri-file-line', href: '/users/progress-transfers' },
  ],
}));

function Harness({ appearance }: { appearance?: 'enrolment' }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return <>
    <button onClick={() => setOpen(true)}>Open search</button>
    <GlobalSearch isOpen={open} onClose={() => setOpen(false)} appearance={appearance} />
    <output aria-label="Current route">{location.pathname}</output>
  </>;
}
function show(appearance?: 'enrolment') {
  return render(<MemoryRouter initialEntries={['/users/coach-directory']}><Harness appearance={appearance} /></MemoryRouter>);
}
beforeEach(() => {
  // jsdom does not implement scrolling; navigation and focus still run normally.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each([undefined, 'enrolment'] as const)('Global search controls (%s)', appearance => {
  it('opens, focuses input, selects a recent search and clears it', async () => {
    const user = userEvent.setup(); show(appearance);
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    const input = screen.getByRole('textbox', { name: 'Search workspace' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Synthetic' }));
    expect(input).toHaveValue('Synthetic'); expect(input).toHaveFocus();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Synthetic' })).toBeVisible();
  });

  it('opens the selected result with arrows and Enter and closes the search', async () => {
    const user = userEvent.setup(); show(appearance);
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    await user.type(screen.getByRole('textbox', { name: 'Search workspace' }), 'Synthetic');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/users/progress-transfers');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('navigates by clicking a result and resets the query on reopening', async () => {
    const user = userEvent.setup(); show(appearance);
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    await user.type(screen.getByRole('textbox', { name: 'Search workspace' }), 'Synthetic');
    await user.click(screen.getByRole('link', { name: /Synthetic first/ }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/users');
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('shows no results truthfully and closes with Escape from the input', async () => {
    const user = userEvent.setup(); show(appearance);
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    await user.type(screen.getByRole('textbox'), 'missing-result');
    expect(screen.getByText('No results found')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/users/coach-directory');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

it('closes the enrolment search using its close button', () => {
  show('enrolment'); fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('closes with Escape after keyboard focus moves to a dialog button', async () => {
  const user = userEvent.setup(); show('enrolment');
  await user.click(screen.getByRole('button', { name: 'Open search' }));
  const close = screen.getByRole('button', { name: 'Close search' });
  close.focus(); await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
