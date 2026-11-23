import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchLearnerFreeCourse,
  fetchLearnerFreeCourses,
  markFreeCourseActivityComplete,
  peekLearnerFreeCourses,
  type FreeCourse,
  type FreeCourseSummary,
} from '@/api/freeCourses';
import { FreeCoursesTab } from './FreeCoursesTab';

vi.mock('@/api/freeCourses', () => ({
  fetchLearnerFreeCourses: vi.fn(),
  fetchLearnerFreeCourse: vi.fn(),
  markFreeCourseActivityComplete: vi.fn(),
  peekLearnerFreeCourses: vi.fn(),
}));
vi.mock('./FreeCourseMaterial', () => ({
  FreeCourseMaterial: ({ activity }: { activity: { title: string } }) => <div>Material: {activity.title}</div>,
}));
vi.mock('./FreeCourseQuiz', () => ({
  FreeCourseQuiz: ({ readOnly }: { readOnly?: boolean }) => <div>{readOnly ? 'Read-only quiz preview' : 'Interactive quiz'}</div>,
}));
vi.mock('./SubjectWorkspace', async importOriginal => ({ ...await importOriginal<typeof import('./SubjectWorkspace')>(), Cover: ({ title }: { title: string }) => <div>Cover {title}</div> }));
vi.mock('@/api/learnerCertificates', () => ({ fetchLearnerCertificateTemplate: vi.fn(async () => ({ template: null, csrfToken: '' })) }));

const summary: FreeCourseSummary = {
  freeCourseId: 'FREE-1', courseName: 'Canonical course', description: 'Description', coverImageUrl: '',
  weekCount: 2, activityCount: 2, completedActivities: 0, progressPercentage: 0,
};
const detail: FreeCourse = {
  freeCourseId: 'FREE-1', courseName: 'Canonical course', description: 'Description', coverImageUrl: '',
  weeks: [
    { weekId: 'W-1', weekNumber: 1, weekTitle: 'First week', displayOrder: 0, activities: [
      { componentId: 'C-1', title: 'Read first', type: 'reading', contentHtml: '<p>Body</p>', completed: false },
    ] },
    { weekId: 'W-2', weekNumber: 2, weekTitle: 'Second week', displayOrder: 1, activities: [
      { componentId: 'Q-1', title: 'Final quiz', type: 'quiz', quizId: '7', completed: false },
    ] },
  ],
};

function mount(kind: 'commercial' | 'apprenticeship' = 'commercial', readOnly = false) {
  return render(<MemoryRouter><FreeCoursesTab kind={kind} id="19" readOnly={readOnly} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(peekLearnerFreeCourses).mockReturnValue(undefined);
  vi.mocked(fetchLearnerFreeCourses).mockResolvedValue([summary]);
  vi.mocked(fetchLearnerFreeCourse).mockResolvedValue(detail);
  vi.mocked(markFreeCourseActivityComplete).mockResolvedValue(undefined);
});

describe('assigned Free Courses learner flow', () => {
  it('shows previously accepted ledger time without awarding completion', async () => {
    vi.mocked(fetchLearnerFreeCourse).mockResolvedValue({ ...detail, acceptedActualSeconds: 137310 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Canonical course/ }));
    expect(await screen.findByText(/Previously accepted time: 137,310 seconds/)).toBeVisible();
    expect(screen.getByText('0 of 2 completed')).toBeVisible();
    expect(markFreeCourseActivityComplete).not.toHaveBeenCalled();
  });
  it('keeps existing completion separate from additional accepted time', async () => {
    vi.mocked(fetchLearnerFreeCourses).mockResolvedValue([
      { ...summary, completedActivities: 2, progressPercentage: 100, acceptedActualSeconds: 68427 },
    ]);
    vi.mocked(fetchLearnerFreeCourse).mockResolvedValue({
      ...detail, acceptedActualSeconds: 68427,
      weeks: detail.weeks.map(week => ({ ...week, activities: week.activities.map(activity => ({
        ...activity, completed: true, is_completed: true,
      })) })),
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Canonical course/ }));
    expect(await screen.findByText(/Previously accepted time: 68,427 seconds/)).toBeVisible();
    expect(screen.getByText('2 of 2 completed')).toBeVisible();
    expect(markFreeCourseActivityComplete).not.toHaveBeenCalled();
  });
  it.each(['commercial', 'apprenticeship'] as const)('loads cards first and %s details only after opening', async kind => {
    mount(kind);
    const card = await screen.findByRole('button', { name: /Canonical course/ });
    expect(screen.getByText('0 of 2 completed')).toBeVisible();
    expect(fetchLearnerFreeCourse).not.toHaveBeenCalled();

    fireEvent.click(card);
    expect(await screen.findByText('Material: Read first')).toBeVisible();
    expect(fetchLearnerFreeCourse).toHaveBeenCalledWith(kind, '19', 'FREE-1', false);
    expect(screen.getByText('First week')).toBeVisible();
    expect(screen.getByText('Second week')).toBeVisible();
  });

  it('keeps completion visible after the isolated save succeeds', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Canonical course/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as complete' }));
    await waitFor(() => expect(markFreeCourseActivityComplete).toHaveBeenCalledWith('commercial', '19', 'C-1'));
    expect(await screen.findByText('1 of 2 completed')).toBeVisible();
  });

  it('keeps staff preview read-only for materials and quizzes', async () => {
    mount('commercial', true);
    fireEvent.click(await screen.findByRole('button', { name: /Canonical course/ }));
    expect(await screen.findByText(/Staff preview is read-only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark as complete' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Final quiz/ }));
    expect(await screen.findByText('Read-only quiz preview')).toBeVisible();
  });

  it('shows the existing empty state when nothing is assigned', async () => {
    vi.mocked(fetchLearnerFreeCourses).mockResolvedValue([]);
    mount();
    expect(await screen.findByText('No free courses yet')).toBeVisible();
  });
});


describe('migrated activity states', () => {
  it('counts a completion without a date and resumes the viewed incomplete reading', async () => {
    vi.mocked(fetchLearnerFreeCourse).mockResolvedValue({ ...detail, weeks: [
      { ...detail.weeks[0], activities: [
        { ...detail.weeks[0].activities[0], completed: false, is_completed: true,
          activity_state: 'completed', completed_at: null },
        { componentId: 'READ-2', title: 'Read next', type: 'reading', contentHtml: '<p>Next</p>',
          is_completed: false, activity_state: 'reading_viewed' },
      ] },
    ] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Canonical course/ }));
    expect(await screen.findByText('Material: Read next')).toBeVisible();
    expect(screen.getByText('1 of 2 completed')).toBeVisible();
    expect(screen.getByText(/Viewed/)).toBeVisible();
    expect(markFreeCourseActivityComplete).not.toHaveBeenCalled();
  });
});
