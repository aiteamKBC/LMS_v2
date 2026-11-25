import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculumModules } from '@/lib/curriculumApi';
import { ModuleHoursError } from '@/api/moduleHours';
import { confirmHours, previewHours, readHoursDefaults, readHoursHistory, type HoursPreview } from '@/api/moduleHoursWorkflows';
import Page from './page';

vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumModules: vi.fn() }));
vi.mock('@/api/moduleHoursWorkflows', () => ({ confirmHours: vi.fn(), previewHours: vi.fn(), readHoursDefaults: vi.fn(), readHoursHistory: vi.fn() }));
const state = { moduleId: 'M1', target: { targetMinutes: 60, revision: 2 }, default: null };
const preview: HoursPreview = { operation: 'set_targets', canConfirm: true, previewToken: 'signed', fingerprint: 'hash',
  items: [{ moduleId: 'M1', state, targetMinutes: 120, action: 'update', reason: null }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchCurriculumModules).mockResolvedValue([{ id: 'M1', moduleCatalogueId: 'M1', name: 'Synthetic module' }] as Awaited<ReturnType<typeof fetchCurriculumModules>>);
  vi.mocked(readHoursDefaults).mockResolvedValue({ canMatch: true, items: [{ moduleId: 'M1', state, reason: null, revisions: [] }] });
  vi.mocked(previewHours).mockResolvedValue(preview);
  vi.mocked(readHoursHistory).mockResolvedValue({ operations: [] });
  vi.mocked(confirmHours).mockResolvedValue({ operationId: 'operation', operation: 'set_targets', appliedAt: '2026-11-24T10:00:00Z', replayed: false,
    items: [{ moduleId: 'M1', action: 'update', before: state.target, after: { targetMinutes: 120, revision: 3 } }] });
});

async function selectAndPreview() {
  render(<MemoryRouter><Page /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Synthetic module'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '120' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  return screen.findByRole('button', { name: 'Confirm reviewed changes' });
}

describe('Module hours workflows', () => {
  it('previews revisions before explicit confirmation', async () => {
    const confirm = await selectAndPreview();
    expect(previewHours).toHaveBeenCalledWith('set_targets', [{ moduleId: 'M1', targetMinutes: 120, expectedRevision: 2 }]);
    expect(confirmHours).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(await screen.findByText('Operation saved: 1 modules reviewed.')).toBeInTheDocument();
  });
  it('keeps the same operation key on an uncertain response', async () => {
    vi.mocked(confirmHours).mockRejectedValueOnce(new Error('network'));
    fireEvent.click(await selectAndPreview());
    await screen.findByText(/Confirmation response unavailable/);
    const key = vi.mocked(confirmHours).mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed changes' }));
    await waitFor(() => expect(confirmHours).toHaveBeenCalledTimes(2));
    expect(vi.mocked(confirmHours).mock.calls[1][1]).toBe(key);
  });
  it('discards stale preview after conflict', async () => {
    vi.mocked(confirmHours).mockRejectedValue(new ModuleHoursError('stale', 409));
    fireEvent.click(await selectAndPreview());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm reviewed changes' })).not.toBeInTheDocument());
    expect(confirmHours).toHaveBeenCalledTimes(1);
  });
  it('invalidates preview when the proposed value changes', async () => {
    await selectAndPreview();
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '150' } });
    expect(screen.queryByRole('button', { name: 'Confirm reviewed changes' })).not.toBeInTheDocument();
  });
  it('blocks confirmation for a missing default', async () => {
    vi.mocked(previewHours).mockResolvedValue({ ...preview, canConfirm: false, previewToken: null,
      items: [{ ...preview.items[0], action: 'blocked', reason: 'missing_default' }] });
    expect(await selectAndPreview()).toBeDisabled();
    expect(screen.getByText(/Resolve every blocked module/)).toBeInTheDocument();
  });
  it('shows history unavailable with retry', async () => {
    vi.mocked(readHoursHistory).mockRejectedValueOnce(new Error('unavailable'));
    render(<MemoryRouter><Page /></MemoryRouter>);
    await screen.findByText('History unavailable. Retry with Refresh history.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
    expect(await screen.findByText('No operations yet.')).toBeInTheDocument();
  });
  it('does not enable mutation without a match grant', async () => {
    vi.mocked(readHoursDefaults).mockResolvedValue({ canMatch: false, items: [{ moduleId: 'M1', state, reason: null, revisions: [] }] });
    render(<MemoryRouter><Page /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText('Synthetic module'));
    await screen.findByRole('region', { name: 'Current defaults' });
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  });
});
