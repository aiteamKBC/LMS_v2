import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchOwnModuleHoursAccess, fetchAccountModuleHoursAccess, saveAccountModuleHoursAccess } from '@/api/moduleHours';
import { ModuleHoursAccessPanel } from './ModuleHoursAccessPanel';

vi.mock('@/api/moduleHours', () => ({ fetchOwnModuleHoursAccess: vi.fn(), fetchAccountModuleHoursAccess: vi.fn(), saveAccountModuleHoursAccess: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchOwnModuleHoursAccess).mockResolvedValue({ canMatch: false, canManage: true, revision: 1 });
  vi.mocked(fetchAccountModuleHoursAccess).mockResolvedValue({ canMatch: false, canManage: false, revision: 0 });
  vi.mocked(saveAccountModuleHoursAccess).mockResolvedValue({ canMatch: true, canManage: false, revision: 1 });
});

it('offers delegation only when explicitly granted by the server', async () => {
  vi.mocked(fetchOwnModuleHoursAccess).mockResolvedValue({ canMatch: true, canManage: false, revision: 1 });
  render(<ModuleHoursAccessPanel accountId={20} isAdmin />);
  await waitFor(() => expect(fetchOwnModuleHoursAccess).toHaveBeenCalled());
  expect(fetchAccountModuleHoursAccess).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('grants Match Module Hours by account identity without changing workspace access', async () => {
  render(<ModuleHoursAccessPanel accountId={20} isAdmin={false} />);
  await userEvent.click(await screen.findByRole('checkbox', { name: /Match Module Hours/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save hours permissions' }));
  await screen.findByText('Hours permissions saved.');
  expect(saveAccountModuleHoursAccess).toHaveBeenCalledWith(20, { canMatch: true, canManage: false, revision: 0 });
  expect(screen.queryByRole('checkbox', { name: /Manage module hours permissions/ })).not.toBeInTheDocument();
});

it('retains the selected permission and reports a refused save', async () => {
  vi.mocked(saveAccountModuleHoursAccess).mockRejectedValue(new Error('Permission revoked'));
  render(<ModuleHoursAccessPanel accountId={20} isAdmin />);
  await userEvent.click(await screen.findByRole('checkbox', { name: /Match Module Hours/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save hours permissions' }));
  await screen.findByText(/Permission revoked/);
  expect(screen.getByRole('checkbox', { name: /Match Module Hours/ })).toBeChecked();
  expect(screen.queryByText('Hours permissions saved.')).not.toBeInTheDocument();
});

it('lets a manager revoke delegation after the target loses administrator workspace access', async () => {
  vi.mocked(fetchAccountModuleHoursAccess).mockResolvedValue({ canMatch: false, canManage: true, revision: 2 });
  render(<ModuleHoursAccessPanel accountId={20} isAdmin={false} />);
  const checkbox = await screen.findByRole('checkbox', { name: /Manage module hours permissions/ });
  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: 'Save hours permissions' }));
  expect(saveAccountModuleHoursAccess).toHaveBeenCalledWith(20, { canMatch: false, canManage: false, revision: 2 });
});
