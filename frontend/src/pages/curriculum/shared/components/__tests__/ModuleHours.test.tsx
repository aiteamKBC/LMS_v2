import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModuleHoursTarget, saveModuleHoursTarget, ModuleHoursError } from '@/api/moduleHours';
import { ModuleHoursStrip, ModuleHoursTargetField } from '../ModuleHours';
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

  it('compares the whole module and updates from below, to equal, to exceeded, and back', async () => {
    const view = render(<ModuleHoursStrip moduleId="M1" totalHours={490} />);
    const counter = await screen.findByRole('button', { name: /Module planned hours: 490 h/ });
    expect(counter).toHaveClass('text-emerald-800');
    view.rerender(<ModuleHoursStrip moduleId="M1" totalHours={500} />);
    expect(screen.getByText('Target matched')).toBeInTheDocument();
    expect(counter).toHaveClass('text-emerald-800');
    view.rerender(<ModuleHoursStrip moduleId="M1" totalHours={501.5} unsaved />);
    expect(counter).toHaveClass('text-red-800');
    expect(counter).toHaveAttribute('title', expect.stringContaining('1 h 30 min over target'));
    expect(screen.getByText(/Includes unsaved changes/)).toBeInTheDocument();
    await userEvent.click(counter);
    expect(screen.getByText(/Adjust the component hours/)).toBeInTheDocument();
    view.rerender(<ModuleHoursStrip moduleId="M1" totalHours={499} />);
    expect(counter).toHaveClass('text-emerald-800');
  });

  it('shows an unset target neutrally rather than claiming a match or zero target', async () => {
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: null });
    render(<ModuleHoursStrip moduleId="M1" totalHours={10} />);
    expect(await screen.findByText('No fixed target set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Module planned hours: 10 h/ })).toHaveClass('text-foreground-600');
  });

  it('does not display a previous module target during a switch', async () => {
    const view = render(<ModuleHoursStrip moduleId="M1" totalHours={10} />);
    await screen.findByText('490 h remaining');
    vi.mocked(fetchModuleHoursTarget).mockImplementation(() => new Promise(() => {}));
    view.rerender(<ModuleHoursStrip moduleId="M2" totalHours={10} />);
    expect(screen.queryByText('490 h remaining')).not.toBeInTheDocument();
    expect(screen.getByText('Loading module hours…')).toBeInTheDocument();
  });

  it('keeps failures visible and retries without fabricating an unset target', async () => {
    vi.mocked(fetchModuleHoursTarget).mockRejectedValueOnce(new Error('Unavailable'));
    render(<ModuleHoursStrip moduleId="M1" totalHours={10} />);
    await screen.findByText('Module hours target unavailable');
    expect(screen.queryByText('No fixed target set')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('490 h remaining');
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
    render(<ModuleHoursStrip moduleId="M1" totalHours={490} />);
    await screen.findByText('10 h remaining');
    act(() => window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId: 'M2', canonicalId: 'M2' } })));
    expect(fetchModuleHoursTarget).toHaveBeenCalledTimes(1);
    vi.mocked(fetchModuleHoursTarget).mockResolvedValue({ ...target, targetMinutes: 28800, revision: 3 });
    act(() => window.dispatchEvent(new CustomEvent('module-hours-updated', { detail: { moduleId: 'M1', canonicalId: 'M1' } })));
    await screen.findByText('10 h over target');
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
