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
  attendanceRate: 80, attendanceRateAvailable: true, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  evidenceCount: 2, liveAttendanceRate: 90, liveAttendanceRateAvailable: true, attendancePresent: 9, attendanceAbsent: 1, nextCoaching: '20 Sep 2026', nextReview: '--',
  lastContact: '--', lastAttendanceDate: '--', lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--',
  lastSubmittedEvidence: '--', recentFlag: null, progressVariance: '--', startDate: '--', gatewayReviewDate: '--', plannedEndDate: '--',
  currentModule: 'Customer Service Excellence', currentWeek: 'Week 4',
} satisfies Learner;

const insights: InsightMap = new Map([['42', {
  tier: 'on-track', riskLabel: 'On Track', reasons: [], criticalReasonCount: 0, otjhDeltaHours: -20,
  gatewayDate: null, gatewayDaysAway: null, lastActivityDaysAgo: 2, urgency: 1000,
}]]);

describe('My Learners table design', () => {
  it('uses loading placeholders that match the summary and learner table layouts', () => {
    const { container } = render(<><CaseloadSummaryLoading /><CaseloadLoading /></>);
    expect(screen.getByText('Loading learners')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Learners are loading' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(14);
    expect(container.querySelectorAll('[class*="summaryCard"]')).toHaveLength(4);
    for (const heading of ['Learner', 'Progress', 'Last Activity', 'Last PR', 'Last MCM', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
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

  it('shows real learner progress and profile actions without a status column', () => {
    const onOpenProfile = vi.fn();
    render(<LearnerTable learners={[learner]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      onToggleSelect={vi.fn()} onOpenProfile={onOpenProfile} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    expect(within(row).getByText('EC')).toBeInTheDocument();
    expect(within(row).queryByText('Customer Service Excellence')).not.toBeInTheDocument();
    for (const metric of ['OTJH: 78%', 'KSBs: 65%', 'Activities: 80%', 'Attendance: 90%']) {
      expect(within(row).getByLabelText(metric)).toBeInTheDocument();
    }
    for (const source of ['70h / 90h', '13 / 20', '8 / 10', '9 / 10']) expect(within(row).getByText(source)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(within(row).queryByText('On Track')).not.toBeInTheDocument();
    expect(within(row).getByLabelText('OTJH: 78%')).toHaveAttribute('data-tone', 'positive');
    expect(screen.getByRole('table').querySelector('thead svg')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'View Profile' }));
    expect(onOpenProfile).toHaveBeenCalledWith(learner);
  });

  it.each([
    ['at-risk', 'critical'],
    ['need-attention', 'warning'],
    ['on-track', 'positive'],
  ] as const)('uses the OTJH status to colour OTJH: %s', (otjhStatus, tone) => {
    render(<LearnerTable learners={[{ ...learner, otjhStatus }]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()}
      onToggleSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.getByLabelText('OTJH: 78%')).toHaveAttribute('data-tone', tone);
  });
});
