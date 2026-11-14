import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createCurriculumHoliday, updateCurriculumHoliday } from '@/lib/curriculumApi';
import HolidaysPage from '../../england-holidays/page';

// Main is authoritative: a type is text on one manual holiday. Suggestions
// come from saved manual rows, not a separately managed global type catalogue.
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
}));
vi.mock('@/lib/curriculumApi', () => ({
  fetchCurriculumHolidays: vi.fn(async () => holidays),
  fetchEnglandHolidaySyncs: vi.fn(async () => ({ status: null, results: [] })),
  createCurriculumHoliday: vi.fn(async () => ({ created: true })),
  updateCurriculumHoliday: vi.fn(async () => ({ updated: true })),
  archiveCurriculumHoliday: vi.fn(async () => ({ archived: true })),
}));
const holidays = [
  { id: '1', label: 'Christmas closure', startDate: '2026-12-24', endDate: '2027-01-02', type: 'Christmas', color: '#16a34a', source: 'authored' },
  { id: '2', label: 'Workshop week', startDate: '2026-10-05', endDate: '2026-10-09', type: 'Workshop', color: '#2563eb', source: 'authored' },
  { id: '3', label: 'Second workshop', startDate: '2027-02-01', endDate: '2027-02-05', type: 'workshop', color: '#2563eb', source: 'authored' },
  { id: 'gov-1', label: 'Official bank holiday', startDate: '2027-01-01', endDate: '2027-01-01', type: 'Bank holiday', color: '#91d64c', source: 'gov.uk' },
];
beforeEach(() => vi.clearAllMocks());
async function openDrawer() {
  render(<MemoryRouter><HolidaysPage /></MemoryRouter>);
  await screen.findByText('Workshop week');
  await userEvent.click(screen.getByRole('button', { name: 'Add manual holiday' }));
}
async function save() {
  await userEvent.type(screen.getByPlaceholderText('e.g. College closure'), 'Museum visit');
  fireEvent.change(screen.getByLabelText(/^Start date$/), { target: { value: '2027-05-10' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
  await waitFor(() => expect(createCurriculumHoliday).toHaveBeenCalledTimes(1));
}
describe('manual holiday type text on main', () => {
  it('suggests saved manual types once each, most used first, excluding GOV.UK types', async () => {
    await openDrawer();
    const choices = screen.getAllByRole('button', { name: /^(Workshop|Christmas)$/ });
    expect(choices.map(button => button.textContent)).toEqual(['Workshop', 'Christmas']);
    expect(screen.queryByRole('button', { name: 'Bank holiday' })).not.toBeInTheDocument();
  });
  it('saves a new type on the holiday without changing other saved holidays', async () => {
    const original = structuredClone(holidays);
    await openDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Workshop'), 'Field trip');
    await save();
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Museum visit', startDate: '2027-05-10', type: 'Field trip', color: '#7c3aed',
    }));
    expect(updateCurriculumHoliday).not.toHaveBeenCalled();
    expect(holidays).toEqual(original);
  });
  it('selects a stored suggestion together with its colour', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Workshop' }));
    expect(screen.getByPlaceholderText('e.g. Workshop')).toHaveValue('Workshop');
    expect(screen.getByRole('button', { name: 'Workshop' })).toHaveAttribute('aria-pressed', 'true');
    await save();
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({ type: 'Workshop', color: '#2563eb' }));
  });
  it('recognizes an existing suggestion case-insensitively without rewriting it', async () => {
    await openDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Workshop'), 'workshop');
    expect(screen.getByRole('button', { name: 'Workshop' })).toHaveAttribute('aria-pressed', 'true');
    await save();
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({ type: 'workshop' }));
    expect(updateCurriculumHoliday).not.toHaveBeenCalled();
  });
  it('clears the type only on the new holiday and restores the manual default colour', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Workshop' }));
    await userEvent.clear(screen.getByPlaceholderText('e.g. Workshop'));
    await save();
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({ type: '', color: '#7c3aed' }));
    expect(updateCurriculumHoliday).not.toHaveBeenCalled();
  });
  it('keeps a typed but unsaved type local to the open form', async () => {
    const original = structuredClone(holidays);
    await openDrawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Workshop'), 'Study week');
    expect(createCurriculumHoliday).not.toHaveBeenCalled();
    expect(updateCurriculumHoliday).not.toHaveBeenCalled();
    expect(holidays).toEqual(original);
  });
});
