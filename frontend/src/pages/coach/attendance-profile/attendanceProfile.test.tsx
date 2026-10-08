import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode, type ReactNode } from 'react';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import CoachAttendanceProfile from './page';
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.com', name: 'Coach Sara' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const record = (index = 1) => ({ id: `microsoft-teams:occ-${index}`, title: `Session ${index}`, date: '2026-09-16', module: 'Data Foundations', status: index % 2 ? 'present' : 'absent', absenceReport: null });
function payload(records = [record()], page = 1, total = records.length) {
  return {
    learner: { id: '42', name: 'Synthetic Learner', email: 'learner@example.test', programme: 'Data', cohort: 'September', group: 'Group A', learnerStartDate: '01 Sep 2026', learnerEndDate: '31 Aug 2027' },
    coach: { name: 'Coach Sara', email: 'coach@example.com' }, tutor: null,
    summary: { attendanceRate: 79, sessions: 32, present: 26, absent: 6 }, records,
    pagination: { page, pageSize: 20, total, hasMore: page * 20 < total },
  };
}
const pageElement = <MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>;
describe('coach attendance detail', () => {
  beforeEach(() => {
    clearAllCachedResources();
    vi.mocked(coachFetch).mockReset().mockImplementation(async () => new Response(JSON.stringify(payload())));
  });
  afterEach(() => vi.restoreAllMocks());

  it('preserves header/cards/report totals and renders compact records by id-only lookup', async () => {
    render(pageElement);
    expect(await screen.findByRole('heading', { name: 'Synthetic Learner' })).toBeInTheDocument();
    expect(screen.getAllByText('79%')).toHaveLength(2);
    expect(screen.getByText('26 present out of 32')).toBeInTheDocument();
    expect(screen.getAllByText('Session 1')).toHaveLength(2);
    expect(screen.getByText('September')).toBeInTheDocument();
    expect(screen.getByText('Group A')).toBeInTheDocument();
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    const cards = screen.getByLabelText('Attendance summary');
    expect(within(cards).getByText('Coach Sara')).toBeInTheDocument();
    expect(within(cards).getByText('coach@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    const report = screen.getByLabelText('Student attendance report');
    expect(within(report).getByText('01 Sep 2026 \u2014 31 Aug 2027')).toBeInTheDocument();
    expect(within(report).getByText('Attendance rate').nextElementSibling).toHaveTextContent('79%');
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(coachFetch).mock.calls[0][0]).toBe('/coach_api/coach/attendance/details?learner_id=42&page=1&pageSize=20');
    expect(vi.mocked(coachFetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('opens once under StrictMode and reuses the same learner on rerender and revisit', async () => {
    const strictPage = <StrictMode>{pageElement}</StrictMode>;
    const first = render(strictPage);
    expect(await screen.findByRole('heading', { name: 'Synthetic Learner' })).toBeInTheDocument();
    first.rerender(<StrictMode>{pageElement}</StrictMode>);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(coachFetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    first.unmount();
    render(strictPage);
    expect(await screen.findByRole('heading', { name: 'Synthetic Learner' })).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(1);
  });

  it('uses backend totals without recalculating them from the requested page and displays an assigned tutor', async () => {
    vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify({ ...payload(), tutor: { name: 'Tutor One', email: 'tutor@example.test' } })));
    render(pageElement);
    expect(await screen.findByText('26 present out of 32')).toBeInTheDocument();
    expect(screen.getByText('1 records')).toBeInTheDocument();
    const cards = screen.getByLabelText('Attendance summary');
    expect(within(cards).getByText('Tutor One')).toBeInTheDocument();
    expect(within(cards).getByText('tutor@example.test')).toBeInTheDocument();
  });

  it('requests one page of 20, next requests once, and fresh previous/return reuse cached pages', async () => {
    const all = Array.from({ length: 24 }, (_, i) => record(i + 1));
    vi.mocked(coachFetch).mockImplementation(async url => {
      const page = Number(new URL(String(url), 'http://localhost').searchParams.get('page'));
      return new Response(JSON.stringify(payload(all.slice((page - 1) * 20, page * 20), page, 24)));
    });
    const first = render(pageElement);
    expect(await screen.findByText('24 records')).toBeInTheDocument();
    expect(within(screen.getAllByRole('table')[0]).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText('Showing 1\u201320 of 24 records')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(within(screen.getAllByRole('table')[0]).getByText('Session 24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(coachFetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(2);
    first.unmount(); render(pageElement);
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(2);
  });

  it('loads additional pages only on Export PDF and prints all historical rows', async () => {
    const all = Array.from({ length: 24 }, (_, i) => record(i + 1));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.mocked(coachFetch).mockImplementation(async url => {
      const page = Number(new URL(String(url), 'http://localhost').searchParams.get('page'));
      return new Response(JSON.stringify(payload(all.slice((page - 1) * 20, page * 20), page, 24)));
    });
    render(pageElement);
    expect(await screen.findByText('24 records')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const report = screen.getByLabelText('Student attendance report');
    expect(within(report).getAllByRole('row')).toHaveLength(25);
    expect(within(report).getByText('Session 24')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(2);
  });

  it.each(['microsoft-teams:occ:stable', 'kbc-attendance:legacy:stable', 'coach-manual:9'])('preserves Edit/Delete identity for %s', async id => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(coachFetch).mockImplementation(async (_url, init) => init?.method
      ? new Response(JSON.stringify({ ok: true }))
      : new Response(JSON.stringify(payload([{ ...record(), id }]))));
    render(pageElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Manual attendance session')).toHaveValue('Session 1');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(vi.mocked(coachFetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const patch = vi.mocked(coachFetch).mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const source = id.slice(0, id.indexOf(':'));
    const sourceId = id.slice(id.indexOf(':') + 1);
    if (source === 'coach-manual') expect(patch[0]).toBe('/coach_api/coach/attendance/manual/9');
    else expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ learnerId: '42', source, sourceId });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(vi.mocked(coachFetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    const deletion = vi.mocked(coachFetch).mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    if (source === 'coach-manual') expect(deletion[0]).toBe('/coach_api/coach/attendance/manual/9');
    else expect(JSON.parse(String(deletion[1]?.body))).toMatchObject({ learnerId: '42', source, sourceId });
  });
});
