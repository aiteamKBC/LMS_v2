import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectMenu, type SelectOption } from './SelectField';

const PROGRAMMES: SelectOption[] = [
  { value: 'mba', label: 'MBA', description: 'Level 4' },
  { value: 'test-user-flow', label: 'TEST USER FLOW' },
  { value: 'data-analyst', label: 'Data Analyst', disabled: true },
];

function Harness({
  initial = '',
  options = PROGRAMMES,
  searchable,
  clearable,
}: {
  initial?: string;
  options?: SelectOption[];
  searchable?: boolean;
  clearable?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <SelectMenu
        value={value}
        onChange={setValue}
        options={options}
        placeholder="Select a programme"
        ariaLabel="Programme"
        searchable={searchable}
        clearable={clearable}
      />
      <output data-testid="value">{value}</output>
      <button type="button">outside</button>
    </div>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Programme' });
const committed = () => screen.getByTestId('value').textContent;

describe('SelectMenu', () => {
  it('shows the placeholder until an option is picked, then the option label', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(trigger()).toHaveTextContent('Select a programme');

    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /MBA/ }));

    expect(committed()).toBe('mba');
    expect(trigger()).toHaveTextContent('MBA');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens and commits from the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(trigger()).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(committed()).toBe('test-user-flow');
  });

  it('skips disabled options when arrowing and refuses to select one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    const disabledOption = screen.getByRole('option', { name: /Data Analyst/ });
    expect(disabledOption).toBeDisabled();

    // MBA -> TEST USER FLOW -> (Data Analyst skipped) -> MBA
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(committed()).toBe('mba');
  });

  it('closes on Escape and hands focus back to the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(committed()).toBe('');
  });

  it('closes without selecting when the click lands outside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'outside' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(committed()).toBe('');
  });

  it('filters the list from the search box', async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(trigger());

    await user.keyboard('flow');
    expect(screen.getByRole('option', { name: /TEST USER FLOW/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /MBA/ })).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(committed()).toBe('test-user-flow');
  });

  it('says so when nothing matches instead of showing an empty panel', async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(trigger());
    await user.keyboard('zzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nothing matches that')).toBeInTheDocument();
  });

  it('offers a clear row that puts the value back to empty', async () => {
    const user = userEvent.setup();
    render(<Harness initial="mba" clearable />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Select a programme' }));

    expect(committed()).toBe('');
    expect(trigger()).toHaveTextContent('Select a programme');
  });

  it('turns the search box on by itself once the list gets long', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, index) => ({ value: `p${index}`, label: `Programme ${index}` }));
    render(<Harness options={many} />);
    await user.click(trigger());

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
