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
  status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 78, overallProgressAvailable: true,
  attendanceRate: 80, attendanceRateAvailable: true, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  evidenceCount: 2, liveAttendanceRate: 90, liveAttendanceRateAvailable: true, nextCoaching: '20 Sep 2026', nextReview: '--',
  lastContact: '--', lastAttendanceDate: '--', lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--',
  lastSubmittedEvidence: '--', recentFlag: null, progressVariance: '--', startDate: '--', gatewayReviewDate: '--', plannedEndDate: '--',
  currentModule: 'Customer Service Excellence', currentWeek: 'Week 4', coachRag: 'Green',
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
    expect(screen.getAllByRole('row')).toHaveLength(13);
    expect(container.querySelectorAll('[class*="summaryCard"]')).toHaveLength(4);
    for (const heading of ['Learner', 'Current Module', 'Progress', 'Last Activity', 'Next Meeting', 'Status', 'Coach RAG', 'Actions']) {
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

  it('shows real learner progress, status, Coach RAG and profile actions in a table', () => {
    const onOpenProfile = vi.fn();
    render(<LearnerTable learners={[learner]} insights={insights} selectionMode={false} selectedLearnerIds={new Set()} savingCoachRagId={null}
      onToggleSelect={vi.fn()} onQuickView={vi.fn()} onOpenProfile={onOpenProfile} onCoachRagChange={vi.fn()} />);
    const row = screen.getByText('Emma Carter').closest('tr')!;
    expect(within(row).getByText('Customer Service Excellence')).toBeInTheDocument();
    for (const metric of ['OTJH', 'KSBs', 'Activities', 'Attendance']) expect(within(row).getByText(metric)).toBeInTheDocument();
    expect(within(row).getByText('On Track')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Coach RAG for Emma Carter' })).toHaveTextContent('Green');
    fireEvent.click(within(row).getByRole('button', { name: 'View Profile' }));
    expect(onOpenProfile).toHaveBeenCalledWith(learner);
  });
});
