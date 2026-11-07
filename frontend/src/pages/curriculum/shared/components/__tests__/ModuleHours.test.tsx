import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModuleHoursTarget, saveModuleHoursTarget, ModuleHoursError } from '@/api/moduleHours';
import { ModuleFixedHoursCard, ModuleHoursTargetField } from '../ModuleHours';
import { useModuleHoursDraft } from '../moduleHoursState';
import { AuthContext, type RbacContextValue } from '@/hooks/useAuth.helpers';

vi.mock('@/api/moduleHours', async original => ({
  ...(await original<typeof import('@/api/moduleHours')>()),
  fetchModuleHoursTarget: vi.fn(), saveModuleHoursTarget: vi.fn(),
}));
const target = { moduleId: 'M1', targetMinutes: 30000, revision: 2, canMatch: true };

function DraftEditor() {
  const state = useModuleHoursDraft('M1', true);
  return <><ModuleHoursTargetField state={state} disabled={state.saving} /><button type="button" onClick={() => { void state.save().catch(() => {}); }}>Save target</button><span>{state.dirty ? 'Unsaved target' : 'Target unchanged'}</span></>;
}

describe('module hours comparison and target editing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target });
    vi.mocked(saveModuleHoursTarget).mockImplementation(async (moduleId, targetMinutes, revision) => ({ moduleId, targetMinutes, revision: revision + 1, canMatch: true }));
  });

  it('keeps the fixed value while component totals move below, to equal, above, and back', async () => {
    const view = render(<ModuleFixedHoursCard moduleId="M1" totalHours={490} />);
    const counter = await screen.findByRole('button', { name: /Component hours: 490 h/ });
    expect(counter).toHaveClass('text-emerald-800');
    expect(counter).toHaveTextContent('500 h');
    view.rerender(<ModuleFixedHoursCard moduleId="M1" totalHours={500} />);
    expect(counter).toHaveAttribute('title', expect.stringContaining('Target matched'));
    expect(counter).toHaveClass('text-emerald-800');
    view.rerender(<ModuleFixedHoursCard moduleId="M1" totalHours={501.5} unsaved />);
    expect(counter).toHaveClass('text-red-800');
    expect(counter).toHaveTextContent('500 h');
    expect(counter).toHaveAttribute('title', expect.stringContaining('1 h 30 min over target'));
    expect(counter).toHaveAttribute('title', expect.stringContaining('Includes unsaved component changes'));
    await userEvent.click(counter);
    expect(screen.getByText(/1 h 30 min over target/, { selector: 'p' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(counter).toHaveAttribute('aria-expanded', 'false');
    view.rerender(<ModuleFixedHoursCard moduleId="M1" totalHours={499} />);
    expect(counter).toHaveClass('text-emerald-800');
    expect(saveModuleHoursTarget).not.toHaveBeenCalled();
  });

  it('shows an unset target neutrally rather than claiming a match or zero target', async () => {
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: null });
    render(<ModuleFixedHoursCard moduleId="M1" totalHours={10} />);
    expect(await screen.findByText('Not set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Component hours: 10 h.*No fixed target set/ })).toHaveClass('text-foreground-600');
  });

  it('does not display a previous module target during a switch', async () => {
    const view = render(<ModuleFixedHoursCard moduleId="M1" totalHours={10} />);
    await screen.findByRole('button', { name: /490 h remaining/ });
    vi.mocked(fetchModuleHoursTarget).mockImplementation(() => new Promise(() => {}));
    view.rerender(<ModuleFixedHoursCard moduleId="M2" totalHours={10} />);
    expect(screen.queryByRole('button', { name: /490 h remaining/ })).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('keeps failures visible and retries without fabricating an unset target', async () => {
    vi.mocked(fetchModuleHoursTarget).mockRejectedValueOnce(new Error('Unavailable'));
    render(<ModuleFixedHoursCard moduleId="M1" totalHours={10} />);
    const retry = await screen.findByRole('button', { name: /Module hours target unavailable/ });
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
    await userEvent.click(retry);
    await screen.findByRole('button', { name: /490 h remaining/ });
  });

  it('hides target inputs unless the server explicitly grants Match Module Hours', async () => {
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, canMatch: false });
    render(<DraftEditor />);
    await waitFor(() => expect(fetchModuleHoursTarget).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Fixed planned hours/ })).not.toBeInTheDocument();
  });

  it('saves a new target in minutes with its independent revision', async () => {
    render(<DraftEditor />);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    const input = screen.getByRole('spinbutton', { name: 'Target hours' });
    fireEvent.change(input, { target: { value: '500.5' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    expect(saveModuleHoursTarget).toHaveBeenCalledWith('M1', 30030, 2);
    await screen.findByText('Target unchanged');
  });

  it('clears only the target when fixed hours are disabled', async () => {
    render(<DraftEditor />);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Set a fixed hours target/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    expect(saveModuleHoursTarget).toHaveBeenCalledWith('M1', null, 2);
  });

  it('does not turn an empty input into zero hours or a request', async () => {
    render(<DraftEditor />);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Target hours' }), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    expect(saveModuleHoursTarget).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved target')).toBeInTheDocument();
  });

  it('does not mark a target of one minute as dirty because of floating point conversion', async () => {
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: 601 });
    render(<DraftEditor />);
    await screen.findByRole('button', { name: /Fixed planned hours/ });
    expect(screen.getByText('Target unchanged')).toBeInTheDocument();
  });

  it('retains an unsaved target on refresh and offers explicit recovery after conflict', async () => {
    render(<DraftEditor />);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Target hours' }), { target: { value: '510' } });
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: 30660, revision: 3 });
    vi.mocked(saveModuleHoursTarget).mockRejectedValueOnce(new ModuleHoursError('Changed by another editor', 409));
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await screen.findByText(/The saved target is now 511 h/);
    expect(screen.getByRole('spinbutton', { name: 'Target hours' })).toHaveValue(510);
    await userEvent.click(screen.getByRole('button', { name: 'Use latest target' }));
    expect(screen.getByRole('spinbutton', { name: 'Target hours' })).toHaveValue(511);
    expect(screen.getByText('Target unchanged')).toBeInTheDocument();
  });

  it('reloads after this module target is saved but not another module', async () => {
    render(<ModuleFixedHoursCard moduleId="M1" totalHours={490} />);
    await screen.findByRole('button', { name: /10 h remaining/ });
    act(() => window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId: 'M2', canonicalId: 'M2' } })));
    expect(fetchModuleHoursTarget).toHaveBeenCalledTimes(1);
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: 28800, revision: 3 });
    act(() => window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId: 'M1', canonicalId: 'M1' } })));
    await screen.findByRole('button', { name: /10 h over target/ });
  });

  it('does not carry an unsaved target into another signed-in account', async () => {
    const context = (id: number) => ({ auth: { account: { id }, user: null } } as unknown as RbacContextValue);
    const view = render(<AuthContext.Provider value={context(1)}><DraftEditor /></AuthContext.Provider>);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Target hours' }), { target: { value: '510' } });
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: 42000, revision: 3 });
    view.rerender(<AuthContext.Provider value={context(2)}><DraftEditor /></AuthContext.Provider>);
    await userEvent.click(await screen.findByRole('button', { name: /Fixed planned hours/ }));
    expect(screen.getByRole('spinbutton', { name: 'Target hours' })).toHaveValue(700);
    expect(screen.getByText('Target unchanged')).toBeInTheDocument();
  });
});
