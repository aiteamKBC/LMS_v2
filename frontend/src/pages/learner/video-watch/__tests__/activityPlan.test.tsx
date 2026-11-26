import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { Subject, SubjectEntry } from '../../my-learning/learningSummary';
import type { LearningWeek } from '../../my-learning/subjectLearning';
import { SubjectActivityWorkspace } from '../../my-learning/SubjectActivityWorkspace';
import { ActivitySidebar } from '../ActivitySidebar';
import type { ActivitySidebarProps } from '../ActivitySidebar';
import { ActivityPlanDetails } from '../ActivityPlanDetails';

vi.mock('@/api/learnerOverview', () => ({ learningSchedule: { read: vi.fn().mockResolvedValue({ modules: [] }), peek: () => undefined } }));

const components: JourneyComponent[] = [
  { componentId: 'WELCOME', title: 'Welcome', type: 'reading', expectedOtjh: 0, contentHtml: '<p>Welcome</p>' },
  { componentId: 'READ', title: 'Read the case', type: 'reading', expectedOtjh: 1.5, pointNumber: 1, contentHtml: '<p>Read</p>' },
  { componentId: 'AUDIO', title: 'Listen to the case', type: 'podcast', expectedOtjh: 0, pointNumber: 1, audioUrl: 'https://example.org/audio.mp3' },
  { componentId: 'QUIZ', title: 'Check understanding', type: 'quiz', expectedOtjh: 0, pointNumber: 1, isQuiz: true,
    quizMeta: { quizId: 7, questions: 4, duration: 20, timeUnit: 'minutes' } },
  { componentId: 'LOCKED', title: 'Later reading', type: 'reading', expectedOtjh: 0.75 },
  { componentId: 'UNKNOWN', title: 'Further material', type: 'video', expectedOtjh: null, durationMinutes: 45, videoUrl: 'https://example.org/video.mp4' },
];
const props: ActivitySidebarProps = {
  weekComponents: components, weekTitle: 'Week 1', moduleTitle: 'Project controls',
  weeks: [{ key: 'W1', week: 'Week 1', count: components.length, completed: 1, active: true, components },
    { key: 'W2', week: 'Week 2', count: 1, completed: 0, active: false, components: [components[0]] }],
  completedIds: new Set(['READ']), currentComponentId: 'READ',
  routeFor: c => `/learner/component/commercial/132/${c.componentId}`,
};
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function mount(overrides: Partial<ActivitySidebarProps> = {}) {
  return render(<MemoryRouter initialEntries={['/learner/component/commercial/132/READ']}>
    <ActivitySidebar {...props} {...overrides} /><Location />
  </MemoryRouter>);
}

describe('planned activity guidance', () => {
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not imply required study time for unavailable or unallocated hours (%s)', hours => {
    const { container } = render(<ActivityPlanDetails hours={hours} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows allocated hours and Required text without substituting media duration or inventing optional status', () => {
    mount();
    const reading = screen.getByRole('button', { name: /Read the case/ });
    expect(within(reading).getByText('Required')).toBeVisible();
    expect(reading).toHaveTextContent('Planned time: 1h 30m');
    const locked = screen.getByRole('button', { name: /Later reading/ });
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent('Required');
    expect(locked).toHaveTextContent('Planned time: 45m');
    for (const title of ['Welcome', 'Listen to the case', 'Check understanding', 'Further material']) {
      const row = screen.getByRole('button', { name: new RegExp(title) });
      expect(row).not.toHaveTextContent(/Required|Planned time|Optional/);
    }
  });

  it('filters the flat week, retains related quizzes and preserves progress totals and the route', () => {
    mount();
    expect(screen.getByRole('button', { name: 'All activities' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Required only' }));
    expect(screen.getByRole('button', { name: 'Required only' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Welcome/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Listen to the case/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Point 1 activities' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read the case/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Check understanding/ })).toBeVisible();
    const totals = within(screen.getByRole('heading', { name: 'Week 1' }).parentElement!).getByText(/6 components/);
    expect(totals).toHaveTextContent('1 done');
    expect(totals).toHaveTextContent('3 shown');
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/READ');
    fireEvent.click(screen.getByRole('button', { name: 'All activities' }));
    expect(screen.getByRole('button', { name: /Listen to the case/ })).toBeVisible();
  });

  it('keeps an open activity with no allocated hours visible, without navigating or changing its status', () => {
    mount({ currentComponentId: 'AUDIO' });
    fireEvent.click(screen.getByRole('button', { name: 'Required only' }));
    const audio = screen.getByRole('button', { name: /Listen to the case/ });
    expect(audio).toBeVisible();
    expect(audio).not.toHaveTextContent('Required');
    expect(screen.getByText(/Your open activity stays visible/)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/READ');
  });

  it('explains an empty filtered week and offers a way to show everything without changing completion counts', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Required only' }));
    fireEvent.click(screen.getByRole('button', { name: /^Week 2,/ }));
    const week = screen.getByRole('button', { name: /^Week 2,/ }).closest('li')!;
    expect(within(week).getByText('No required activities in this week.')).toBeVisible();
    expect(week).toHaveTextContent('1 components');
    fireEvent.click(within(week).getByRole('button', { name: 'Show all activities' }));
    expect(within(week).getByRole('button', { name: /Welcome/ })).toBeVisible();
  });

  it('does not carry a filter across learners and does not add controls to a module with no allocated hours', async () => {
    const { rerender } = mount({ kind: 'commercial', id: '132' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Required only' }));
    rerender(<MemoryRouter><ActivitySidebar {...props} kind="apprenticeship" id="200" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'All activities' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<MemoryRouter><ActivitySidebar {...props} weekComponents={[components[0]]} weeks={[]} /></MemoryRouter>);
    expect(screen.queryByRole('group', { name: 'Activity filter' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Welcome/ })).toBeVisible();
  });

  it('returns to all activities when a refresh removes the last allocated time', () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Required only' }));
    const unallocated = components.map(component => ({ ...component, expectedOtjh: null }));
    rerender(<MemoryRouter><ActivitySidebar {...props} weekComponents={unallocated}
      weeks={props.weeks.map(week => ({ ...week, components: week.components.map(component => ({ ...component, expectedOtjh: null })) }))} /></MemoryRouter>);
    expect(screen.queryByRole('group', { name: 'Activity filter' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Welcome/ })).toBeVisible();
  });

  it.each(['commercial', 'apprenticeship'])('passes native and mapped imported hours through the catalogue without replacing the open material (%s)', kind => {
    const entries: SubjectEntry[] = components.slice(0, 2).map((native, position) => ({
      id: native.componentId!, title: native.title, category: native.type!, completed: false,
      position, schedule: { date: null }, native,
    }));
    entries.push({ id: 'legacy', title: 'Imported reading and quiz', category: 'Reading+Quiz', completed: false,
      position: 2, schedule: { date: null }, legacy: {
        activity_id: 'legacy', source_activity_id: 10, group_id: 1, group_name: 'Project controls', category: 'Reading+Quiz',
        activity: 'Imported reading and quiz', date: null, status: null, completed: false, actual: 0, planned: 0.5,
        planned_hours_mapped: true, hours_mapped: false, quiz_score: null, quiz_maximum_score: null, catalogue_kind: 'material',
      } });
    entries.push({ ...entries[2], id: 'companion', category: 'quiz', legacy: { ...entries[2].legacy!,
      activity_id: 'companion', source_activity_id: 11, catalogue_kind: 'quiz', source_material_activity_id: 'legacy',
      planned: 0, planned_hours_mapped: false } });
    entries.push({ ...entries[2], id: 'unmapped', title: 'Unmapped old activity', category: 'reading', legacy: {
      ...entries[2].legacy!, activity_id: 'unmapped', planned: 7, planned_hours_mapped: false } });
    const subject: Subject = { id: 'S1', title: 'Project controls', source: 'legacy', activities: entries };
    const weeks: LearningWeek[] = [{ id: 'W1', label: 'Week 1', title: 'Project controls', start: null, end: null, activities: entries }];
    render(<MemoryRouter><SubjectActivityWorkspace subject={subject} weeks={weeks} kind={kind} learnerId="132"
      requestedActivity="WELCOME" search="" progress={<p>0 of 5 completed</p>} renderWeekProgress={() => null}
      renderActivity={entry => <article aria-label={`${entry.id} material`}><input aria-label="Saved answer" defaultValue="" /></article>} />
      <Location /></MemoryRouter>);
    const sidebar = screen.getByRole('complementary', { name: 'Module activities' });
    expect(within(sidebar).getByRole('button', { name: /Read the case/ })).toHaveTextContent('Planned time: 1h 30m');
    expect(within(sidebar).getByRole('button', { name: /Imported reading and quiz/ })).toHaveTextContent('Planned time: 30m');
    expect(within(sidebar).getByRole('button', { name: /Unmapped old activity/ })).not.toHaveTextContent(/Required|7h/);
    const material = screen.getByRole('article', { name: 'WELCOME material' });
    fireEvent.change(within(material).getByRole('textbox', { name: 'Saved answer' }), { target: { value: 'Keep my draft' } });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Required only' }));
    expect(screen.getByRole('article', { name: 'WELCOME material' })).toBe(material);
    expect(within(material).getByRole('textbox')).toHaveValue('Keep my draft');
    expect(within(sidebar).queryByRole('button', { name: /Unmapped old activity/ })).not.toBeInTheDocument();
    expect(screen.getByText('0 of 5 completed')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
