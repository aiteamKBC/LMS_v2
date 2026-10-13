import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumLearnerActivity, CurriculumLearnerActivityPlanItem, CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';
import LearnerModuleProgressPage from './page';
import { buildProgressRows, resolveProgressLearner, overallPercent } from './progressView';
import { completionEnd, localTimeInput } from './completionTime';

const { fetchImpact, fetchRoster, saveStatus, fetchHistory } = vi.hoisted(() => ({ fetchImpact: vi.fn(), fetchRoster: vi.fn(), saveStatus: vi.fn(), fetchHistory: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/mocks/navigation', () => ({ curriculumNavItems: [] }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumScopeLearnerKsbImpact: fetchImpact, fetchCurriculumScopeLearnerRoster: fetchRoster, saveCurriculumActivityStatus: saveStatus, fetchCurriculumActivityStatusHistory: fetchHistory }));

const learner = { id: 'profile-1', enrolmentId: 'enrolment-91', name: 'Test Learner', email: 'learner@example.com', programme: 'Business Management', programmeStatus: 'active', cohort: 'October 2026', group: 'Group A', lifecycleStatus: 'active' };
function plan(id: string, type: string, status = 'not_started', weekId = 'w1'): CurriculumLearnerActivityPlanItem {
  return {
    activityPlanId: `profile-1:${id}`, learnerId: 'profile-1', learnerName: learner.name, email: learner.email,
    cohort: learner.cohort, group: learner.group, componentId: id, componentTitle: `Test ${type} ${id}`,
    componentType: type, moduleCatalogueId: 'MOD-1', module: 'Digital Leadership', weekId, week: weekId === 'w1' ? 'Week 1 | Introduction' : 'Week 2 | Teams',
    displayOrder: Number(id.slice(1)), expectedOtjh: 1, points: 10, calculatedStatus: status,
    displayStatus: status, statusSource: 'calculated', progressId: status === 'completed' ? Number(id.slice(1)) : null,
    progressIds: [], progressStatus: status === 'completed' ? 'achieved' : '', submittedAt: '', countsTowardAchievement: null, source: 'curriculum_component',
  };
}
function fixture(): CurriculumScopeLearnerKsbImpactResponse {
  return {
    lineage: { moduleTitle: 'Digital Leadership', programmeName: 'Business Management', moduleCatalogueId: 'MOD-1' },
    assignedLearners: [learner],
    otjhAchievement: { learners: [{ learnerId: 'profile-1', achievedOtjh: 2, plannedOtjh: 6 }] },
    learnerKsbConsumption: [{ learnerId: 'profile-1', consumedWeightTotal: 1, cappedConsumedWeightTotal: 1, expectedWeightTotal: 2 }],
    learnerActivities: [],
    learnerActivityPlan: [plan('c1', 'reading', 'completed'), plan('c2', 'quiz', 'not_started'), plan('c3', 'assignment', 'in_progress'), plan('c4', 'audio', 'completed'), plan('c5', 'video', 'not_started', 'w2'), plan('c6', 'live-session', 'not_started', 'w2')],
    coverage: { items: [{ code: 'K1', mappings: [{ component_id: 'c2' }] }] },
  } as unknown as CurriculumScopeLearnerKsbImpactResponse;
}
function open(url = '/curriculum/learner-module-progress?moduleId=MOD-1&learnerId=profile-1') {
  return render(<MemoryRouter initialEntries={[url]}><LearnerModuleProgressPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchImpact.mockResolvedValue(fixture());
  fetchRoster.mockResolvedValue({ assignedLearners: [learner] });
  fetchHistory.mockResolvedValue({ history: [] });
});

function withLogStates() {
  const data = fixture();
  data.learnerActivityPlan = data.learnerActivityPlan?.map(row => ({ ...row, canChangeStatus: true, logState: {
    revision: 0, snapshotHash: `snapshot-${row.componentId}`, displayStatus: null, calculatedStatus: row.calculatedStatus, statusSource: 'calculated',
    actualOtjh: row.displayStatus === 'completed' ? 1 : 0, acceptedOtjh: row.displayStatus === 'completed' ? 1 : 0,
    hoursSource: 'learner_progress_entries.actual_seconds', startedAt: row.displayStatus === 'completed' ? '2026-10-01T09:00:00Z' : null,
    endedAt: row.displayStatus === 'completed' ? '2026-10-01T10:00:00Z' : null, progressId: row.progressId, accepted: row.displayStatus === 'completed',
  } }));
  return data;
}

describe('Activity status and Overall Progress', () => {
  it('averages the three card percentages and keeps the average unchanged by filters', async () => {
    fetchImpact.mockResolvedValue(withLogStates()); open(); await screen.findByText('Test reading c1');
    expect(screen.getByRole('progressbar', { name: 'Overall module progress' })).toHaveAttribute('aria-valuenow', '39');
    fireEvent.click(screen.getByRole('button', { name: 'Not Started' }));
    expect(screen.getByRole('progressbar', { name: 'Overall module progress' })).toHaveAttribute('aria-valuenow', '39');
    expect(overallPercent(null, 50, 40)).toBeNull();
    expect(overallPercent(30, 60, 90)).toBe(60);
  });

  it('changes Completed directly to Not Started while retaining OTH and time, with a scoped concurrency token', async () => {
    const data = withLogStates(); fetchImpact.mockResolvedValueOnce(data);
    const row = data.learnerActivityPlan![0];
    const state = { ...row.logState!, revision: 1, displayStatus: 'not_started', statusSource: 'manual' };
    saveStatus.mockResolvedValue({ state });
    fetchImpact.mockResolvedValue({ ...data, learnerActivityPlan: data.learnerActivityPlan?.map(item => item === row ? { ...item, logState: state, displayStatus: 'not_started', statusSource: 'manual' } : item) });
    open(); await screen.findByText('Test reading c1');
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test reading c1' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('1 / 6 completed'));
    expect(saveStatus).toHaveBeenCalledWith('MOD-1', 'profile-1', 'c1', expect.objectContaining({ displayStatus: 'not_started', expectedRevision: 0, snapshotHash: 'snapshot-c1' }));
    expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('durationSeconds');
    expect(screen.getByRole('article', { name: 'OTH Progress' })).toHaveTextContent('2h / 6h');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const liveRow = screen.getByText('Test reading c1').closest('tr')!;
    expect(liveRow).not.toHaveTextContent('Manual');
    expect(liveRow).toHaveTextContent('1h'); expect(liveRow).toHaveTextContent('10:00:00 → 11:00:00');
  });

  it('asks for OTH and start time, calculates the end and updates only the saved activity after success', async () => {
    const data = withLogStates(); fetchImpact.mockResolvedValue(data);
    let finish!: (result: unknown) => void;
    saveStatus.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    open(); await screen.findByText('Test quiz c2');
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test quiz c2' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark activity Completed' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Timestamp/ }));
    fireEvent.change(within(dialog).getByLabelText('Hours'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Minutes'), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText('Seconds'), { target: { value: '17' } });
    fireEvent.change(within(dialog).getByLabelText('Start date and time (UK)'), { target: { value: '2026-10-01T11:04:13' } });
    expect(within(dialog).queryByLabelText('Reason for change')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Calculated end time (UK)')).toHaveValue('1 Oct 2026, 12:24:30');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Completed' }));
    await waitFor(() => expect(saveStatus).toHaveBeenCalled());
    expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('2 / 6 completed');
    expect(saveStatus.mock.calls[0][3]).toMatchObject({ timeEntryMode: 'timestamp', durationSeconds: 4817, startedAt: '2026-10-01T10:04:13.000Z' });
    expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('reason');
    const original = data.learnerActivityPlan![1];
    const state = { ...original.logState!, revision: 1, displayStatus: 'completed', statusSource: 'manual', actualOtjh: 4817 / 3600, acceptedOtjh: 4817 / 3600, startedAt:'2026-10-01T10:04:13Z', endedAt:'2026-10-01T11:24:30Z' };
    fetchImpact.mockResolvedValue({ ...data, learnerActivityPlan: data.learnerActivityPlan?.map(row => row === original ? { ...row, logState: state, displayStatus: 'completed', statusSource: 'manual' } : row) });
    finish({ state });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('3 / 6 completed');
    expect(screen.getByRole('article', { name: 'KSB Progress' })).toHaveTextContent('1 / 2');
    expect(screen.getByText('Test video c5').closest('tr')).toHaveTextContent('Not Started');
    expect(screen.getByText('Test quiz c2').closest('tr')).not.toHaveTextContent('Manual');
  });

  it('lets Input save a date and OTH with no clocks or reason and preserves it after Not Started', async () => {
    const data=withLogStates();fetchImpact.mockResolvedValueOnce(data);
    open();await screen.findByText('Test quiz c2');
    fireEvent.click(screen.getByRole('button',{name:'Change status for Test quiz c2'}));
    fireEvent.click(screen.getByRole('radio',{name:/Input/}));
    expect(screen.queryByLabelText('Start date and time (UK)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Calculated end time (UK)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for change')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Minutes'),{target:{value:'32'}});
    fireEvent.change(screen.getByLabelText('Activity date'),{target:{value:'2026-10-01'}});
    const row=data.learnerActivityPlan![1];
    const state={...row.logState!,revision:1,displayStatus:'completed',actualOtjh:32/60,acceptedOtjh:32/60,timeEntryMode:'input' as const,activityDate:'2026-10-01'};
    const saved={...data,learnerActivityPlan:data.learnerActivityPlan?.map(item=>item===row?{...item,logState:state,displayStatus:'completed',statusSource:'manual'}:item)};
    saveStatus.mockResolvedValueOnce({state});fetchImpact.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button',{name:'Save Completed'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveStatus.mock.calls[0][3]).toMatchObject({timeEntryMode:'input',activityDate:'2026-10-01',durationSeconds:1920});
    expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('startedAt');expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('reason');
    const live=screen.getByText('Test quiz c2').closest('tr')!;
    expect(live).toHaveTextContent('Input');expect(live).toHaveTextContent('2026-10-01');expect(live).not.toHaveTextContent('Manual');
    saveStatus.mockResolvedValueOnce({state:{...state,revision:2,displayStatus:'not_started'}});
    fetchImpact.mockResolvedValueOnce({...saved,learnerActivityPlan:saved.learnerActivityPlan?.map(item=>item.componentId==='c2'?{...item,logState:{...state,revision:2,displayStatus:'not_started'},displayStatus:'not_started'}:item)});
    fireEvent.click(screen.getByRole('button',{name:'Change status for Test quiz c2'}));
    await waitFor(()=>expect(live).toHaveTextContent('Not Started'));
    expect(live).toHaveTextContent('Input');expect(live).toHaveTextContent('32m');expect(live).not.toHaveTextContent('Manual');
  });

  it('preserves input and current status when the server refuses a signed month or conflict', async () => {
    fetchImpact.mockResolvedValue(withLogStates()); saveStatus.mockRejectedValue(new Error('This Activity Log month is signed.'));
    open(); await screen.findByText('Test quiz c2');
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test quiz c2' }));
    fireEvent.click(screen.getByRole('radio', { name: /Timestamp/ }));
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value:'1' } });
    fireEvent.change(screen.getByLabelText('Start date and time (UK)'), { target: { value:'2026-10-01T11:00' } });
    fireEvent.click(screen.getByRole('button', { name:'Save Completed' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This Activity Log month is signed.');
    expect(screen.getByLabelText('Hours')).toHaveValue(1);
    expect(screen.getByRole('article', { name:'Activities Progress' })).toHaveTextContent('2 / 6 completed');
  });

  it('lets an authorized Attendance row ask for the attendance choice first and cancel without writing', async () => {
    fetchImpact.mockResolvedValue(withLogStates()); open(); await screen.findByText('Test live-session c6');
    const button = screen.getByRole('button', { name: 'Change status for Test live-session c6' });
    button.focus(); fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Record attendance' });
    expect(within(dialog).getByRole('radio', { name: /Attended/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Watched recording/ })).toBeVisible();
    expect(screen.queryByLabelText('Hours')).not.toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(button).toHaveFocus(); expect(saveStatus).not.toHaveBeenCalled();
  });

  it('credits Attended with 2h30 on the documented date and Not Started retains its hours', async () => {
    const data = withLogStates(); const row = data.learnerActivityPlan![5]; row.lectureDate = '2026-10-01';
    fetchImpact.mockResolvedValueOnce(data); open(); await screen.findByText('Test live-session c6');
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test live-session c6' }));
    fireEvent.click(screen.getByRole('radio', { name: /Attended/ }));
    expect(screen.getByText('2026-10-01')).toBeVisible(); expect(screen.queryByLabelText('Lecture date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for change')).not.toBeInTheDocument();
    const state = { ...row.logState!, revision: 1, displayStatus: 'completed', attendanceMode: 'attended' as const,
      actualOtjh: 2.5, acceptedOtjh: 2.5, timeEntryMode: 'input' as const, activityDate: '2026-10-01' };
    const saved = { ...data, learnerActivityPlan: data.learnerActivityPlan?.map(item => item === row ? { ...item, logState: state, displayStatus: 'completed' } : item) };
    saveStatus.mockResolvedValueOnce({ state }); fetchImpact.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Save Attended' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveStatus.mock.calls[0][3]).toMatchObject({ attendanceMode: 'attended', durationSeconds: 9000, timeEntryMode: 'input', activityDate: '2026-10-01' });
    const live = screen.getByText('Test live-session c6').closest('tr')!;
    expect(live).toHaveTextContent('Attended'); expect(live).toHaveTextContent('2h 30m'); expect(live).not.toHaveTextContent('Manual');
    saveStatus.mockResolvedValueOnce({ state: { ...state, revision: 2, displayStatus: 'not_started' } });
    fetchImpact.mockResolvedValueOnce({ ...saved, learnerActivityPlan: saved.learnerActivityPlan?.map(item => item.componentId === 'c6' ? { ...item, displayStatus: 'not_started' } : item) });
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test live-session c6' }));
    await waitFor(() => expect(live).toHaveTextContent('Not Started')); expect(live).toHaveTextContent('2h 30m');
    expect(saveStatus.mock.calls[1][3]).not.toHaveProperty('attendanceMode'); expect(saveStatus.mock.calls[1][3]).not.toHaveProperty('durationSeconds');
  });

  it.each(['input', 'timestamp'])('lets Watched recording use %s without asserting Attended', async mode => {
    const data = withLogStates(); fetchImpact.mockResolvedValue(data); open(); await screen.findByText('Test live-session c6');
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test live-session c6' }));
    fireEvent.click(screen.getByRole('radio', { name: /Watched recording/ })); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = screen.getByRole('dialog', { name: 'Record watched recording' });
    expect(saveStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('radio', { name: mode === 'input' ? /Input/ : /Timestamp/ }));
    fireEvent.change(within(dialog).getByLabelText('Minutes'), { target: { value: '30' } });
    if (mode === 'input') fireEvent.change(within(dialog).getByLabelText('Activity date'), { target: { value: '2026-10-01' } });
    else fireEvent.change(within(dialog).getByLabelText('Start date and time (UK)'), { target: { value: '2026-10-01T14:04:13' } });
    const row = data.learnerActivityPlan![5];
    saveStatus.mockResolvedValueOnce({ state: { ...row.logState!, revision: 1, attendanceMode: 'recording' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Completed' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveStatus.mock.calls[0][3]).toMatchObject({ attendanceMode: 'recording', durationSeconds: 1800, timeEntryMode: mode });
    expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('reason');
    if (mode === 'input') expect(saveStatus.mock.calls[0][3]).not.toHaveProperty('startedAt');
    else expect(saveStatus.mock.calls[0][3]).toHaveProperty('startedAt', '2026-10-01T13:04:13.000Z');
  });

  it('asks for an unlinked lecture date and keeps the choice on a failed save; permission hints remain respected', async () => {
    const data = withLogStates(); data.learnerActivityPlan![0].canChangeStatus = false; fetchImpact.mockResolvedValue(data);
    saveStatus.mockRejectedValue(new Error('This Activity Log month is signed.'));
    open(); await screen.findByText('Test live-session c6');
    expect(screen.queryByRole('button', { name: 'Change status for Test reading c1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change status for Test live-session c6' }));
    fireEvent.click(screen.getByRole('radio', { name: /Attended/ }));
    fireEvent.change(screen.getByLabelText('Lecture date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Attended' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This Activity Log month is signed.');
    expect(screen.getByLabelText('Lecture date')).toHaveValue('2026-10-01');
    expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('2 / 6 completed');
  });

  it('uses UK instants across BST and GMT', () => {
    expect(completionEnd('2026-07-01T09:04:13', 61)).toEqual({ start:'2026-07-01T08:04:13.000Z', end:'2026-07-01T08:05:14.000Z' });
    expect(completionEnd('2026-01-02T09:04:13', 61)).toEqual({ start:'2026-01-02T09:04:13.000Z', end:'2026-01-02T09:05:14.000Z' });
    expect(localTimeInput('2026-07-01T08:04:13Z')).toBe('2026-07-01T09:04:13');
  });

  it('loads audit history only when the owned activity drawer is opened', async () => {
    fetchImpact.mockResolvedValue(withLogStates());
    fetchHistory.mockResolvedValue({history:[{revision:1,actor_id:7,created_at:'2026-10-01T11:00:00Z',displayStatus:'completed',reason:'Reviewed learner declaration.'}]});
    open(); await screen.findByText('Test reading c1');
    expect(fetchHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'View details for Test reading c1'}));
    expect(await screen.findByText('Reviewed learner declaration.')).toBeVisible();
    expect(fetchHistory).toHaveBeenCalledWith('MOD-1','profile-1','c1',expect.any(AbortSignal));
    expect(screen.getByText(/Actor 7/)).toBeVisible();
  });
});

describe('LearnerModuleProgressPage', () => {
  it('shows every assigned activity, including no-history and incomplete rows, in the screenshot layout', async () => {
    open();
    await screen.findByText('Test reading c1');
    for (const row of fixture().learnerActivityPlan || []) expect(screen.getByText(row.componentTitle)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Progress Overview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Activity Type Breakdown' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Weekly Activity Breakdown' })).toBeVisible();
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Activity', 'OTH', 'KSBs', 'Points', 'Time', 'Status / Result', 'Actions']);
    expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('2 / 6 completed');
  });

  it('filters rows without changing the overall activity or type denominators', async () => {
    open(); await screen.findByText('Test reading c1');
    fireEvent.click(screen.getByRole('button', { name: 'Not Started' }));
    expect(screen.queryByText('Test reading c1')).not.toBeInTheDocument();
    expect(screen.getByText('Test quiz c2')).toBeVisible();
    expect(screen.getByText('Test video c5')).toBeVisible();
    expect(screen.getByRole('article', { name: 'Activities Progress' })).toHaveTextContent('2 / 6 completed');
    expect(screen.getByRole('progressbar', { name: 'Reading completion' })).toHaveAttribute('aria-valuenow', '100');
    fireEvent.change(screen.getByRole('combobox', { name: 'Activity type' }), { target: { value: 'Video' } });
    expect(screen.queryByText('Test quiz c2')).not.toBeInTheDocument();
    expect(screen.getByText('Test video c5')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search activities' }), { target: { value: 'unmatched' } });
    expect(screen.getByText('No activities match these filters')).toBeVisible();
  });

  it('expands every week by default and supports Collapse all and Expand all', async () => {
    open(); await screen.findByText('Test reading c1');
    expect(screen.getByText('Test video c5')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('retains Not Started activities in the details drawer and restores keyboard focus', async () => {
    open(); await screen.findByText('Test quiz c2');
    const button = screen.getByRole('button', { name: 'View details for Test quiz c2' });
    button.focus(); fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Test quiz c2 details' });
    expect(within(dialog).getByText('Not Started')).toBeVisible();
    expect(within(dialog).getAllByText('Not recorded').length).toBeGreaterThan(0);
    const close = within(dialog).getByRole('button', { name: 'Close activity details' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' }); expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(button).toHaveFocus();
  });

  it('resolves enrolment links using the explicit bridge, never the profile with the same numeric ID', async () => {
    const data = fixture();
    data.assignedLearners = [{ ...learner, id: 77, enrolmentId: 51 }, { ...learner, id: 51, enrolmentId: 99, name: 'Other Learner' }];
    data.learnerActivityPlan = [{ ...plan('c1', 'reading'), learnerId: 77 }];
    fetchImpact.mockResolvedValue(data); fetchRoster.mockResolvedValue({ assignedLearners: data.assignedLearners });
    open('/curriculum/learner-module-progress?moduleId=MOD-1&enrolmentId=51');
    await screen.findByText('Test reading c1');
    expect(screen.getByText('Learner ID: 77')).toBeVisible(); expect(screen.queryByText('Other Learner')).not.toBeInTheDocument();
  });

  it('shows N/A for zero denominators and does not show a fabricated learner identity', async () => {
    const data = fixture();
    data.learnerActivityPlan = [];
    data.otjhAchievement.learners[0].plannedOtjh = 0;
    data.learnerKsbConsumption[0].expectedWeightTotal = 0;
    fetchImpact.mockResolvedValue(data); open();
    await screen.findByText('No assigned activities returned');
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0); expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('retries a failed read without writing progress or reloading the app', async () => {
    fetchImpact.mockRejectedValueOnce(new Error('Read unavailable')); open();
    await screen.findByText('Read unavailable');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByText('Test reading c1'); expect(fetchImpact).toHaveBeenCalledTimes(2);
  });
});

describe('progress display mapping', () => {
  it('binds history by progress identity and preserves component order across duplicate week titles', () => {
    const data = fixture();
    data.learnerActivityPlan = [plan('c2', 'reading', 'completed'), plan('c1', 'reading', 'completed'), { ...plan('c3', 'quiz', 'not_started', 'w2'), week: 'Week 1 | Introduction' }];
    data.learnerActivities = [
      { progressId: 999, learnerId: 'profile-1', componentId: 'c1', actualOtjh: 100 },
      { progressId: 1, learnerId: 'profile-1', componentId: 'c1', actualOtjh: 1 },
    ] as CurriculumLearnerActivity[];
    const rows = buildProgressRows(data, 'profile-1');
    expect(rows.map(row => row.activity.componentId)).toEqual(['c1', 'c2', 'c3']);
    expect(rows[0].history?.actualOtjh).toBe(1);
    expect(rows[2].weekId).toBe('w2');
  });

  it('fails closed on missing or ambiguous enrolment identity links', () => {
    expect(resolveProgressLearner([{ ...learner, id: 51, enrolmentId: 99 }], '', '51')).toBeNull();
    expect(resolveProgressLearner([{ ...learner, id: 77, enrolmentId: 51 }, { ...learner, id: 78, enrolmentId: 51 }], '', '51')).toBeNull();
  });
});
