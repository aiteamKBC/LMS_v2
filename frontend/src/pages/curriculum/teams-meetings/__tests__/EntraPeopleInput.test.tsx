import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntraPeopleInput } from '../EntraPeopleInput';
import { searchEntraPeople } from '../entraDirectory';
import { TeamsPeopleFields } from '../createCalendarForm';

vi.mock('../entraDirectory', () => ({ searchEntraPeople: vi.fn() }));
const people = [
  { id: '1', name: 'Alex Example', email: 'alex@example.invalid' },
  { id: '2', name: 'Jamie Example', email: 'jamie@example.invalid' },
];
function Picker({ single = false, initial = '', includeGuests = false, showCount = false }) {
  const [value, setValue] = useState(initial);
  return <><EntraPeopleInput label="Presenter" value={value} onChange={setValue} single={single} includeGuests={includeGuests} showCount={showCount} /><output data-testid="value">{value}</output><button type="button">Outside</button></>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.mocked(searchEntraPeople).mockResolvedValue({ people, hasMore: false });
});
afterEach(() => vi.unstubAllGlobals());

it('counts unique committed emails after manual entry, paste, removal and undo', async () => {
  const user = userEvent.setup();
  render(<Picker showCount initial={'alex@example.invalid\nALEX@example.invalid\ninvalid'} />);
  const count = screen.getByLabelText('Presenter selected count');
  expect(count).toHaveTextContent('1 selected');
  await user.type(screen.getByRole('combobox'), 'jamie@example.invalid{Enter}');
  expect(count).toHaveTextContent('2 selected');
  await user.click(screen.getByRole('button', { name: 'Remove jamie@example.invalid' }));
  expect(count).toHaveTextContent('1 selected');
  await user.keyboard('{Control>}z{/Control}');
  expect(count).toHaveTextContent('2 selected');
  await user.click(screen.getByRole('combobox'));
  await user.paste('guest@example.invalid; jamie@example.invalid');
  expect(count).toHaveTextContent('3 selected');
  await user.type(screen.getByRole('combobox'), 'Uncommitted name');
  expect(count).toHaveTextContent('3 selected');
});

it('shows the attendee count when the shared create/edit fields are prefilled', async () => {
  function MeetingFields() {
    const [form, setForm] = useState({ attendees: '', presenters: '', coOrganizers: '', recording: 'record', lobbyBypass: 'everyone', spokenLanguage: 'en-GB' });
    return <TeamsPeopleFields form={form} patch={change => setForm(previous => ({ ...previous, ...change }))}
      onPrefill={() => setForm(previous => ({ ...previous, attendees: 'one@example.invalid\nONE@example.invalid\ntwo@example.invalid' }))} />;
  }
  render(<MeetingFields />);
  expect(screen.getByLabelText('Attendees selected count')).toHaveTextContent('0 selected');
  await userEvent.click(screen.getByRole('button', { name: /Prefill from/ }));
  expect(screen.getByLabelText('Attendees selected count')).toHaveTextContent('2 selected');
  await userEvent.click(screen.getByRole('button', { name: 'Remove two@example.invalid' }));
  expect(screen.getByLabelText('Attendees selected count')).toHaveTextContent('1 selected');
});

it('selects a named Entra result while preserving the email payload', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  await user.type(screen.getByRole('combobox'), 'Alex');
  await user.click(await screen.findByRole('option', { name: /Alex Example/ }));
  expect(screen.getByTestId('value')).toHaveTextContent('alex@example.invalid');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(searchEntraPeople).toHaveBeenCalledWith('Alex', expect.any(AbortSignal), false);
});

it('requests guests only from the attendee field', async () => {
  render(<TeamsPeopleFields
    form={{ lobbyBypass: 'everyone', recording: 'none', spokenLanguage: 'en-GB', presenters: '', coOrganizers: '', attendees: '' }}
    patch={vi.fn()}
  />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Presenters' }), { target: { value: 'Member' } });
  await waitFor(() => expect(searchEntraPeople).toHaveBeenCalledWith('Member', expect.any(AbortSignal), false));
  fireEvent.change(screen.getByRole('combobox', { name: 'Attendees' }), { target: { value: 'Guest' } });
  await waitFor(() => expect(searchEntraPeople).toHaveBeenCalledWith('Guest', expect.any(AbortSignal), true));
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

it('restores the last removed email with Ctrl+Z in its original position', async () => {
  const user = userEvent.setup();
  render(<Picker initial={'first@example.invalid\nremoved@example.invalid\nlast@example.invalid'} />);
  await user.click(screen.getByRole('button', { name: 'Remove removed@example.invalid' }));
  expect(screen.queryByRole('button', { name: 'Remove removed@example.invalid' })).not.toBeInTheDocument();
  await user.keyboard('{Control>}z{/Control}');
  expect(screen.getByTestId('value').textContent?.split('\n')).toEqual([
    'first@example.invalid', 'removed@example.invalid', 'last@example.invalid',
  ]);
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
