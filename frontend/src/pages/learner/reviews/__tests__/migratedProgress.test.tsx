import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm } from '../LearnerReviewInstanceForm';

vi.mock('@/features/monthly-logs/page', () => ({ LearnerLogs: () => null }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({ SignaturePad: () => null }));
afterEach(cleanup);

const definition: LearnerReviewDefinition = {
  source: 'aptem', migratedForm: true, readOnly: true, manualOverride: null,
  instance: { id: 'imported-review:synthetic', reviewTemplateId: '', learnerId: 42, programmeId: 'P-42',
    occurrenceNumber: null, targetDate: '2026-10-04', status: 'completed', startedAt: null, completedAt: '2026-10-04' },
  template: { id: '', name: 'Migrated Progress Review', reviewTypeCode: 'aptem_progress_review',
    signatures: { advisor: true, participant: true, employer: true, referrer: false },
    visibleTo: { advisor: true, participant: true, employer: true, referrer: false },
    recurrence: { interval: 0, unit: 'none' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [],
  signatures: { advisor: { required: true, signed: true }, participant: { required: true, signed: true },
    employer: { required: true, signed: true }, referrer: { required: false, signed: false } },
  progressSnapshot: { calculatedFrom: '2025-01-02', calculatedAt: '2026-10-04T10:00:00Z', calculatedBy: 'coach@example.invalid',
    calculationMethod: 'planned_hours', weeksElapsed: 10,
    programmeProgress: { actual: 28, expected: 30, planned: 100, actualPercent: 28, expectedPercent: 30, variancePercent: -2, varianceDirection: 'below' },
    offTheJobHours: { actual: 64, expected: 52, planned: 100, actualPercent: 64, expectedPercent: 52, variancePercent: 12, varianceDirection: 'above' },
    ksbProgress: { available: false, reason: 'No assigned standard', title: '', actualPercent: null, expectedPercent: null, variancePercent: null, varianceDirection: null } },
};

describe('migrated progress for review participants', () => {
  it.each(['participant', 'employer'] as const)('shows the stored snapshot to %s without calculation controls', (viewerRole) => {
    render(<LearnerReviewInstanceForm definition={definition} viewerRole={viewerRole} />);
    expect(screen.getByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
  });

  it('keeps an uncalculated continuation visibly uncalculated', () => {
    render(<LearnerReviewInstanceForm definition={{ ...definition, progressSnapshot: null }} />);
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
  });
});
