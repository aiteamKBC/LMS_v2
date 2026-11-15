import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { importCountryCalendar, type CurriculumHoliday, type DeliveryCalendarPolicy } from '@/lib/curriculumApi';
import { DeliveryCalendarEditor } from '../DeliveryCalendarEditor';
import { calendarPreset, calendarSessionClashes, effectiveCalendarHolidays } from '../deliveryCalendar';

vi.mock('@/lib/curriculumApi', () => ({ importCountryCalendar: vi.fn() }));
const england: CurriculumHoliday[] = [{ id: 'uk', label: 'UK public day', startDate: '2026-09-22', endDate: '2026-09-22', source: 'gov.uk' }];
const saudi: CurriculumHoliday[] = [{ id: 'sa', label: 'Saudi public day', startDate: '2026-09-23', endDate: '2026-09-23', source: 'calendarific', country: 'SA' }];

function Harness({ module = false, inheritedPolicy = null }: { module?: boolean; inheritedPolicy?: DeliveryCalendarPolicy | null }) {
  const [value, setValue] = useState<DeliveryCalendarPolicy | null>(null);
  const [rows, setRows] = useState<CurriculumHoliday[]>([]);
  const [ready, setReady] = useState(true);
  return <><DeliveryCalendarEditor value={value} onChange={setValue} legacyHolidays={england} module={module}
    inheritedPolicy={inheritedPolicy} startDate="2026-09-01" endDate="2026-09-30" onHolidaysChange={setRows} onReadyChange={setReady} />
    <output data-testid="policy">{JSON.stringify(value)}</output><output data-testid="effective">{JSON.stringify(rows)}</output><output data-testid="ready">{String(ready)}</output></>;
}

describe('delivery calendar choices', () => {
  beforeEach(() => { vi.mocked(importCountryCalendar).mockReset().mockResolvedValue({ holidays: saudi }); });

  it('leaves England inherited without making an API request', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe(JSON.stringify(england)));
    expect(screen.getByTestId('policy').textContent).toBe('null');
    expect(screen.getByLabelText('Saturday')).toBeChecked();
    expect(importCountryCalendar).not.toHaveBeenCalled();
  });

  it('loads Saudi holidays and lets the author confirm or change rest days', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'SA' } });
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toContain('Saudi public day'));
    expect(screen.getByLabelText('Friday')).toBeChecked();
    expect(screen.getByLabelText('Sunday')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Saturday'));
    expect(JSON.parse(screen.getByTestId('policy').textContent || '{}').weekendDays).toEqual(['Friday']);
    expect(importCountryCalendar).toHaveBeenCalledTimes(1);
  });

  it('unticks a public holiday without changing the provider data', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'SA' } });
    await screen.findByText(/Saudi public day/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Saudi public day/ }));
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe('[]'));
    expect(saudi).toHaveLength(1);
    expect(JSON.parse(screen.getByTestId('policy').textContent || '{}').excludedHolidayIds).toEqual(['sa']);
  });

  it('makes module customizations explicit and restores inheritance', async () => {
    render(<Harness module inheritedPolicy={calendarPreset('SA')} />);
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toContain('Saudi public day'));
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Customize this module' }));
    fireEvent.click(screen.getByLabelText('Friday'));
    expect(JSON.parse(screen.getByTestId('policy').textContent || '{}').weekendDays).toEqual(['Saturday']);
    fireEvent.click(screen.getByRole('button', { name: 'Use cohort calendar' }));
    expect(screen.getByTestId('policy').textContent).toBe('null');
  });

  it('blocks an unavailable provider without pretending the holiday list is valid', async () => {
    vi.mocked(importCountryCalendar).mockRejectedValueOnce(new Error('Provider unavailable'));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'EG' } });
    await screen.findByRole('alert');
    expect(screen.getByTestId('ready').textContent).toBe('false');
    expect(screen.getByTestId('effective').textContent).not.toContain('UK public day');
  });

  it('ignores a late Saudi response after returning to England', async () => {
    let resolve!: (value: { holidays: CurriculumHoliday[] }) => void;
    vi.mocked(importCountryCalendar).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'SA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore England default' }));
    await act(async () => resolve({ holidays: saudi }));
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toContain('UK public day'));
    expect(screen.getByTestId('effective').textContent).not.toContain('Saudi public day');
  });

  it('keeps manual closures when public holidays are disabled', () => {
    const manual = { ...england[0], id: 'manual:one', source: 'authored' as const };
    const selected = { ...calendarPreset('SA'), observePublicHolidays: false, manualHolidays: [manual] };
    expect(effectiveCalendarHolidays(selected, saudi)).toEqual([manual]);
    expect(effectiveCalendarHolidays({ ...selected, weekendDays: [] }, [])).toEqual([manual]);
  });

  it('reviews each affected session date once and distinguishes weekly rest from public holidays', () => {
    const rows = calendarSessionClashes(['2026-09-19', '2026-09-23', '2026-09-23', '2026-09-24'], calendarPreset('SA'), saudi);
    expect(rows).toEqual([
      { date: '2026-09-19', reason: 'Saturday: weekly rest day' },
      { date: '2026-09-23', reason: 'Public holiday: Saudi public day' },
    ]);
  });
});
