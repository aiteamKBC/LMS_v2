import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MyLearningCard, MyLearningModule } from '@/api/myLearning';
import type { Subject } from './learningSummary';
import { ModuleOverviewPage } from './ModuleOverviewPage';
import { buildModuleOverviewModel, curriculumWeeks, hasModuleOverview, moduleCompletion, moduleGrades, overviewSections } from './moduleOverviewModel';

vi.stubGlobal('AppIcon', () => <span />);

const card = (overrides: Partial<MyLearningCard> = {}): MyLearningCard => ({
  id: 'current:M1', title: 'Project Management', source: 'current', moduleId: 'M1', activityCount: 4, completedActivityCount: 0,
  progress: 0, status: 'Upcoming', finalTestPassed: false, cover: null,
  planModule: { start_date: '2026-01-05', end_date: '2026-03-30', tutor_name: 'Ray Mead', total_otjh: 12.5, educational_session_count: 6,
    programme_name: 'Project Management L4', cohort_name: 'Jan 2026', group_name: 'G1' },
  ...overrides,
} as MyLearningCard);

const subject = (overrides: Partial<Subject> = {}, cardOverrides: Partial<MyLearningCard> = {}): Subject => {
  const value = card(cardOverrides);
  return { id: value.id, title: value.title, source: 'current', moduleId: 'M1', activities: [], card: value, ...overrides } as Subject;
};

const attempt = (grade: number, passed: boolean, n = 1) => ({ quizId: 31, componentId: 'C3', grade, passed, attempt: n, startedAt: '', submittedAt: '' });

const module = (overrides: Partial<MyLearningModule> = {}): MyLearningModule => ({
  subjectId: 'current:M1',
  detail: { id: '7', components: [
    { componentId: 'C1', moduleId: 'M1', module: 'Project Management', week: 'Introduction', weekId: 'W0', component: 'Welcome', type: 'reading', expectedOtjh: null },
    { componentId: 'C2', moduleId: 'M1', module: 'Project Management', week: 'Week 1', weekId: 'W1', component: 'Kick-off session', type: 'live_session', expectedOtjh: null },
    { componentId: 'C3', moduleId: 'M1', module: 'Project Management', week: 'Week 1', weekId: 'W1', component: 'Scope quiz', type: 'reading', isQuiz: true,
      quizMeta: { quizId: 31, questions: 5, duration: null, timeUnit: null }, expectedOtjh: null },
    { componentId: 'X1', moduleId: 'OTHER', module: 'Other', week: 'Week 1', weekId: 'WX', component: 'Not this module', type: 'video', expectedOtjh: null },
  ], quizAttempts: [attempt(0.6, false, 1), attempt(0.85, true, 2)],
    componentProgress: [{ componentId: 'C1', kind: 'reading' }] } as unknown as MyLearningModule['detail'],
  activity: null, metadata: { covers: {} } as MyLearningModule['metadata'],
  schedule: { modules: [{ id: 'M1', title: 'Project Management', description: 'Internal delivery notes', start_date: '2026-01-05', end_date: '2026-03-30',
    tutor_name: 'Ray Mead', coach_name: 'Coach Carter', programme_name: 'Project Management L4', weeks_number: 12, cohort_name: 'Jan 2026',
    educational_session_count: 6, total_otjh: 12.5, session_week_day: 'Wednesday', session_start_time: '09:30', session_end_time: '12:30',
    learning_outcomes: ['Plan a project', 'Manage risk', 'Plan a project'] }], moduleLinks: {}, generatedAt: '' },
  sessions: [],
  overview: { summary: 'Lead small digital projects with confidence.', description: 'First paragraph.\n\nSecond paragraph.',
    descriptionSections: [
      { id: 'practise', heading: "What you'll practise", body: 'Run a kick-off.\n\nAgree the scope.', bullets: ['Write a brief', 'Present it'] },
      { id: 'access', heading: 'Enrolment and access', body: 'Open enrolment.', bullets: [] },
    ],
    highlights: ['Self-paced online study', 'Practical activities'],
    targetAudience: ['New project coordinators'], prerequisites: ['Module 1'], requirements: ['A laptop'],
    instructor: { name: 'Ray Mead', bio: 'Ray has led projects for 20 years.', photoUrl: 'https://images.example.org/ray.webp' } },
  ...overrides,
} as MyLearningModule);

function renderPage(props: Partial<Parameters<typeof ModuleOverviewPage>[0]> = {}) {
  const onStart = vi.fn();
  const onBack = vi.fn();
  render(<ModuleOverviewPage subject={subject()} card={card()} module={module()} onStart={onStart} onBack={onBack} {...props} />);
  return { onStart, onBack };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const sidebar = () => within(screen.getByRole('complementary', { name: 'Module summary' }));

describe('module overview model', () => {
  it('limits the overview step to native New LMS modules', () => {
    expect(hasModuleOverview({ id: 'current:M1', source: 'current' })).toBe(true);
    expect(hasModuleOverview({ id: 'legacy:50', source: 'legacy' })).toBe(false);
    expect(hasModuleOverview({ id: 'current:M1', source: 'current', importedCourseRef: 'legacy:50' })).toBe(false);
    expect(hasModuleOverview({ id: 'current:M1', source: 'current', replacementCourseRef: 'legacy:50' })).toBe(false);
    expect(hasModuleOverview({ id: 'unlinked:Some title', source: 'current' })).toBe(false);
  });

  it('keeps week order, groups by week and only lists this module', () => {
    const model = buildModuleOverviewModel({ moduleId: 'M1', title: 'Fallback', card: card(), module: module() });
    expect(model.weeks.map(week => [week.label, week.items.map(item => item.title)])).toEqual([
      ['Introduction', ['Welcome']], ['Week 1', ['Kick-off session', 'Scope quiz']],
    ]);
    expect(model.counts.map(item => `${item.count} ${item.label}`)).toEqual(['1 Live session', '1 Quiz', '1 Reading']);
    expect(model.outcomes).toEqual(['Plan a project', 'Manage risk']);
    expect(curriculumWeeks([{ component: '  ', week: 'Week 1' } as never])).toEqual([]);
  });

  it('splits authored sections into paragraphs and drops headingless ones', () => {
    expect(overviewSections([
      { id: 'a', heading: ' One ', body: 'P1\n\n\nP2', bullets: [' x ', ''] },
      { id: 'b', heading: '  ', body: 'orphan', bullets: [] },
    ])).toEqual([{ id: 'a', heading: 'One', paragraphs: ['P1', 'P2'], bullets: ['x'] }]);
    expect(overviewSections(undefined)).toEqual([]);
  });

  it('takes each activity completion from the existing learning summary, never guessing', () => {
    expect([...moduleCompletion(module(), 'current:M1')!]).toEqual([['C1', true], ['C2', false], ['C3', true]]);
    expect(moduleCompletion(null, 'current:M1')).toBeNull();
    const model = buildModuleOverviewModel({ moduleId: 'M1', title: 'X', card: card(), module: module() });
    expect(model.weeks.flatMap(week => week.items.map(item => [item.title, item.completed, item.questions]))).toEqual([
      ['Welcome', true, null], ['Kick-off session', false, null], ['Scope quiz', true, 5],
    ]);
    // A component the summary cannot identify (no component id) stays unknown.
    expect(curriculumWeeks([{ component: 'Untracked', week: 'Week 1' } as never], new Map([['C1', true]]))[0].items[0].completed).toBeNull();
  });

  it('reads quiz results from the module read without deriving an overall grade', () => {
    expect(moduleGrades(module(), 'M1')).toEqual([
      { id: 'C3', title: 'Scope quiz', week: 'Week 1', attempts: 2, bestPercent: 85, passed: true },
    ]);
    expect(moduleGrades(null, 'M1')).toEqual([]);
  });

  it('reads a version 1 overview (no sections or highlights) unchanged', () => {
    const { descriptionSections: _s, highlights: _h, ...v1 } = module().overview!;
    const model = buildModuleOverviewModel({ moduleId: 'M1', title: 'X', card: card(), module: module({ overview: v1 }) });
    expect(model.sections).toEqual([]);
    expect(model.highlights).toEqual([]);
    expect(model.summary).toBe('Lead small digital projects with confidence.');
  });
});

describe('module overview page', () => {
  it('renders the hero, instructor, start card and sidebar from the module read', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'Project Management' })).toHaveFocus();
    expect(screen.getByText('Programme: Project Management L4')).toBeVisible();
    expect(screen.getByText('Lead small digital projects with confidence.')).toBeVisible();
    const tutorRegion = screen.getByRole('region', { name: 'Your instructor' });
    expect(tutorRegion.closest('header')).not.toBeNull();
    const tutor = within(tutorRegion);
    expect(tutor.getByText('Instructor')).toBeVisible();
    expect(tutor.getByRole('img', { name: 'Ray Mead' })).toHaveAttribute('src', 'https://images.example.org/ray.webp');
    expect(tutor.getByText('Ray has led projects for 20 years.')).toBeVisible();
    expect(screen.getAllByText('Ray Mead')).toHaveLength(1);

    const details = within(sidebar().getByRole('region', { name: 'Course details' }));
    expect(details.getByText('Sections').nextSibling).toHaveTextContent('2');
    expect(details.getByText('Quiz').nextSibling).toHaveTextContent('1');
    expect(sidebar().getByRole('region', { name: 'Learner requirements' })).toHaveTextContent('1. Before you startModule 1');
    expect(sidebar().getByRole('region', { name: 'Learner requirements' })).toHaveTextContent('2. What you will needA laptop');
    expect(sidebar().getByRole('region', { name: 'Who this module is for' })).toHaveTextContent('New project coordinators');
  });

  it('does not show operational module metadata', () => {
    renderPage();
    const text = document.body.textContent || '';
    for (const value of ['Coach Carter', 'Wednesday', '09:30', '5 Jan 2026', '12 weeks', 'Cohort Jan 2026', 'Planned study hours', 'Module information', 'Internal delivery notes']) {
      expect(text).not.toContain(value);
    }
    expect(screen.queryByText('Not this module')).not.toBeInTheDocument();
  });

  it('shows authored description sections, outcomes and highlights on the Description tab', () => {
    renderPage();
    expect(tab('Description')).toHaveAttribute('aria-selected', 'true');
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByRole('heading', { level: 3, name: 'About this module' })).toBeVisible();
    expect(panel.getByText('Second paragraph.')).toBeVisible();
    const practise = within(panel.getByRole('region', { name: "What you'll practise" }));
    expect(practise.getByText('Agree the scope.')).toBeVisible();
    expect(practise.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Write a brief', 'Present it']);
    expect(panel.getByRole('region', { name: 'Enrolment and access' })).toHaveTextContent('Open enrolment.');
    expect(within(panel.getByRole('region', { name: "What you'll learn" })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(panel.getByRole('region', { name: 'Course highlights' })).getAllByRole('listitem')).toHaveLength(2);
    const headings = panel.getAllByRole('heading', { level: 3 }).map(item => item.textContent);
    expect(headings).toEqual(['About this module', "What you'll practise", 'Enrolment and access', "What you'll learn", 'Course highlights']);
  });

  it('has no promotional curriculum box and only Description, Curriculum and Grade tabs', () => {
    renderPage();
    expect(screen.queryByText(/Full curriculum available/)).not.toBeInTheDocument();
    expect(screen.queryByText(/View the complete learning sequence/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(item => item.textContent)).toEqual(['Description', 'Curriculum', 'Grade']);
    expect(screen.queryByRole('tab', { name: 'Reviews' })).not.toBeInTheDocument();
  });

  it('starts every curriculum week collapsed, toggles them, and resets when the tab is reopened', () => {
    renderPage();
    fireEvent.click(tab('Curriculum'));
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByText('2 sections · 3 activities')).toBeVisible();
    const intro = panel.getByRole('button', { name: /Introduction/ });
    const week1 = panel.getByRole('button', { name: /Week 1/ });
    expect(intro).toHaveAttribute('aria-expanded', 'false');
    expect(week1).toHaveAttribute('aria-expanded', 'false');
    expect(panel.queryByText('Scope quiz')).not.toBeInTheDocument();
    fireEvent.click(week1);
    expect(week1).toHaveAttribute('aria-expanded', 'true');
    expect(panel.getByText('Scope quiz')).toBeVisible();
    expect(intro).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(week1);
    expect(panel.queryByText('Scope quiz')).not.toBeInTheDocument();
    fireEvent.click(week1);
    fireEvent.click(tab('Description'));
    fireEvent.click(tab('Curriculum'));
    expect(screen.getByRole('button', { name: /Week 1/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Scope quiz')).not.toBeInTheDocument();
  });

  it('shows a green check for completed activities and a lock for incomplete ones, read-only', () => {
    const { onStart } = renderPage();
    fireEvent.click(tab('Curriculum'));
    fireEvent.click(screen.getByRole('button', { name: /Introduction/ }));
    fireEvent.click(screen.getByRole('button', { name: /Week 1/ }));
    const row = (title: string) => screen.getByText(title).closest('li')!;
    expect(within(row('Welcome')).getByText('Completed')).toBeInTheDocument();
    expect(within(row('Welcome')).queryByText('Not completed yet')).not.toBeInTheDocument();
    expect(within(row('Kick-off session')).getByText('Not completed yet')).toBeInTheDocument();
    expect(within(row('Kick-off session')).queryByText('Completed')).not.toBeInTheDocument();
    expect(within(row('Scope quiz')).getByText('Completed')).toBeInTheDocument();
    expect(within(row('Scope quiz')).getByText('5 questions')).toBeVisible();
    expect(within(row('Kick-off session')).getByText('Live session')).toBeVisible();
    // Rows are informational: no links, buttons or handlers; clicking changes nothing.
    for (const title of ['Welcome', 'Kick-off session', 'Scope quiz']) {
      expect(within(row(title)).queryByRole('link')).not.toBeInTheDocument();
      expect(within(row(title)).queryByRole('button')).not.toBeInTheDocument();
      fireEvent.click(row(title));
    }
    expect(onStart).not.toHaveBeenCalled();
    expect(row('Welcome')).toBeInTheDocument();
  });

  it('shows neither a lock nor a check when completion is not known', () => {
    const base = module();
    const components = [{ moduleId: 'M1', week: 'Week 1', weekId: 'W1', component: 'No id activity', type: 'video', expectedOtjh: null }];
    renderPage({ module: module({ detail: { ...base.detail, components } as unknown as MyLearningModule['detail'] }) });
    fireEvent.click(tab('Curriculum'));
    fireEvent.click(screen.getByRole('button', { name: /Week 1/ }));
    const row = within(screen.getByText('No id activity').closest('li')!);
    expect(row.queryByText('Completed')).not.toBeInTheDocument();
    expect(row.queryByText('Not completed yet')).not.toBeInTheDocument();
  });

  it('shows Grade only from existing quiz results', () => {
    renderPage();
    expect(tab('Grade')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(tab('Grade'));
    const row = within(within(screen.getByRole('tabpanel')).getByRole('row', { name: /Scope quiz/ }));
    expect(row.getByText('85%')).toBeVisible();
    expect(row.getByText('2')).toBeVisible();
    expect(row.getByText('Passed')).toBeVisible();
  });

  it('hides Grade when the module has no quizzes, and supports arrow-key tabs', () => {
    const base = module();
    renderPage({ module: module({ detail: { ...base.detail, components: base.detail.components.filter(item => !item.isQuiz) } }) });
    expect(screen.queryByRole('tab', { name: 'Grade' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(item => item.textContent)).toEqual(['Description', 'Curriculum']);
    fireEvent.keyDown(tab('Description'), { key: 'ArrowRight' });
    expect(tab('Curriculum')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Curriculum')).toHaveFocus();
    fireEvent.keyDown(tab('Curriculum'), { key: 'ArrowRight' });
    expect(tab('Description')).toHaveAttribute('aria-selected', 'true');
  });

  it('hides every empty section and never shows invented content', () => {
    const bare = module({ overview: { summary: '', description: '', targetAudience: [], prerequisites: [], requirements: [], instructor: null },
      schedule: { modules: [], moduleLinks: {}, generatedAt: '' }, detail: { id: '7', components: [] } as unknown as MyLearningModule['detail'] });
    renderPage({ module: bare, card: card({ planModule: null, activityCount: 0 }), subject: subject({}, { planModule: null, activityCount: 0 }) });
    for (const name of ['About this module', "What you'll learn", 'Course highlights', 'Course details', 'Learner requirements', 'Who this module is for', 'Your instructor']) {
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText('A description has not been added for this module yet.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Full curriculum/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Not set|Not scheduled|To be assigned|★|rating/i);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1); // the existing default module cover only
    screen.getAllByRole('button', { name: /Start learning/ }).forEach(button => expect(button).toBeEnabled());
  });

  it('hides an instructor photo that fails to load, keeping the name and biography', () => {
    renderPage();
    const tutor = within(screen.getByRole('region', { name: 'Your instructor' }));
    fireEvent.error(tutor.getByRole('img', { name: 'Ray Mead' }));
    expect(tutor.queryByRole('img')).not.toBeInTheDocument();
    expect(tutor.getByText('Ray Mead')).toBeVisible();
    expect(tutor.getByText('Ray has led projects for 20 years.')).toBeVisible();
  });

  it('shows the instructor without a photo or biography when neither exists', () => {
    renderPage({ module: module({ overview: { ...module().overview!, instructor: { name: 'Ray Mead', bio: '', photoUrl: '' } } }) });
    const region = screen.getByRole('region', { name: 'Your instructor' });
    expect(region).toHaveTextContent('Ray Mead');
    expect(region).not.toHaveAttribute('data-photo');
    expect(within(region).queryByRole('img')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a long biography collapsed with an accessible toggle', () => {
    const bio = 'Ray has led digital projects across the public and private sectors. '.repeat(6).trim();
    renderPage({ module: module({ overview: { ...module().overview!, instructor: { name: 'Ray Mead', bio, photoUrl: '' } } }) });
    const toggle = screen.getByRole('button', { name: 'Read full biography' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the tutor from the card while module details are still loading', () => {
    renderPage({ module: null });
    const region = screen.getByRole('region', { name: 'Your instructor' });
    expect(region).toHaveTextContent('Ray Mead');
    expect(within(region).queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a skeleton while loading, never empty-content messages', () => {
    renderPage({ module: null, loading: true });
    expect(screen.getByTestId('module-overview-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading module details');
    expect(document.body.textContent).not.toMatch(/has not been added|No learning activities/);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Course details' })).not.toBeInTheDocument();
    screen.getAllByRole('button', { name: /Start learning/ }).forEach(button => expect(button).toBeEnabled());
  });

  it('treats a read for a different module as still loading', () => {
    renderPage({ module: module({ subjectId: 'current:OTHER' }) });
    expect(screen.getByTestId('module-overview-skeleton')).toBeInTheDocument();
    expect(screen.queryByText("What you'll practise")).not.toBeInTheDocument();
  });

  it('shows the loaded content after loading, and switching tabs never shows the skeleton', () => {
    const view = render(<ModuleOverviewPage subject={subject()} card={card()} module={null} loading onStart={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByTestId('module-overview-skeleton')).toBeInTheDocument();
    view.rerender(<ModuleOverviewPage subject={subject()} card={card()} module={module()} onStart={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByTestId('module-overview-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Lead small digital projects with confidence.')).toBeVisible();
    for (const name of ['Curriculum', 'Grade', 'Description', 'Curriculum']) {
      fireEvent.click(tab(name));
      expect(screen.queryByTestId('module-overview-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/has not been added|No learning activities/);
    }
  });

  it('shows an error with Retry instead of an empty curriculum when the read fails', () => {
    const onRetry = vi.fn();
    renderPage({ module: null, error: 'Could not load this subject. Please try again.', onRetry });
    expect(screen.getByRole('alert')).toHaveTextContent('Some module details could not be loaded');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/has not been added|No learning activities/);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /retry|try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('hides the instructor entirely when the module has no tutor', () => {
    const noTutor = { ...card().planModule!, tutor_name: 'TBC' };
    const base = module();
    const schedule = { ...base.schedule, modules: base.schedule.modules.map(row => ({ ...row, tutor_name: 'TBC' })) };
    renderPage({ module: module({ schedule, overview: { ...base.overview!, instructor: null } }),
      card: card({ planModule: noTutor }), subject: subject({}, { planModule: noTutor }) });
    expect(screen.queryByRole('region', { name: 'Your instructor' })).not.toBeInTheDocument();
  });

  it('renders authored text as text, never as markup', () => {
    renderPage({ module: module({ overview: { ...module().overview!, description: '<img src=x onerror="alert(1)">',
      descriptionSections: [{ id: 's', heading: '<b>Bold</b>', body: '<script>x</script>', bullets: ['<i>y</i>'] }] } }) });
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    expect(screen.getByRole('heading', { name: '<b>Bold</b>' })).toBeVisible();
    expect(screen.getByText('<i>y</i>')).toBeVisible();
    expect(document.querySelector('img[src="x"], script, b, i')).toBeNull();
  });

  it('offers Start, then Continue, and calls the existing learning action', () => {
    const { onStart, onBack } = renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /Start learning/ })[0]);
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'My modules' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('labels Continue learning once progress exists', () => {
    renderPage({ subject: subject({}, { completedActivityCount: 2, progress: 50 }), card: card({ completedActivityCount: 2, progress: 50 }) });
    expect(screen.getAllByRole('button', { name: /Continue learning/ }).length).toBeGreaterThan(0);
    const bar = screen.getByRole('progressbar', { name: 'Project Management progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 4 activities completed');
    expect(screen.getByText('50% complete')).toBeVisible();
  });

  it('keeps the CTA working while details load or fail', () => {
    const { onStart } = renderPage({ module: null, error: 'Could not load this subject. Please try again.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Some module details could not be loaded');
    fireEvent.click(screen.getAllByRole('button', { name: /Start learning/ })[0]);
    expect(onStart).toHaveBeenCalled();
  });
});


describe('custom sidebar sections on the learner page', () => {
  const cards = () => within(screen.getByRole('complementary', { name: 'Module summary' }))
    .getAllByRole('heading', { level: 3 }).map(item => item.textContent);

  it('renders authored sidebar cards below the system-managed ones and hides empty ones', () => {
    renderPage({ module: module({ overview: { ...module().overview!, sidebarSections: [
      { id: 'tools', heading: 'Tools & software', body: 'Used throughout.\n\nInstalled for you.', bullets: ['Microsoft Excel'] },
      { id: 'blank', heading: '  ', body: 'No heading, never shown', bullets: [] },
      { id: 'help', heading: 'Getting help', body: '', bullets: [] },
    ] } }) });
    expect(cards()).toEqual(['Course details', 'Learner requirements', 'Who this module is for', 'Tools & software', 'Getting help']);
    const tools = screen.getByRole('region', { name: 'Tools & software' });
    expect(within(tools).getByText('Installed for you.')).toBeVisible();
    expect(within(tools).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Microsoft Excel']);
    expect(screen.queryByText('No heading, never shown')).not.toBeInTheDocument();
  });

  it('shows the existing sidebar unchanged for records without custom sections', () => {
    renderPage();
    expect(cards()).toEqual(['Course details', 'Learner requirements', 'Who this module is for']);
  });
});
