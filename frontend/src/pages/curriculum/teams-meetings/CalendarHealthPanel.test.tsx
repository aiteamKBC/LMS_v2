import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { CalendarHealthPanel } from './CalendarHealthPanel';
import type { CalendarHealth, HealthSession, ResolutionPreview, SessionDetail } from './calendarHealth';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ clearCurriculumGetCache: vi.fn() }));

const MAIN = { eventId: 'series-1', onlineMeetingId: 'meeting-main', joinUrl: 'https://teams.example.invalid/main', joinRef: 'aaaa', organizer: 'organiser@example.invalid' };

function session(number: number, extra: Partial<HealthSession> = {}): HealthSession {
  return {
    occurrenceId: `OCC-${number}`, liveSessionId: 'LIVE-1', sessionNumber: number,
    startDateTimeUtc: `2026-10-${String(number + 1).padStart(2, '0')}T16:00:00+00:00`,
    endDateTimeUtc: `2026-10-${String(number + 1).padStart(2, '0')}T18:00:00+00:00`,
    meetingType: 'main', integrity: 'verified', integrityBasis: 'microsoft', verificationStale: false,
    membership: 'in_plan', lifecycle: 'scheduled', lifecycleIssues: [], auditIssues: [], attribution: null,
    resolution: null, meeting: { ...MAIN }, ...extra,
  };
}

const conflict = session(3, {
  meetingType: 'standalone', integrity: 'link_conflict', integrityBasis: 'lms', lifecycle: 'completed',
  meeting: { eventId: 'standalone-3', onlineMeetingId: 'meeting-separate', joinUrl: 'https://teams.example.invalid/separate', joinRef: 'bbbb' },
  lifecycleIssues: [{ code: 'completed_before_start', severity: 'error', confirmed: true, message: 'Completed from a run that ended before its scheduled start.' }],
  auditIssues: [{ code: 'unknown_meeting_origin', severity: 'notice', message: 'The original user or trigger that created this separate meeting could not be identified.' }],
  attribution: { known: false, label: 'System — original trigger unknown', origin: 'unknown_historical', initiatedBy: '', trigger: '', jobId: '', at: '' },
});
const additional = session(1, { occurrenceId: 'OCC-X1', liveSessionId: 'LIVE-X', meetingType: 'additional', integrity: 'verification_required', title: 'Guest speaker',
  meeting: { eventId: 'extra-1', onlineMeetingId: '', joinUrl: 'https://teams.example.invalid/extra', joinRef: 'cccc' } });

function healthResponse(items: HealthSession[], extra: Partial<CalendarHealth['summary']> = {}): CalendarHealth {
  return {
    liveSessionId: 'LIVE-1',
    module: { moduleCatalogueId: 'MOD-1', title: 'Synthetic - Thur', programme: 'Programme', cohort: 'Cohort', group: 'Group' },
    mainMeeting: MAIN,
    summary: {
      status: 'attention_required',
      counts: { plannedSessions: 12, mainSeries: 11, additionalMeetings: 1, standaloneReplacements: 1, missingOccurrences: 0,
        linkConflicts: 1, lifecycleIssues: 1, auditIssues: 1, notInPlan: 0 },
      lastVerifiedAt: '2026-10-08T09:00:00+00:00', verificationStale: false, neverVerified: false,
      lastVerificationFailure: null, auditLogAvailable: true, ...extra,
    },
    warnings: [
      { category: 'link', severity: 'error', title: 'Meeting Link Conflict — Review Required', module: 'Synthetic - Thur', sessions: [3],
        explanation: "Week 3 uses a separate Teams meeting from the module's main recurring series.", nextAction: 'Open each session.', lastVerifiedAt: '' },
      { category: 'lifecycle', severity: 'error', title: 'Session Lifecycle Issue — Review Required', module: 'Synthetic - Thur', sessions: [3],
        explanation: 'Week 3: Completed early.', nextAction: 'Review status history.', lastVerifiedAt: '' },
      { category: 'audit', severity: 'notice', title: 'Audit Attribution Incomplete', module: 'Synthetic - Thur', sessions: [3],
        explanation: 'Unknown origin.', nextAction: 'None.', lastVerifiedAt: '' },
    ],
    sessions: { items, page: 1, pageSize: 25, pages: 1, total: items.length, filter: 'all' },
    readOnly: true,
  };
}

const detail: SessionDetail = {
  ...conflict,
  module: { moduleCatalogueId: 'MOD-1', title: 'Synthetic - Thur', programme: 'Programme', cohort: 'Cohort', group: 'Group' },
  mainMeeting: MAIN, actualStartUtc: '2026-09-26T11:05:00+00:00', actualEndUtc: '2026-09-26T11:09:00+00:00',
  attendanceReportLinked: true, participantCount: 1, createdAt: '2026-09-15T21:46:00+00:00', updatedAt: '2026-09-26T11:02:00+00:00',
  evidence: { attendanceRecords: 1, recordings: 0, transcripts: 0 }, separateFromMain: true,
  compare: {
    main: { ...MAIN, membership: 'Recurring series master' },
    session: { ...conflict.meeting, membership: 'A separate event, not in the recurring series', startDateTimeUtc: conflict.startDateTimeUtc, endDateTimeUtc: conflict.endDateTimeUtc },
    implications: ['Changing the LMS join link does not update Outlook invitations people already hold.'],
  },
  auditHistory: [], statusHistory: [],
  resolutions: [
    { action: 'keep_existing', label: 'Keep existing arrangement', readOnly: false },
    { action: 'mark_intentional', label: 'Mark as intentional separate meeting', readOnly: false },
  ],
};

const preview: ResolutionPreview = {
  action: 'keep_existing', label: 'Keep existing arrangement', sessionNumber: 3,
  changes: ['Records that this arrangement was reviewed and kept.'], unchanged: ['Both meeting links'], followUp: [],
  microsoft: { creates: false, updates: false, cancels: false, reads: false, mayEmail: false }, lmsEmail: false,
  blocked: '', requiresConfirmation: true, previewToken: 'token-1',
};

type Call = [string, RequestInit | undefined];
const calls = () => vi.mocked(coachFetch).mock.calls as unknown as Call[];
const ok = (body: unknown) => ({ ok: true, json: async () => body } as Response);

function route(responses: { health?: CalendarHealth; detail?: SessionDetail; resolution?: (body: Record<string, unknown>) => unknown }) {
  vi.mocked(coachFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/resolution/')) return ok(responses.resolution?.(JSON.parse(String(init?.body || '{}'))) ?? {});
    if (url.includes('/sessions/')) return ok({ session: responses.detail });
    return ok(responses.health);
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

describe('Calendar health', () => {
  it('shows the status, counts and all three warning categories from one read-only GET', async () => {
    route({ health: healthResponse([session(1), conflict, additional]) });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    expect(await screen.findByTestId('calendar-health-status')).toHaveTextContent('Needs review');
    expect(screen.getByText('Meeting Link Conflict — Review Required')).toBeInTheDocument();
    expect(screen.getByText('Session Lifecycle Issue — Review Required')).toBeInTheDocument();
    expect(screen.getByText('Audit Attribution Incomplete')).toBeInTheDocument();
    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]).toEqual({ method: 'GET' });
  });

  it('labels a legitimate additional meeting as additional, not as a conflict', async () => {
    route({ health: healthResponse([session(1), conflict, additional]) });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    const row = (await screen.findByText('Guest speaker')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Additional meeting')).toBeInTheDocument();
    expect(within(row).queryByText('Link conflict')).not.toBeInTheDocument();
    const conflictRow = screen.getByText('Standalone replacement').closest('tr') as HTMLElement;
    expect(within(conflictRow).getByText('Link conflict')).toBeInTheDocument();
  });

  it('never presents a stale check as fresh', async () => {
    route({ health: healthResponse([session(1, { verificationStale: true })], { status: 'verification_pending', verificationStale: true }) });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    expect(await screen.findByTestId('calendar-health-status')).toHaveTextContent('Verification pending');
    expect(screen.getByText(/status check stale, run it again/)).toBeInTheDocument();
    expect(screen.getByText('Verified (status check stale)')).toBeInTheDocument();
  });

  it('filters on the server and pages without other requests', async () => {
    route({ health: healthResponse([conflict]) });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    await screen.findByTestId('calendar-health-status');
    fireEvent.click(screen.getByRole('button', { name: 'Link conflicts' }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1][0]).toContain('filter=link_conflict');
    expect(calls().every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('opens the session drawer read-only, with the conflict and lifecycle warnings and no mutation', async () => {
    route({ health: healthResponse([conflict]), detail });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByText('Different Teams Meeting Detected')).toBeInTheDocument();
    expect(screen.getByText('Invalid Session Completion')).toBeInTheDocument();
    expect(screen.getByText('This session was marked Completed before its scheduled start.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare meetings' }));
    expect(screen.getByText('This session uses a different Teams meeting from the main series.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Audit history' }));
    expect(screen.getByText(/Earlier actions are shown as unknown, not inferred/)).toBeInTheDocument();
    expect(calls().every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('requires reading the preview and ticking the box before a resolution is sent', async () => {
    const bodies: Record<string, unknown>[] = [];
    route({ health: healthResponse([conflict]), detail, resolution: body => {
      bodies.push(body);
      return body.confirm ? { resolved: true, action: 'keep_existing' } : { preview };
    } });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep existing arrangement' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm: Keep existing arrangement' });
    expect(screen.getByText('Records that this arrangement was reviewed and kept.')).toBeInTheDocument();
    expect(bodies).toEqual([{ occurrenceId: 'OCC-3', action: 'keep_existing' }]);
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm);
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ occurrenceId: 'OCC-3', action: 'keep_existing', confirm: true, previewToken: 'token-1' });
  });

  it('cannot confirm a blocked resolution', async () => {
    route({ health: healthResponse([conflict]), detail, resolution: () => ({ preview: { ...preview, blocked: 'Attendance is already linked.' } }) });
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep existing arrangement' }));
    expect(await screen.findByText('Blocked: Attendance is already linked.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm: Keep existing arrangement' })).toBeDisabled();
  });

  it('shows a permission error without claiming anything changed', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'You do not have access to this page.' }) } as Response);
    render(<CalendarHealthPanel liveSessionId="LIVE-1" />);
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });
});
