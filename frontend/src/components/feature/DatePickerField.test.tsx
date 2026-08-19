import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DatePickerField } from './DatePickerField';

function Harness({ initial = '', min, max }: { initial?: string; min?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <DatePickerField label="Start date" value={value} onChange={setValue} min={min} max={max} />
      <output data-testid="value">{value}</output>
      <button type="button">outside</button>
    </div>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Start date' });
const committed = () => screen.getByTestId('value').textContent;

describe('DatePickerField typing', () => {
  it('commits a full dd/mm/yyyy entry as it is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '19/08/2026');
    expect(committed()).toBe('2026-08-19');
  });

  it('accepts shorthand separators, two-digit years and bare digit runs on blur', async () => {
    const user = userEvent.setup();
    for (const [typed, expected] of [
      ['19-8-26', '2026-08-19'],
      ['2026-08-19', '2026-08-19'],
      ['19082026', '2026-08-19'],
      ['190826', '2026-08-19'],
      ['19 Aug 2026', '2026-08-19'],
      ['sept 3 2026', '2026-09-03'],
    ] as const) {
      const view = render(<Harness />);
      await user.type(field(), typed);
      await user.tab();
      expect(committed(), `typed ${typed}`).toBe(expected);
      view.unmount();
    }
  });

  it('normalises the text to dd/mm/yyyy once the field loses focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '19-8-26');
    await user.tab();
    expect(field()).toHaveValue('19/08/2026');
  });

  it('rejects impossible dates without committing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '31/02/2026');
    await user.tab();
    expect(committed()).toBe('');
    expect(screen.getByText('Use dd/mm/yyyy')).toBeInTheDocument();
  });

  it('refuses a typed date outside min/max and explains the bound', async () => {
    const user = userEvent.setup();
    render(<Harness min="2026-09-01" max="2026-12-31" />);
    await user.type(field(), '19/08/2026');
    await user.tab();
    expect(committed()).toBe('');
    expect(screen.getByText('Cannot be before 01/09/2026')).toBeInTheDocument();
  });

  it('clears the value when the text is emptied', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.clear(field());
    await user.tab();
    expect(committed()).toBe('');
  });
});

describe('DatePickerField month and year jumping', () => {
  it('jumps to a month without stepping through the arrows', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Choose month' }));
    await user.click(screen.getByRole('button', { name: 'November' }));
    expect(screen.getByRole('button', { name: 'Choose month' })).toHaveTextContent('November');
    await user.click(screen.getByRole('button', { name: /\b19 November 2026/ }));
    expect(committed()).toBe('2026-11-19');
  });

  it('cascades year to month to day', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Choose year' }));
    // The year page is centred on the current year, so 2029 is on screen.
    await user.click(screen.getByRole('button', { name: '2029' }));
    // Choosing a year hands off to the month grid rather than closing.
    await user.click(screen.getByRole('button', { name: 'March' }));
    await user.click(screen.getByRole('button', { name: /\b4 March 2029/ }));
    expect(committed()).toBe('2029-03-04');
  });

  it('pages the year grid a dozen years at a time', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Choose year' }));
    expect(screen.getByRole('button', { name: '2021' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous years' }));
    expect(screen.getByRole('button', { name: '2009' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next years' }));
    expect(screen.getByRole('button', { name: '2021' })).toBeInTheDocument();
  });

  it('disables year and month cells that fall outside min/max', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" min="2026-08-01" max="2026-10-31" />);
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Choose month' }));
    expect(screen.getByRole('button', { name: 'November' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'September' })).toBeEnabled();
  });
});

describe('DatePickerField keyboard navigation', () => {
  it('steps into the grid with ArrowDown and selects with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /\b19 August 2026/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /\b20 August 2026/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(committed()).toBe('2026-08-20');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves a week with ArrowUp and a month with PageDown', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('button', { name: /\b12 August 2026/ })).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(screen.getByRole('button', { name: /\b12 September 2026/ })).toHaveFocus();
    await user.keyboard('{Shift>}{PageDown}{/Shift}');
    expect(screen.getByRole('button', { name: /\b12 September 2027/ })).toHaveFocus();
  });

  it('closes on Escape and leaves the value alone', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-08-19" />);
    await user.click(field());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(committed()).toBe('2026-08-19');
  });
});
