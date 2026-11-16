import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importCountryCalendar, previewModuleSessionPlan, previewTutorAvailabilityRoster } from '@/lib/curriculumApi';
import type { CurriculumCohort, CurriculumGroup, DeliveryCalendarPolicy } from '@/lib/curriculumApi';
import { calendarPreset } from '../deliveryCalendar';
import { ModuleFormDrawer } from '../moduleForm';

vi.mock('../recordSnapshot', () => ({
  fetchCurriculumRecordSnapshot: vi.fn(async () => ({ revision: '', record: null })),
}));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(), showCurriculumConfirm: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  importCountryCalendar: vi.fn(), previewModuleSessionPlan: vi.fn(), previewTutorAvailabilityRoster: vi.fn(),
}));

const englandHint = 'Saturday and Sunday are weekend holidays in England — delivery on these days is unusual.';

function drawer(policy: DeliveryCalendarPolicy | null = null) {
  return render(<MemoryRouter><ModuleFormDrawer open
    programmes={[{ id: 'PROG-1', sourceId: 'PROG-1', name: 'Programme', isActive: true }] as never}
    cohorts={[{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-1', startDate: '2026-09-01',
      endDate: '2027-08-31', calendarPolicy: policy }] as CurriculumCohort[]}
    groups={[{ id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', programmeId: 'PROG-1',
      weekDays: 'Thursday', startTime: '09:00', endTime: '11:00', startDate: '2026-09-03',
      endDate: '2027-08-31' }] as CurriculumGroup[]}
    tutorNames={['Tutor One']} defaults={{ programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1' }}
    onClose={vi.fn()} onSaved={vi.fn()} />
  </MemoryRouter>);
}

async function customDays(extraDay: 'Sat' | 'Sun') {
  await userEvent.click(screen.getByRole('combobox', { name: /Sessions per week/i }));
  await userEvent.click(screen.getByRole('option', { name: '2' }));
  const days = screen.getByRole('group', { name: /Delivery days/i });
  await userEvent.click(within(days).getByRole('button', { name: extraDay }));
  return within(days);
}

describe('module delivery-day warnings use the effective calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(importCountryCalendar).mockResolvedValue({ holidays: [] });
    vi.mocked(previewModuleSessionPlan).mockResolvedValue({ sessions: [], finalEndDate: '', warnings: [], skippedHolidays: [] });
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValue({ sessionDates: [], startTime: '', endTime: '', bookable: false,
      results: [], availableCount: 0, busyCount: 0 });
  });

  it('preserves the existing England hint and tooltips when no custom calendar is selected', async () => {
    drawer();
    expect(screen.getByRole('combobox', { name: /Sessions per week/i })).toHaveTextContent('1');
    expect(screen.queryByRole('group', { name: /Delivery days/i })).not.toBeInTheDocument();
    const days = await customDays('Sat');
    expect(days.getByText(englandHint)).toBeVisible();
    expect(days.getByRole('button', { name: 'Sat' })).toHaveAttribute('title', englandHint);
    expect(days.getByRole('button', { name: 'Sun' })).toHaveAttribute('title', englandHint);
    expect(days.getByRole('button', { name: 'Fri' })).not.toHaveAttribute('title');
    expect(importCountryCalendar).not.toHaveBeenCalled();
  });

  it('uses inherited Saudi Friday/Saturday rest days for the warning and button tooltips', async () => {
    drawer(calendarPreset('SA'));
    const days = await customDays('Sat');
    expect(days.getByText(/Weekly rest days for Saudi Arabia: Friday, Saturday/)).toBeVisible();
    expect(days.queryByText(/England/)).not.toBeInTheDocument();
    expect(days.getByRole('button', { name: 'Fri' })).toHaveAttribute('title', expect.stringContaining('Saudi Arabia'));
    expect(days.getByRole('button', { name: 'Sun' })).not.toHaveAttribute('title');
    await waitFor(() => expect(previewModuleSessionPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      calendarPolicy: null, weekDays: 'Thursday, Saturday', numberOfSessions: 2,
    })));
  });

  it('allows Saudi Sunday delivery without the England weekend warning', async () => {
    drawer(calendarPreset('SA'));
    const days = await customDays('Sun');
    expect(days.queryByText(/delivery on these days is unusual/i)).not.toBeInTheDocument();
    expect(days.getByRole('button', { name: 'Sun' })).not.toHaveAttribute('title');
  });

  it('updates the warning when the module country changes, without changing its delivery days', async () => {
    drawer();
    const days = await customDays('Sat');
    expect(days.getByText(englandHint)).toBeVisible();
    const calendar = within(screen.getByRole('region', { name: 'Delivery calendar' }));
    await userEvent.click(calendar.getByRole('button', { name: 'Customize this module' }));
    fireEvent.change(calendar.getByLabelText('Country'), { target: { value: 'SA' } });
    expect(days.getByText(/Weekly rest days for Saudi Arabia: Friday, Saturday/)).toBeVisible();
    expect(days.queryByText(englandHint)).not.toBeInTheDocument();
    expect(days.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'true');
    expect(days.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(previewModuleSessionPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      weekDays: 'Thursday, Saturday', calendarPolicy: expect.objectContaining({ country: 'SA', weekendDays: ['Friday', 'Saturday'] }),
    })));
    fireEvent.change(calendar.getByLabelText('Country'), { target: { value: 'GB' } });
    expect(days.getByText(englandHint)).toBeVisible();
    expect(days.getByRole('button', { name: 'Fri' })).not.toHaveAttribute('title');
    expect(days.getByRole('button', { name: 'Sun' })).toHaveAttribute('title', englandHint);
  });

  it('honors module rest-day overrides, an empty list and restoring cohort inheritance', async () => {
    drawer(calendarPreset('SA'));
    const days = await customDays('Sat');
    const calendar = within(screen.getByRole('region', { name: 'Delivery calendar' }));
    await userEvent.click(calendar.getByRole('button', { name: 'Customize this module' }));
    await userEvent.click(calendar.getByRole('checkbox', { name: 'Saturday' }));
    expect(days.queryByText(/delivery on these days is unusual/i)).not.toBeInTheDocument();
    expect(days.getByRole('button', { name: 'Sat' })).not.toHaveAttribute('title');
    expect(days.getByRole('button', { name: 'Fri' })).toHaveAttribute('title', expect.stringContaining('Friday'));
    await userEvent.click(calendar.getByRole('checkbox', { name: 'Friday' }));
    expect(days.getByRole('button', { name: 'Fri' })).not.toHaveAttribute('title');
    await waitFor(() => expect(previewModuleSessionPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      weekDays: 'Thursday, Saturday', calendarPolicy: expect.objectContaining({ country: 'SA', weekendDays: [] }),
    })));
    await userEvent.click(calendar.getByRole('button', { name: 'Use cohort calendar' }));
    expect(days.getByText(/Weekly rest days for Saudi Arabia: Friday, Saturday/)).toBeVisible();
    expect(days.getByRole('button', { name: 'Sat' })).toHaveAttribute('title', expect.stringContaining('Saudi Arabia'));
  });
});
