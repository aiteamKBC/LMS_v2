import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import LearnerCaseFile from '@/pages/coach/learner-case-file/page';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: null } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, hasCoachAccess: true, email: 'coach@example.test', name: 'Coach' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const metrics = { programme: { completed: 1, total: 2, percent: 50, status: 'ready' }, otjh: { actual: 12, planned: 100 }, ksb: { completed: 1, total: 2, percent: 50, status: 'ready' } };
const attendance = { learnerId: 201, sessions: 2, present: 1, absent: 1, attendanceRate: 50, consecutiveMissed: 1, lastSessionDate: null, sessionHistory: [] };
const schedule = { months: {}, contractStatus: 'not-available', actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: '' }, generatedAt: '', programmeStartDate: '2026-01-01', programmeEndDate: '2027-01-01' };
const sections: Record<string, unknown> = {
  profile: { learner: { id: '101', enrolmentId: '201', aptemId: null, learnerType: 'apprenticeship', name: 'Synthetic Learner', email: 'learner@example.test', programme: 'Programme', group: 'Synthetic Group', employer: 'Synthetic Employer', status: 'Active', startDate: '2026-01-01', plannedEndDate: '2027-01-01' } },
  overview: { wholeProgrammeProgress: { overall: metrics.programme, ksb: metrics.ksb, attendance: { ...attendance, percent: 50 }, otjh: { actual: 12, planned: 100, targetToDate: 25, percent: 48 } }, programmeProgress: [] },
  'weekly-learning': { weeks: [], selectedWeek: null },
  'monthly-focus': { month: '2026-09', summary: { requiredHours: 50, achievedHours: 0, differenceHours: -50, ksbCount: null }, reviews: [], assignments: [], lectures: [] },
  'otjh-ksb': { metrics, programmeWindow: { startDate: '2026-01-01', plannedEndDate: '2027-01-01' }, schedule, week: { planSubjects: [], monthlyOtjh: [] }, hours: { months: [], learner: {} }, breakdown: { source: 'progress', rows: [{ code: 'K1', description: 'Synthetic knowledge', category: 'Knowledge', completed: 1, status: 'Achieved', activityNames: ['Synthetic evidence'], components: [] }], achievedKsbs: 1 } },
  'learning-plan': { detail: { modules: ['Synthetic Module'], week: [{ module: 'Synthetic Module', week: 'Week 1', moduleId: 'M1', weekId: 'W1' }], components: [{ componentId: 'C1', moduleId: 'M1', weekId: 'W1', module: 'Synthetic Module', week: 'Week 1', component: 'Synthetic reading', type: 'reading' }], quizAttempts: [], videoProgress: [], componentProgress: [] }, covers: {}, schedule, week: { planSubjects: [], monthlyOtjh: [] }, hours: { months: [], learner: {} } },
  K1: { source: 'progress', rows: [{ code: 'K1', description: 'Synthetic knowledge', category: 'Knowledge', completed: 1, status: 'Achieved', components: [{ name: 'Synthetic evidence', status: 'completed', achieved: true, source: 'Progress' }] }], achievedKsbs: 1 },
  attendance: { attendance }, reviews: { events: [], reviewGenerationIssues: [] }, assignments: { months: [], errors: [] }, 'enrolment-documents': { documents: [], signature: { saved: false, name: 'Coach' } },
};
beforeEach(() => {
  clearAllCachedResources(); transport.mockReset();
  transport.mockImplementation(async (url: string) => {
    const section = new URL(url, 'http://example.test').pathname.split('/').at(-1)!;
    if (!(section in sections)) throw new Error(`Unexpected request ${url}`);
    return new Response(JSON.stringify(sections[section]), { status: 200 });
  });
});
it.each(['apprenticeship', 'commercial'])('real %s tab consumers issue one owning request per first open and none on return under StrictMode', async (learnerType) => {
  const profile = sections.profile as { learner: Record<string, unknown> };
  profile.learner.learnerType = learnerType;
  render(<StrictMode><MemoryRouter initialEntries={['/coach/learner-case-file?id=101&tab=overview&month=2026-09']}><LearnerCaseFile /></MemoryRouter></StrictMode>);
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument());
  await act(async () => {});
  expect(transport.mock.calls.map(call => call[0])).toEqual(['/coach_api/coach/case-file/101/profile', '/coach_api/coach/case-file/101/overview']);
  expect(screen.getByText('Employer: Synthetic Employer')).toBeInTheDocument();
  const header = screen.getByRole('region', { name: 'Learner profile summary' });
  expect(header).toHaveTextContent('Synthetic Learner');
  expect(header).toHaveTextContent('Synthetic Group');
  expect(header).toHaveTextContent('learner@example.test');
  expect(header).toHaveTextContent('2027-01-01');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Whole programme progress' })).toHaveTextContent('1 / 2 sessions attended'));
  expect(screen.queryByText('KSB progress unavailable')).not.toBeInTheDocument();
  expect(screen.queryByText('Recorded hours unavailable')).not.toBeInTheDocument();
  const tabs = [['Overview', 'overview'], ['Weekly Learning', 'weekly-learning'], ['Monthly Focus', 'monthly-focus'], ['OTJH & KSB Progress', 'otjh-ksb'], ['Attendance', 'attendance'], ['Learning Plan', 'learning-plan'], ['Reviews', 'reviews'], ['Assignments', 'assignments'], ['Enrolment Documents', 'enrolment-documents']];
  for (const [label, section] of tabs.slice(1)) {
    const before = transport.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: label }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(before + 1));
    await act(async () => {});
    expect(transport.mock.calls.at(-1)?.[0]).toBe(`/coach_api/coach/case-file/101/${section}${section === 'monthly-focus' ? '?month=2026-09' : ''}`);
    expect(transport).toHaveBeenCalledTimes(before + 1);
    if (section === 'learning-plan') await waitFor(() => expect(screen.getByText('Synthetic Module')).toBeInTheDocument());
  }
  for (const [label] of tabs.slice().reverse()) { fireEvent.click(screen.getByRole('tab', { name: label })); await act(async () => {}); }
  expect(transport).toHaveBeenCalledTimes(10);
  expect(screen.getByText('Employer: Synthetic Employer')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());
  expect(transport).toHaveBeenCalledTimes(10);
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(11));
  expect(transport.mock.calls.at(-1)?.[0]).toBe('/coach_api/coach/case-file/101/ksbs/K1');
});
