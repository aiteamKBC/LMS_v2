import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityItem, StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary, StudentActivityPanel, subjectsFrom } from './SubjectWorkspace';

const activity = (course: number, kind: string, id: number): StudentActivityItem => ({
  activity_id: `record:${course}:${id}`, source_activity_id: 10, group_id: course,
  group_name: `Course ${course}`, activity: `${kind} ${id}`, category: kind, catalogue_kind: kind,
  can_open_material: kind === 'material', completed: true, status: 'Complete', date: null,
  actual: 0.3, planned: 0, hours_mapped: true, planned_hours_mapped: false,
  quiz_score: null, quiz_maximum_score: null,
});
const data: StudentActivityResponse = {
  learner_name: 'Synthetic learner', progress_basis: 'recorded_activities', count: 3,
  unique_activity_count: 3, module_count: 2, completed_count: 3, actual_total: 0.9,
  planned_total: null, mapped_count: 3, planned_mapped_count: 0,
  subjects: [{ id: 1, name: 'Course 1', module_id: 'HISTORY', catalogue_count: 265, accepted_hours: 0.3 },
    { id: 2, name: 'Course 2', catalogue_count: 36, accepted_hours: 0.6 }],
  activities: [activity(1, 'quiz', 1), activity(2, 'material', 2), activity(2, 'quiz', 3)],
};

describe('recorded historical course progress', () => {
  it('keeps quiz/material namespaces and placements in different courses', () => {
    const result = buildUnifiedLearningSummary(data, null);
    expect(result.subjects.map(s => s.activities.length)).toEqual([1, 2]);
    expect(result.completedActivityCount).toBe(3);
    expect(result.percent).toBe(100);
  });

  it('does not mix historical catalogue components into recorded progress or duplicate the current module', () => {
    const real = { modules: ['Current KSBs'], components: [
      { moduleId: 'CURRENT', componentId: 'C1', component: 'Current task', module: 'Current KSBs', type: 'reading' },
      { moduleId: 'HISTORY', componentId: 'C2', component: 'Catalogue-only task', module: 'Course 1', type: 'reading' },
    ], progress: [], quizAttempts: [] } as unknown as LearnerDetail;
    const result = subjectsFrom(data, real, { covers: {}, current_subjects: [
      { id: 'CURRENT', title: 'Current KSBs' }, { id: 'HISTORY', title: 'Course 1' },
    ] });
    expect(result.filter(s => s.title === 'Current KSBs')).toHaveLength(1);
    expect(result.find(s => s.id === 'legacy:1')?.activities).toHaveLength(1);
    expect(result.find(s => s.id === 'current:CURRENT')?.activities).toHaveLength(1);
    expect(result.some(s => s.id === 'current:HISTORY')).toBe(false);
  });

  it('shows the catalogue separately from the recorded denominator and accepted time', () => {
    render(<MemoryRouter><StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Recorded activities only.*Full catalogue: 265/)).toBeVisible();
    expect(screen.getByText(/Accepted time: 18m/)).toBeVisible();
    expect(screen.getByText('1 of 1 completed')).toBeVisible();
  });
});
