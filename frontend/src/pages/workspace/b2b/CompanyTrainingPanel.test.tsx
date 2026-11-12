import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CompanyTrainingPanel } from './CompanyTrainingPanel';
const api = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn() }));
vi.mock('@/api/breatheIntegration', () => ({ listBreatheConnections: async () => ({ results: [{ id: 'c1' }] }), getCompanyTraining: api.get, saveCompanyTrainingRule: api.save }));
beforeEach(() => {
  api.save.mockReset().mockResolvedValue({ ok: true });
  api.get.mockReset().mockResolvedValue({ modules: [{ id: 'demo-m1', name: 'Foundations', plannedHours: 150, ksbs: 12 }], departments: [{ id: 'd1', name: 'Operations' }], employees: [{ id: 'p1', name: 'Employee demo', departmentId: 'd1', allocations: [] }], rules: [] });
});
it('reviews employees before HR confirms and saves a rule', async () => {
  render(<CompanyTrainingPanel hr />);
  const button = await screen.findByRole('button', { name: 'Create training rule' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'd1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Foundations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation' }));
  expect(api.save).not.toHaveBeenCalled();
  expect(screen.getByText('Employee demo')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith('c1','d1',['demo-m1']));
});
it('keeps a failed save visible and allows HR to retry', async () => {
  api.save.mockRejectedValueOnce(new Error('Could not save'));
  render(<CompanyTrainingPanel hr />);
  const button = await screen.findByRole('button', { name: 'Create training rule' });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'd1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Foundations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review allocation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }));
  await screen.findAllByText('Could not save');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('shows allocations to managers without a create action', async () => {
  render(<CompanyTrainingPanel hr={false} />);
  await screen.findByText('Saved rules (0)');
  expect(screen.queryByRole('button', { name: 'Create training rule' })).not.toBeInTheDocument();
});
