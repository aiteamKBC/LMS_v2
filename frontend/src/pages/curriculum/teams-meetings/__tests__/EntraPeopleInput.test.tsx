import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntraPeopleInput } from '../EntraPeopleInput';
import { searchEntraPeople } from '../entraDirectory';

vi.mock('../entraDirectory', () => ({ searchEntraPeople: vi.fn() }));
const people = [
  { id: '1', name: 'Alex Example', email: 'alex@example.invalid' },
  { id: '2', name: 'Jamie Example', email: 'jamie@example.invalid' },
];
function Picker({ single = false, initial = '' }) {
  const [value, setValue] = useState(initial);
  return <><EntraPeopleInput label="Presenter" value={value} onChange={setValue} single={single} /><output data-testid="value">{value}</output><button type="button">Outside</button></>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.mocked(searchEntraPeople).mockResolvedValue({ people, hasMore: false });
});
afterEach(() => vi.unstubAllGlobals());

it('selects a named Entra result while preserving the email payload', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.type(screen.getByRole('combobox'), 'Alex');
  await user.click(await screen.findByRole('option', { name: /Alex Example/ }));
  expect(screen.getByTestId('value')).toHaveTextContent('alex@example.invalid');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('replaces the organizer and supports arrow-up selection', async () => {
  const user = userEvent.setup();
  render(<Picker single initial="old@example.invalid" />);
  await user.type(screen.getByRole('combobox'), 'Example');
  await screen.findByRole('option', { name: /Jamie Example/ });
  await user.keyboard('{ArrowUp}{Enter}');
  expect(screen.getByTestId('value')).toHaveTextContent('jamie@example.invalid');
  expect(screen.getByTestId('value')).not.toHaveTextContent('old@example.invalid');
});

it('does not save a typed name as an email on blur', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.type(screen.getByRole('combobox'), 'Alex');
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.getByTestId('value')).toBeEmptyDOMElement();
  expect(screen.getByText(/Choose a search result/)).toBeInTheDocument();
});

it('accepts full manual emails while Entra is unavailable and deduplicates', async () => {
  const user = userEvent.setup();
  vi.mocked(searchEntraPeople).mockRejectedValue(new Error('Entra unavailable'));
  render(<Picker initial="alex@example.invalid" />);
  await user.type(screen.getByRole('combobox'), 'Alex');
  await screen.findByText('Entra unavailable');
  await user.clear(screen.getByRole('combobox'));
  await user.type(screen.getByRole('combobox'), 'ALEX@example.invalid{Enter}');
  expect(screen.getByTestId('value').textContent?.split('\n')).toHaveLength(1);
});

it('aborts stale searches and keeps newer results', async () => {
  let resolveOld!: (value: { people: typeof people; hasMore: boolean }) => void;
  vi.mocked(searchEntraPeople).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  render(<Picker />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Old' } });
  await waitFor(() => expect(searchEntraPeople).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(searchEntraPeople).mock.calls[0][1];
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New' } });
  await screen.findByRole('option', { name: /Alex Example/ });
  expect(signal?.aborted).toBe(true);
  resolveOld({ people: [{ id: 'old', name: 'Old Person', email: 'old@example.invalid' }], hasMore: false });
  await waitFor(() => expect(screen.queryByText('Old Person')).not.toBeInTheDocument());
});
