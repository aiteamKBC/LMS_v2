import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CaseloadSummary } from './components/CaseloadSummary';
import { CaseloadLoading, CaseloadSummaryLoading } from './components/CaseloadStates';
import { LearnerTable } from './components/LearnerTable';
import type { CaseloadCounts, InsightMap } from './lib/attention';
import type { Learner } from './types';

const counts: CaseloadCounts = {
  total: 24, critical: 3, attention: 4, upcoming: 1, onTrack: 16,
  onBreak: 0, withdrawn: 0, readyToEnrol: 0, needsAction: 8,
};

const learner = {
  id: '42', name: 'Emma Carter', initials: 'EC', employer: '--', cohortId: 'c1', cohortName: 'Business Admin L3', programmeName: 'Customer Service Practitioner L2', group: 'G1',
  status: 'on-track', enrollmentStatus: 'active', riskFlags: [], otjhStatus: 'on-track', overallProgress: 78, overallProgressAvailable: true,
  attendanceRate: 80, attendanceRateAvailable: true, attendanceSessions: 10, attendancePresent: 9, attendanceAbsent: 1, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  evidenceCount: 2, liveAttendanceRate: 90, liveAttendanceRateAvailable: true, nextCoaching: '20 Sep 2026', nextReview: '--',
  lastContact: '--', lastAttendanceDate: '--', lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--',
  lastActivity: '19 Sep 2026', lastActivityDate: '2026-09-19T12:30:00Z', lastActivityLabel: 'Latest quiz',
  lastSubmittedEvidence: '--', recentFlag: null, progressVariance: '--', startDate: '01 Jan 2020', gatewayReviewDate: '--', plannedEndDate: '01 Jan 2021',
  otjhPlanned: 90,
  currentModule: 'Customer Service Excellence', currentWeek: 'Week 4',
} satisfies Learner;

const insights: InsightMap = new Map([['42', {
  tier: 'on-track', riskLabel: 'On Track', reasons: [], criticalReasonCount: 0, otjhDeltaHours: -20,
  gatewayDate: null, gatewayDaysAway: null, lastActivityDaysAgo: 2, urgency: 1000,
}]]);

describe('My Learners table design', () => {
  it('preserves learner-dashboard precision and shows OTJ actual hours when the plan is unavailable', () => {
    render(<LearnerTable learners={[{
      ...learner,
      activityProgress: 88.8,
      activityProgressAvailable: true,
      componentsCompleted: 443,
      componentsPlanned: 499,
      ksbProgress: 66.8,
      ksbCompleted: 475,
      ksbTarget: 711,
      liveAttendanceRate: 82,
      liveAttendanceRateAvailable: true,
      attendancePresent: 23,
      attendanceSessions: 28,
      otjhCompleted: 308.11,
      otjhTarget: 0,
      otjhPlanned: 0,
    }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="name" sortDirection="asc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.getByLabelText('Activities: 88.8%')).toHaveTextContent('443 / 499');
    expect(screen.getByLabelText('Attendance: 82%')).not.toHaveTextContent('23 / 28');
    expect(screen.getByLabelText('Attendance: 82%').querySelector('[class*="miniRatio"]')).toBeNull();
    expect(screen.getByLabelText('OTJH: not available')).toHaveTextContent('308.11h / --');
  });

  it('uses loading placeholders that match the summary and learner table layouts', () => {
    const { container } = render(<><CaseloadSummaryLoading /><CaseloadLoading /></>);
    expect(screen.getByText('Loading learners')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Learners are loading' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(14);
    expect(container.querySelectorAll('[class*="summaryCard"]')).toHaveLength(4);
    // Issue #12: the loading table mirrors the real one, including the
    // programme Status column.
    for (const heading of ['Learner', 'Status', 'Progress', 'Start Date', 'Last Activity', 'Last PR', 'Last MCM', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
  });

  it('renders the four requested summary cards and uses them as filters', () => {
    const onChange = vi.fn();
    render(<CaseloadSummary counts={counts} value="all" onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Total Learners 24/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /At Risk 3/i }));
    expect(onChange).toHaveBeenCalledWith('at-risk');
  });

  it('shows each learner\'s programme status, not their risk tier, in the Status column (issue #12)', () => {
    render(<LearnerTable learners={[
      { ...learner, rawProgramStatus: 'Active' },
      { ...learner, id: '43', name: 'Sam Example', initials: 'SE', rawProgramStatus: 'Withdrawn', enrollmentStatus: 'withdrawn' },
      { ...learner, id: '44', name: 'No Status', initials: 'NS', rawProgramStatus: '--' },
    ]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    const header = screen.getByRole('columnheader', { name: 'Status' });
    expect(header).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sort by Status' })).not.toBeInTheDocument();
    const cellIndex = (row: HTMLElement) => within(row).getAllByRole('cell')[1];
    const active = screen.getByText('Emma Carter').closest('tr')!;
    expect(cellIndex(active)).toHaveTextContent('Active');
    expect(within(cellIndex(active)).getByText('Active').className).toContain('emerald');
    const withdrawn = screen.getByText('Sam Example').closest('tr')!;
    expect(cellIndex(withdrawn)).toHaveTextContent('Withdrawn');
    expect(within(cellIndex(withdrawn)).getByText('Withdrawn').className).not.toContain('emerald');
    // Withdrawn learners stay listed rather than being hidden.
    expect(screen.getAllByRole('button', { name: 'View Profile' })).toHaveLength(3);
    const missing = screen.getByText('No Status').closest('tr')!;
    expect(cellIndex(missing).textContent).toBe('--');
    expect(within(active).queryByText('On Track')).not.toBeInTheDocument();
  });

  it.each([
    ['Onboarding', 'onboarding'],
    ['Withdrawn', 'withdrawn'],
  ] as const)('shows %s in OTJH instead of calculating a target', (label, rawProgramStatus) => {
    render(<LearnerTable learners={[{
      ...learner,
      rawProgramStatus,
      enrollmentStatus: rawProgramStatus === 'withdrawn' ? 'withdrawn' : 'unknown',
      otjhCompleted: 15,
      otjhPlanned: 355,
      startDate: '15 Jun 2026',
      plannedEndDate: '01 Apr 2027',
    }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="name" sortDirection="asc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent(label);
    expect(within(cells[2]).queryByLabelText(/OTJH:/)).not.toBeInTheDocument();
  });

  it('shows real learner progress and profile actions without a risk status label', () => {
    const onOpenProfile = vi.fn();
    const onSort = vi.fn();
    render(<LearnerTable learners={[learner]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={onSort} onToggleSelect={vi.fn()} onOpenProfile={onOpenProfile} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    expect(within(row).getByText('EC')).toBeInTheDocument();
    expect(within(row).getByText('Customer Service Practitioner L2')).toBeInTheDocument();
    expect(within(row).queryByText('Business Admin L3')).not.toBeInTheDocument();
    expect(within(row).queryByText('Customer Service Excellence')).not.toBeInTheDocument();
    for (const metric of ['OTJH: 78%', 'Activities: 80%', 'Attendance: 90%']) {
      expect(within(row).getByLabelText(metric)).toBeInTheDocument();
    }
    for (const source of ['70h / 90h', '8 / 10']) expect(within(row).getByText(source)).toBeInTheDocument();
    expect(within(row).queryByText('9 / 10')).not.toBeInTheDocument();
    expect(within(row).queryByText('On Track')).not.toBeInTheDocument();
    expect(within(row).getByLabelText('OTJH: 78%')).toHaveAttribute('data-tone', 'positive');
    expect(within(row).getByText('01 Jan 2020')).toBeInTheDocument();
    expect(within(row).queryByText('Programme start')).not.toBeInTheDocument();
    expect(within(row).getByText('19 Sep 2026')).toBeInTheDocument();
    expect(within(row).getByText('2 days ago')).toBeInTheDocument();
    for (const label of ['Learner', 'OTJH', 'Activities', 'Attendance', 'Start Date', 'Last Activity', 'Last PR', 'Last MCM']) {
      expect(screen.getByRole('button', { name: `Sort by ${label}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('columnheader', { name: 'KSBs' })).not.toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.findIndex(header => header.textContent?.includes('Start Date')))
      .toBeLessThan(headers.findIndex(header => header.textContent?.includes('Last Activity')));
    expect(screen.getAllByRole('button', { name: /Sort by/ })[0].querySelector('.lucide-arrow-up-down')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelector('.lucide-circle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sort by Actions' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Start Date' }));
    expect(onSort).toHaveBeenCalledWith('start-date');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by OTJH' }));
    expect(onSort).toHaveBeenCalledWith('otjh');
    fireEvent.click(within(row).getByRole('button', { name: 'View Profile' }));
    expect(onOpenProfile).toHaveBeenCalledWith(learner);
  });

  it('colours overdue activity, progress reviews and MCMs only after their thresholds', () => {
    const today = new Date(2026, 8, 30);
    const thresholdLearner = {
      ...learner,
      id: 'threshold',
      name: 'Threshold Learner',
      lastProgressReview: '22 Jul 2026',
      lastReview: '09 Sep 2026',
    };
    const warningLearner = {
      ...learner,
      id: 'warning',
      name: 'Warning Learner',
      lastProgressReview: '21 Jul 2026',
      lastReview: '08 Sep 2026',
    };
    const criticalLearner = {
      ...learner,
      id: 'critical',
      name: 'Critical Learner',
      lastProgressReview: '07 Jul 2026',
      lastReview: '01 Sep 2026',
    };
    const datedInsights: InsightMap = new Map([
      ['threshold', { ...insights.get('42')!, lastActivityDaysAgo: 7 }],
      ['warning', { ...insights.get('42')!, lastActivityDaysAgo: 8 }],
      ['critical', { ...insights.get('42')!, lastActivityDaysAgo: 15 }],
    ]);

    render(<LearnerTable learners={[thresholdLearner, warningLearner, criticalLearner]} insights={datedInsights}
      selectionMode={false} selectedLearnerIds={new Set()} sortKey="name" sortDirection="asc" onSort={vi.fn()}
      onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} today={today} />);

    const tones = (name: string) => {
      const row = screen.getByText(name).closest('tr')!;
      return {
        activity: row.querySelector('[data-metric="activity"]'),
        progressReview: row.querySelector('[data-metric="progress-review"]'),
        monthlyCoaching: row.querySelector('[data-metric="monthly-coaching"]'),
      };
    };
    for (const metric of Object.values(tones('Threshold Learner'))) expect(metric).not.toHaveAttribute('data-tone');
    for (const metric of Object.values(tones('Warning Learner'))) expect(metric).toHaveAttribute('data-tone', 'warning');
    for (const metric of Object.values(tones('Critical Learner'))) expect(metric).toHaveAttribute('data-tone', 'critical');
  });

  it('uses programme start for missing MCM and PR dates without colouring an undated learner', () => {
    const noReview = {
      ...learner,
      id: 'no-review',
      name: 'No Review Learner',
      startDate: '07 Jul 2026',
      lastProgressReview: '--',
      lastReview: '--',
    };
    const noDates = { ...noReview, id: 'no-dates', name: 'No Dates Learner', startDate: '--' };

    render(<LearnerTable learners={[noReview, noDates]} insights={new Map()} selectionMode={false}
      selectedLearnerIds={new Set()} sortKey="name" sortDirection="asc" onSort={vi.fn()} onToggleSelect={vi.fn()}
      onOpenProfile={vi.fn()} today={new Date(2026, 8, 30)} />);

    const noReviewRow = screen.getByText('No Review Learner').closest('tr')!;
    expect(noReviewRow.querySelector('[data-metric="progress-review"]')).toHaveAttribute('data-tone', 'critical');
    expect(noReviewRow.querySelector('[data-metric="monthly-coaching"]')).toHaveAttribute('data-tone', 'critical');
    expect(within(noReviewRow).getByText('No PR yet')).toBeInTheDocument();
    expect(within(noReviewRow).getByText('No MCM yet')).toBeInTheDocument();

    const noDatesRow = screen.getByText('No Dates Learner').closest('tr')!;
    expect(noDatesRow.querySelector('[data-metric="progress-review"]')).not.toHaveAttribute('data-tone');
    expect(noDatesRow.querySelector('[data-metric="monthly-coaching"]')).not.toHaveAttribute('data-tone');
  });

  it('does not show the cohort under the learner name when a programme is unavailable', () => {
    render(<LearnerTable learners={[{ ...learner, programmeName: undefined }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="name" sortDirection="asc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    const learnerCell = within(row).getAllByRole('cell')[0];
    expect(within(learnerCell).queryByText('Business Admin L3')).not.toBeInTheDocument();
    expect(within(learnerCell).getByText('--')).toBeInTheDocument();
  });

  it.each([
    [120, 'critical'],
    [100, 'warning'],
    [90, 'positive'],
  ] as const)('uses the canonical gap for target %s to colour OTJH', (otjhTarget, tone) => {
    render(<LearnerTable learners={[{ ...learner, otjhTarget, otjhPlanned: otjhTarget }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(document.querySelector('[data-metric="otjh"]')).toHaveAttribute('data-tone', tone);
  });

  it('omits unavailable attendance detail lines instead of displaying placeholder ratios', () => {
    render(<LearnerTable learners={[{
      ...learner,
      ksbProgress: null,
      ksbProgressAvailable: false,
      ksbCompleted: null,
      ksbTarget: null,
      liveAttendanceRate: null,
      liveAttendanceRateAvailable: false,
      attendancePresent: null,
      attendanceSessions: null,
    }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.getByLabelText('Attendance: not available').querySelector('[class*="miniRatio"]')).toBeNull();
    expect(screen.getByLabelText('Activities: 80%')).toHaveTextContent('8 / 10');
  });
});
