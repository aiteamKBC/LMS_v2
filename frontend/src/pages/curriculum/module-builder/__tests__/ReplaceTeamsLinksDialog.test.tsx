import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReplaceTeamsLinksDialog } from '../ReplaceTeamsLinksDialog';
import type { ModuleWeek } from '../moduleAuthoringData';

const weeks = [
  { id: 'W1', weekNumber: 1, title: 'First', components: [{ id: 'C1', type: 'live-session', settings: { liveSessionUrl: 'https://old.example/join' } }] },
  { id: 'W2', weekNumber: 2, title: 'Second', components: [{ id: 'C2', type: 'video', settings: {} }] },
] as unknown as ModuleWeek[];

describe('ReplaceTeamsLinksDialog', () => {
  it('requires a link and selected live weeks before applying', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<ReplaceTeamsLinksDialog weeks={weeks} onClose={vi.fn()} onApply={onApply} />);

    const replace = screen.getByRole('button', { name: /Replace .*link/ });
    expect(replace).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Week 1' }));
    expect(replace).toBeDisabled();
    await user.type(screen.getByLabelText('New Teams meeting link'), 'https://teams.example/join');
    expect(replace).toBeEnabled();
    await user.click(replace);

    expect(onApply).toHaveBeenCalledWith(['W1'], 'https://teams.example/join');
  });

  it('selects only weeks containing replaceable live sessions', async () => {
    const user = userEvent.setup();
    render(<ReplaceTeamsLinksDialog weeks={weeks} onClose={vi.fn()} onApply={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole('button', { name: 'Select live weeks' }));
    expect(screen.getByRole('checkbox', { name: 'Week 1' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Week 2' })).not.toBeChecked();
  });

  it('stays open and says why when the save is refused', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onApply = vi.fn().mockRejectedValue(new Error('The Teams links could not be saved. Nothing was changed.'));
    render(<ReplaceTeamsLinksDialog weeks={weeks} onClose={onClose} onApply={onApply} />);

    await user.click(screen.getByRole('checkbox', { name: 'Week 1' }));
    await user.type(screen.getByLabelText('New Teams meeting link'), 'https://teams.example/join');
    await user.click(screen.getByRole('button', { name: /Replace .*link/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Replace 1 link/ })).toBeEnabled();
  });

  it('cannot be closed or applied twice while the save is in flight', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onApply = vi.fn(() => new Promise<void>(() => {}));
    render(<ReplaceTeamsLinksDialog weeks={weeks} onClose={onClose} onApply={onApply} />);

    await user.click(screen.getByRole('checkbox', { name: 'Week 1' }));
    await user.type(screen.getByLabelText('New Teams meeting link'), 'https://teams.example/join');
    await user.click(screen.getByRole('button', { name: /Replace .*link/ }));

    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
