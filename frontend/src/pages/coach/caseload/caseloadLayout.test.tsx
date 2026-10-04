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
  id: '42', name: 'Emma Carter', initials: 'EC', employer: '--', cohortId: 'c1', cohortName: 'Business Admin L3', group: 'G1',
  status: 'on-track', enrollmentStatus: 'active', riskFlags: [], otjhStatus: 'on-track', overallProgress: 78, overallProgressAvailable: true,
  attendanceRate: 80, attendanceRateAvailable: true, attendanceSessions: 10, attendancePresent: 9, attendanceAbsent: 1, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  evidenceCount: 2, liveAttendanceRate: 90, liveAttendanceRateAvailable: true, nextCoaching: '20 Sep 2026', nextReview: '--',
  lastContact: '--', lastAttendanceDate: '--', lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--',
  lastActivity: '19 Sep 2026', lastActivityDate: '2026-09-19T12:30:00Z', lastActivityLabel: 'Latest quiz',
  lastSubmittedEvidence: '--', recentFlag: null, progressVariance: '--', startDate: '--', gatewayReviewDate: '--', plannedEndDate: '--',
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
    }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="name" sortDirection="asc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.getByLabelText('Activities: 88.8%')).toHaveTextContent('443 / 499');
    expect(screen.getByLabelText('KSBs: 66.8%')).toHaveTextContent('475 / 711');
    expect(screen.getByLabelText('Attendance: 82%')).toHaveTextContent('23 / 28');
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
    for (const heading of ['Learner', 'Status', 'Progress', 'Last Activity', 'Last PR', 'Last MCM', 'Actions']) {
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

  it('shows real learner progress and profile actions without a risk status label', () => {
    const onOpenProfile = vi.fn();
    const onSort = vi.fn();
    render(<LearnerTable learners={[learner]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={onSort} onToggleSelect={vi.fn()} onOpenProfile={onOpenProfile} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    expect(within(row).getByText('EC')).toBeInTheDocument();
    expect(within(row).queryByText('Customer Service Excellence')).not.toBeInTheDocument();
    for (const metric of ['OTJH: 78%', 'KSBs: 65%', 'Activities: 80%', 'Attendance: 90%']) {
      expect(within(row).getByLabelText(metric)).toBeInTheDocument();
    }
    for (const source of ['70h / 90h', '13 / 20', '8 / 10', '9 / 10']) expect(within(row).getByText(source)).toBeInTheDocument();
    expect(within(row).queryByText('On Track')).not.toBeInTheDocument();
    expect(within(row).getByLabelText('OTJH: 78%')).toHaveAttribute('data-tone', 'positive');
    expect(within(row).getByText('19 Sep 2026')).toBeInTheDocument();
    expect(within(row).getByText('2 days ago')).toBeInTheDocument();
    for (const label of ['Learner', 'OTJH', 'KSBs', 'Activities', 'Attendance', 'Last Activity', 'Last PR', 'Last MCM']) {
      expect(screen.getByRole('button', { name: `Sort by ${label}` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /Sort by/ })[0].querySelector('.lucide-arrow-up-down')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelector('.lucide-circle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sort by Actions' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by OTJH' }));
    expect(onSort).toHaveBeenCalledWith('otjh');
    fireEvent.click(within(row).getByRole('button', { name: 'View Profile' }));
    expect(onOpenProfile).toHaveBeenCalledWith(learner);
  });

  it('colours stale activity, PR and MCM recency at their agreed warning and critical thresholds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    try {
      render(<LearnerTable learners={[{
        ...learner,
        lastActivity: '19 Sep 2026',
        lastProgressReview: '11 Jul 2026',
        lastReview: '05 Sep 2026',
      }]} insights={new Map([['42', { ...insights.get('42')!, lastActivityDaysAgo: 14 }]])} selectionMode={false} selectedLearnerIds={new Set()}
        sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);

      expect(screen.getByText('14 days ago')).toHaveAttribute('data-tone', 'critical');
      expect(screen.getByText('84 days ago')).toHaveAttribute('data-tone', 'critical');
      expect(screen.getByText('28 days ago')).toHaveAttribute('data-tone', 'critical');
    } finally {
      vi.useRealTimers();
    }
  });

  it('colours the first stale recency threshold yellow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    try {
      render(<LearnerTable learners={[{
        ...learner,
        lastActivity: '26 Sep 2026',
        lastProgressReview: '25 Jul 2026',
        lastReview: '12 Sep 2026',
      }]} insights={new Map([['42', { ...insights.get('42')!, lastActivityDaysAgo: 7 }]])} selectionMode={false} selectedLearnerIds={new Set()}
        sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);

      expect(screen.getByText('7 days ago')).toHaveAttribute('data-tone', 'warning');
      expect(screen.getByText('70 days ago')).toHaveAttribute('data-tone', 'warning');
      expect(screen.getByText('21 days ago')).toHaveAttribute('data-tone', 'warning');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [120, 'OTJH: 58%', 'critical'],
    [100, 'OTJH: 70%', 'warning'],
    [90, 'OTJH: 78%', 'positive'],
  ] as const)('uses the canonical gap for target %s to colour OTJH', (otjhTarget, label, tone) => {
    render(<LearnerTable learners={[{ ...learner, otjhTarget }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      sortKey="risk" sortDirection="desc" onSort={vi.fn()} onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.getByLabelText(label)).toHaveAttribute('data-tone', tone);
  });

  it('omits unavailable KSB and attendance detail lines instead of displaying placeholder ratios', () => {
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

    expect(screen.getByLabelText('KSBs: not available').querySelector('[class*="miniRatio"]')).toBeNull();
    expect(screen.getByLabelText('Attendance: not available').querySelector('[class*="miniRatio"]')).toBeNull();
    expect(screen.getByLabelText('Activities: 80%')).toHaveTextContent('8 / 10');
  });
});
