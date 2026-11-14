import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QualityModal from './QualityModal';
import RecordingSelect from './RecordingSelect';

const options = Array.from({ length: 10 }, (_, index) => ({ value: String(index), label: `Answer ${index}` }));

describe('recording dropdowns in quality dialogs', () => {
  it('keeps search and keyboard selection inside the modal and closes only the menu on Escape', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onClose = vi.fn();
    render(<><button>Outside</button><QualityModal title="Review" onClose={onClose}>
      <RecordingSelect ariaLabel="Answer" value="0" options={options} onChange={onChange} />
    </QualityModal></>);
    const trigger = screen.getByRole('combobox', { name: 'Answer' });
    await user.click(trigger);
    const search = screen.getByRole('textbox', { name: 'Type to filter...' });
    expect(search).toHaveFocus();
    await user.type(search, 'Answer 8');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('8');
    expect(trigger).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(screen.getByRole('button', { name: 'Close Review' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses an open popup when saving disables its field', () => {
    const onChange = vi.fn();
    const field = (disabled: boolean) => <RecordingSelect ariaLabel="Answer" value="0" options={options} onChange={onChange} disabled={disabled} />;
    const view = render(field(false));
    fireEvent.click(screen.getByRole('combobox', { name: 'Answer' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    view.rerender(field(true));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Answer' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
