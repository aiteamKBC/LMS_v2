import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDailyResults, type DailyResults } from '../dailyResults';
import LectureAttendance from '../components/LectureAttendance';
import type { Lecture } from '../types';
const excel = vi.hoisted(() => ({ book_new: vi.fn(() => ({})), json_to_sheet: vi.fn((_rows: Record<string, unknown>[]) => ({})), book_append_sheet: vi.fn(), writeFile: vi.fn() }));
vi.mock('xlsx', () => ({ utils: excel, writeFile: excel.writeFile }));
vi.mock('../dailyResults', () => ({ loadDailyResults: vi.fn() }));
const lecture: Lecture = { id: 'M:O', moduleId: 'M', seriesId: 'S', occurrenceId: 'O', sessionNumber: 2, title: 'Synthetic lecture',
  startsAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T10:00:00Z', date: '2026-10-14', startTime: '11:00', endTime: '13:00',
  programme: 'Level 4', cohort: 'October', group: 'Group A', module: 'Data', week: 2, weekTitle: 'Introduction',
  archived: false, programmeActive: true, status: 'unsynced', recordings: [] };
const data: DailyResults = { date: lecture.date, timeZone: 'Africa/Cairo', reportReady: true, reportCount: 1, unplacedFileCount: 3, artifacts: [],
  attendance: [
    { email: 'present@example.invalid', name: 'Synthetic Present', seconds: 4200, expected: true, status: 'present', rawStatus: 'present', attendance: 1, excused: false, catchupCompleted: false },
    { email: 'absent@example.invalid', name: 'Synthetic Absent', seconds: 0, expected: true, status: 'absent', rawStatus: 'absent', attendance: 0, excused: false, catchupCompleted: false },
  ], staff: [{ name: 'Synthetic Organizer', email: 'staff@example.invalid', roles: ['Organiser'], seconds: 0, status: 'unconfirmed' }] };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadDailyResults).mockResolvedValue(data); });
describe('Day-scoped assigned learner attendance', () => {
  it('loads only on expansion and exports only this module/date with existing sheet columns', async () => {
    const user = userEvent.setup(); render(<LectureAttendance lecture={lecture} timeZone="Africa/Cairo" />);
    expect(loadDailyResults).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View attendance & saved files' }));
    expect(await screen.findByText('Synthetic Present')).toBeInTheDocument();
    expect(screen.getByText('2 assigned learners / 1 present / 1 absent / 0 unconfirmed')).toBeInTheDocument();
    expect(loadDailyResults).toHaveBeenCalledWith(expect.objectContaining({ moduleId: 'M', occurrenceId: 'O', date: '2026-10-14', seriesId: 'S', sessionNumber: 2 }), 'Africa/Cairo', expect.any(AbortSignal));
    expect(screen.getByText('70m 0s')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download attendance sheet' }));
    await waitFor(() => expect(excel.writeFile).toHaveBeenCalled());
    expect(excel.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ 'Attendee name': 'Synthetic Present', Status: 'Present', 'Attendance seconds': 4200, 'Lecture date': '2026-10-14' }),
      expect.objectContaining({ 'Attendee name': 'Synthetic Absent', Status: 'Absent' }),
    ]));
    expect(excel.json_to_sheet.mock.calls[0][0]).toHaveLength(2);
    expect(excel.writeFile.mock.calls[0][1]).toBe('Synthetic-lecture-2026-10-14-attendance.xlsx');
    expect(screen.getByText('Other-day or undated files are excluded from this view.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide attendance & saved files' }));
    expect(screen.queryByText('Synthetic Present')).not.toBeInTheDocument();
  });
  it('separates organizer evidence from learner absence', async () => {
    const user = userEvent.setup(); render(<LectureAttendance lecture={lecture} timeZone="Africa/Cairo" />);
    await user.click(screen.getByRole('button', { name: 'View attendance & saved files' }));
    await screen.findByText('Synthetic Present');
    await user.click(screen.getByText('Staff participation (excluded from learner totals)'));
    expect(screen.getByText(/Synthetic Organizer/)).toHaveTextContent('No confirmed join evidence for this day');
    expect(screen.getByText(/Synthetic Organizer/)).not.toHaveTextContent('Absent');
  });
  it('retries a read failure without syncing a meeting', async () => {
    const user = userEvent.setup(); vi.mocked(loadDailyResults).mockRejectedValueOnce(new Error('Saved attendance unavailable'));
    render(<LectureAttendance lecture={lecture} timeZone="Africa/Cairo" />);
    await user.click(screen.getByRole('button', { name: 'View attendance & saved files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved attendance unavailable');
    await user.click(screen.getByRole('button', { name: 'Refresh saved attendance' }));
    expect(await screen.findByText('Synthetic Present')).toBeInTheDocument();
    expect(loadDailyResults).toHaveBeenCalledTimes(2);
  });
  it('keeps no-report outcomes unknown in both the table and download', async () => {
    const user = userEvent.setup(); vi.mocked(loadDailyResults).mockResolvedValue({ ...data, reportReady: false, artifacts: [], attendance: [{ ...data.attendance[0], status: 'pending', rawStatus: 'pending', attendance: null, seconds: 0 }] });
    render(<LectureAttendance lecture={lecture} timeZone="Africa/Cairo" />);
    await user.click(screen.getByRole('button', { name: 'View attendance & saved files' }));
    expect(await screen.findByText('Attendance not confirmed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Missing evidence is not treated as absence');
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download attendance sheet' }));
    await waitFor(() => expect(excel.json_to_sheet).toHaveBeenCalled());
    expect(excel.json_to_sheet.mock.calls[0][0][0].Status).toBe('Attendance not confirmed');
  });
});
