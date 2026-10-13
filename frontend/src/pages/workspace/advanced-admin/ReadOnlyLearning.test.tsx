import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import ReadOnlyLearning from './ReadOnlyLearning';

vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminComponent: vi.fn().mockResolvedValue({ component: { componentId: 'native-1', description: 'Current lesson content' } }),
  advancedAdminComponentFileUrl: vi.fn(),
  advancedAdminMaterial: vi.fn().mockResolvedValue({ media: [], reading_html: '<p>Archived lesson</p>',
    unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [] }),
  advancedAdminLegacyQuizReview: vi.fn().mockResolvedValue({ quiz: null }),
  advancedAdminComponentQuizReview: vi.fn().mockResolvedValue({ quiz: { body: '', questions: [] } }),
}));
vi.mock('@/pages/learner/my-learning/StudentMaterial', () => ({
  Media: () => null,
}));

const historical = {
  learner_name: 'Synthetic learner', progress_basis: 'catalogue_activities', count: 2,
  unique_activity_count: 2, module_count: 1, completed_count: 1, actual_total: 0,
  planned_total: 0, mapped_count: 0, planned_mapped_count: 0,
  subjects: [{ id: 1, name: 'Imported course', catalogue_count: 2, accepted_hours: 0 }],
  activities: [
    { activity_id: 'catalogue:1:material:10', source_activity_id: 10, group_id: 1,
      group_name: 'Imported course', activity: 'Completed reading', category: 'material',
      catalogue_kind: 'material', can_open_material: true, completed: true, status: 'Complete',
      date: null, actual: 0, planned: 0, hours_mapped: false, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
    { activity_id: 'catalogue:1:material:11', source_activity_id: 11, group_id: 1,
      group_name: 'Imported course', activity: 'Pending reading', category: 'material',
      catalogue_kind: 'material', can_open_material: true, completed: false, status: 'Not started',
      date: null, actual: 0, planned: 0, hours_mapped: false, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
  ],
} as StudentActivityResponse;

const current = {
  id: 7, modules: ['Current course'],
  components: [{ moduleId: 'module-1', componentId: 'native-1', component: 'Current lesson',
    module: 'Current course', type: 'reading' }],
  componentProgress: [{ componentId: 'native-1', kind: 'reading', passed: true }],
  quizAttempts: [],
} as unknown as LearnerDetail;

describe('advanced admin learning review', () => {
  it('opens the requested course activity from the module progress table', async () => {
    render(<MemoryRouter><ReadOnlyLearning learnerId={42} learning={{ current, historical }}
      initialSelection={{ subjectId: 'legacy:1', activityId: 'catalogue:1:material:11' }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Pending reading' })).toBeVisible();
    expect(await screen.findByText('Archived lesson')).toBeVisible();
  });

  it('uses course cards and opens both source activities with recorded completion and no learner action', async () => {
    render(<MemoryRouter><ReadOnlyLearning learnerId={42} learning={{ current, historical }} /></MemoryRouter>);
    const oldCard = screen.getByRole('button', { name: /Imported course.*Open subject/ });
    const newCard = screen.getByRole('button', { name: /Current course.*Open subject/ });
    expect(within(oldCard).getByText('1 of 2 completed')).toBeVisible();
    expect(within(oldCard).getByText('50%')).toBeVisible();
    expect(within(newCard).getByText('1 of 1 completed')).toBeVisible();
    expect(within(newCard).getByText('100%')).toBeVisible();

    fireEvent.click(oldCard);
    expect(await screen.findByText('Archived lesson')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Course activities' })).toHaveTextContent('Not complete');
    fireEvent.click(screen.getByRole('button', { name: /All courses/ }));
    fireEvent.click(screen.getByRole('button', { name: /Current course.*Open subject/ }));
    expect(await screen.findByText('Current lesson content')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Course activities' })).toHaveTextContent('Complete');
  });
});
