import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WeekComponentRail } from './page';
import { createEmptyComponent } from './weekTemplateData';

describe('WeekComponentRail add flow', () => {
  it('moves the original component through its caller without copying, deleting or changing the source locally', async () => {
    const user = userEvent.setup(), onMoveComponentToWeek = vi.fn(), onCopyComponentToWeek = vi.fn(), onChange = vi.fn(), onSelectId = vi.fn();
    const component = { ...createEmptyComponent('WEEK-1', 'reading', 1), title: 'Stored chapter' };
    render(<WeekComponentRail weekId="WEEK-1" components={[component]} selectedId={null} onSelectId={onSelectId} onChange={onChange} onMoveComponentToWeek={onMoveComponentToWeek} onCopyComponentToWeek={onCopyComponentToWeek} otherWeeks={[{ id: 'WEEK-2', label: 'Week 2' }]} pointsByType={{}} variant="nested" />);
    await user.click(screen.getByRole('button', { name: 'Duplicate Stored chapter' }));
    expect(screen.getByText('Move to another week')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Move to Week 2' }));
    expect(onMoveComponentToWeek).toHaveBeenCalledWith(component, 'WEEK-2');
    expect(onCopyComponentToWeek).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled(); expect(onSelectId).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(component.weekId).toBe('WEEK-1');
  });

  it('marks a moved live session as awaiting its calendar update without claiming that Teams moved', () => {
    const component = { ...createEmptyComponent('WEEK-2', 'live-session', 1), settings: { sessionDate: '2026-10-27', sessionDateTimeUtc: '2026-10-27T09:00:00Z', teamsStartDateTimeUtc: '2026-10-20T08:00:00Z', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1 } };
    const props = { weekId: 'WEEK-2', components: [component], selectedId: null, onSelectId: vi.fn(), onChange: vi.fn(), onReviewTeamsCalendar: vi.fn(), pointsByType: {}, variant: 'nested' as const };
    const { rerender } = render(<WeekComponentRail {...props} />);
    expect(screen.getByText('Teams calendar update needed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Teams calendar' })).toBeInTheDocument();
    rerender(<WeekComponentRail {...props} components={[{ ...component, settings: { ...component.settings, teamsStartDateTimeUtc: component.settings.sessionDateTimeUtc } }]} />);
    expect(screen.queryByText('Teams calendar update needed')).not.toBeInTheDocument();
  });

  it('selects, deselects and edits a compact component without changing its content or saved status', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onSelectId = vi.fn();
    const component = { ...createEmptyComponent('WEEK-1', 'video', 1), title: 'Stored learner video', settings: { contentStatus: 'Approved', videoUrl: 'https://example.test/video' } };
    const props = { weekId: 'WEEK-1', components: [component], onSelectId, onChange, pointsByType: {}, variant: 'nested' as const };
    const { rerender } = render(<WeekComponentRail {...props} selectedId={null} />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: `Select ${component.title}` }));
    expect(onSelectId).toHaveBeenLastCalledWith(component.id);
    rerender(<WeekComponentRail {...props} selectedId={component.id} />);
    await user.click(screen.getByRole('checkbox', { name: `Select ${component.title}` }));
    expect(onSelectId).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole('button', { name: `Edit ${component.title}` }));
    expect(onSelectId).toHaveBeenLastCalledWith(component.id);
    expect(onChange).not.toHaveBeenCalled();
    expect(component.settings).toEqual({ contentStatus: 'Approved', videoUrl: 'https://example.test/video' });
  });

  it('copies a compact component to the chosen week without modifying its source', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onCopyComponentToWeek = vi.fn();
    const component = { ...createEmptyComponent('WEEK-1', 'reading', 1), title: 'Stored reading' };
    render(<WeekComponentRail weekId="WEEK-1" components={[component]} selectedId={null} onSelectId={vi.fn()} onChange={onChange} onCopyComponentToWeek={onCopyComponentToWeek} otherWeeks={[{ id: 'WEEK-2', label: 'Week 2' }]} pointsByType={{}} variant="nested" />);
    await user.click(screen.getByRole('button', { name: `Duplicate ${component.title}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Week 2' }));
    expect(onCopyComponentToWeek).toHaveBeenCalledWith(component, 'WEEK-2');
    expect(onChange).not.toHaveBeenCalled();
    expect(component.weekId).toBe('WEEK-1');
  });

  it('inserts from the compact gap at the selected position and retains neighboring components', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onSelectId = vi.fn();
    const first = { ...createEmptyComponent('WEEK-1', 'reading', 1), title: 'First reading' };
    const last = { ...createEmptyComponent('WEEK-1', 'assignment', 2), title: 'Last assignment' };
    render(<WeekComponentRail weekId="WEEK-1" components={[first, last]} selectedId={null} onSelectId={onSelectId} onChange={onChange} pointsByType={{ video: 15 }} variant="nested" />);
    await user.click(screen.getAllByRole('button', { name: 'Add a component here' })[1]);
    await user.click(screen.getByRole('button', { name: /^Video/ }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 1 component' }));
    const sent = onChange.mock.calls[0][0];
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual(first);
    expect(sent[1]).toMatchObject({ weekId: 'WEEK-1', type: 'video', points: 15 });
    expect(sent[2]).toEqual(last);
    expect(onSelectId).toHaveBeenCalledWith(sent[1].id);
  });

  it('keeps adding and reusing available in an empty nested week without changing saved components', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onReuseComponents = vi.fn();
    render(<WeekComponentRail weekId="WEEK-EMPTY" components={[]} selectedId={null} onSelectId={vi.fn()} onChange={onChange} onReuseComponents={onReuseComponents} pointsByType={{}} variant="nested" />);
    expect(screen.getByRole('searchbox', { name: 'Search components in this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add the first component' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByRole('dialog', { name: 'Add a component' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Video/ }));
    await user.click(screen.getByRole('button', { name: 'Reuse existing' }));
    expect(onReuseComponents).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Add a component' })).not.toBeInTheDocument();
  });

  it('filters components in this week without changing their order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const components = [
      {
        id: 'COMP-INTRO', weekId: 'WEEK-1', type: 'reading' as const, title: 'Introduction to commercial intelligence', description: '', expectedOtjh: 1, points: 5,
        reflectionRequired: false, reflectionQuestion: '', workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: false, ksbMappings: [], settings: {},
      },
      {
        id: 'COMP-ASSESS', weekId: 'WEEK-1', type: 'quiz' as const, title: 'Knowledge check', description: '', expectedOtjh: 0.5, points: 10,
        reflectionRequired: false, reflectionQuestion: '', workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: false, ksbMappings: [], settings: {},
      },
    ];

    render(
      <WeekComponentRail weekId="WEEK-1" components={components} selectedId={null} onSelectId={vi.fn()} onChange={onChange} pointsByType={{}} variant="nested" />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search components in this week' }), 'knowledge');

    expect(screen.getByText('Knowledge check')).toBeInTheDocument();
    expect(screen.queryByText('Introduction to commercial intelligence')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(screen.getByRole('searchbox', { name: 'Search components in this week' }));
    expect(screen.getByText('Introduction to commercial intelligence')).toBeInTheDocument();
    expect(screen.getByText('Knowledge check')).toBeInTheDocument();
  });

  it('keeps copy and delete available when a component title uses the whole rail', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const component = {
      id: 'COMP-LONG',
      weekId: 'WEEK-1',
      type: 'video' as const,
      title: 'P1: An intentionally long component title that must be truncated without hiding its controls',
      description: '',
      expectedOtjh: 1,
      points: 15,
      reflectionRequired: false,
      reflectionQuestion: '',
      workplaceEvidenceRequired: false,
      tutorValidationRequired: false,
      coachValidationRequired: false,
      ksbMappings: [],
      settings: {},
    };

    const { container } = render(
      <WeekComponentRail
        weekId="WEEK-1"
        components={[component]}
        selectedId={null}
        onSelectId={vi.fn()}
        onChange={onChange}
        pointsByType={{}}
        variant="nested"
      />,
    );

    const copy = screen.getByRole('button', { name: `Duplicate ${component.title}` });
    const remove = screen.getByRole('button', { name: `Delete ${component.title}` });
    expect(copy.parentElement).not.toHaveClass('sm:opacity-0');
    expect(container.querySelector('.min-w-0.flex-1')).toBeInTheDocument();

    await user.click(copy);
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'COMP-LONG', title: component.title }),
      expect.objectContaining({ title: component.title }),
    ]));

    onChange.mockClear();
    await user.click(remove);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows component hours from Expected OTJH as hours and minutes', () => {
    render(
      <WeekComponentRail
        weekId="WEEK-1"
        components={[{
          id: 'COMP-1',
          weekId: 'WEEK-1',
          type: 'video',
          title: 'P2-Student Support',
          description: '',
          expectedOtjh: 0.55,
          points: 0,
          reflectionRequired: false,
          reflectionQuestion: '',
          workplaceEvidenceRequired: false,
          tutorValidationRequired: false,
          coachValidationRequired: true,
          ksbMappings: [],
          settings: {},
        }]}
        selectedId={null}
        onSelectId={vi.fn()}
        onChange={vi.fn()}
        pointsByType={{}}
      />,
    );

    expect(screen.getByText('33m')).toBeInTheDocument();
    expect(screen.queryByText('0.55h')).not.toBeInTheDocument();
  });

  it('opens a roomy picker, creates the chosen component and selects it for editing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectId = vi.fn();

    render(
      <WeekComponentRail
        weekId="WEEK-1"
        components={[]}
        selectedId={null}
        onSelectId={onSelectId}
        onChange={onChange}
        pointsByType={{ powerpoint: 15 }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /add the first component/i }));

    expect(screen.getByRole('dialog', { name: 'Add a component' })).toBeInTheDocument();
    expect(screen.getByText('This will be the first component in the week.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /PowerPoint/i }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 1 component' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [created] = onChange.mock.calls[0][0];
    expect(created).toMatchObject({
      weekId: 'WEEK-1',
      type: 'powerpoint',
      title: 'PowerPoint 1',
      points: 15,
    });
    expect(onSelectId).toHaveBeenCalledWith(created.id);
    expect(screen.queryByRole('dialog', { name: 'Add a component' })).not.toBeInTheDocument();
  });

  it.each(['standalone', 'nested'] as const)('adds a mixed selection once at the requested gap in the %s rail', async variant => {
    const user = userEvent.setup(), onChange = vi.fn(), onSelectId = vi.fn();
    const first = { ...createEmptyComponent('WEEK-1', 'reading', 1), title: 'Stored chapter', ksbMappings: [{ id: 'MAP-1', ksbId: 'KSB-1', code: 'K1', type: 'main' as const, description: 'Stored knowledge', weight: 1, weightClass: 'hard' as const }] };
    const last = { ...createEmptyComponent('WEEK-1', 'assignment', 2), title: 'Stored assessment' };
    render(<WeekComponentRail weekId="WEEK-1" components={[first, last]} selectedId={null} onSelectId={onSelectId} onChange={onChange} pointsByType={{ 'live-session': 11, video: 17, reading: 0 }} variant={variant} />);
    await user.click(screen.getAllByRole('button', { name: 'Add a component here' })[1]);
    await user.click(screen.getByRole('button', { name: /^Reading Material/ }));
    await user.click(screen.getByRole('button', { name: /^Video/ }));
    await user.click(screen.getByRole('button', { name: /^Live Teams Session/ }));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled(); expect(onSelectId).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 3 components' }));
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(5);
    expect(next[0]).toEqual(first); expect(next[4]).toEqual(last);
    expect(next.slice(1, 4)).toMatchObject([
      { weekId: 'WEEK-1', type: 'live-session', points: 11, expectedOtjh: 2 },
      { weekId: 'WEEK-1', type: 'video', points: 17, expectedOtjh: 0 },
      { weekId: 'WEEK-1', type: 'reading', points: 0, expectedOtjh: 2 },
    ]);
    expect(next.slice(1, 4).map((component: { title: string }) => component.title)).toEqual(['Live Teams Session 3', 'Video 4', 'Reading Material 5']);
    expect(new Set(next.map((component: { id: string }) => component.id)).size).toBe(5);
    expect(onSelectId).toHaveBeenCalledWith(next[1].id);
    expect(screen.queryByRole('dialog', { name: 'Add a component' })).not.toBeInTheDocument();
  });

  it('retains selections across search, supports keyboard deselection, and discards selections on cancel', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onSelectId = vi.fn();
    render(<WeekComponentRail weekId="WEEK-1" components={[]} selectedId={null} onSelectId={onSelectId} onChange={onChange} pointsByType={{}} variant="nested" />);
    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByRole('button', { name: 'Add components' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Video/ }));
    const search = screen.getByPlaceholderText('Search component types...');
    await user.type(search, 'reading');
    await user.click(screen.getByRole('button', { name: /^Reading Material/ }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.clear(search);
    const video = screen.getByRole('button', { name: /^Video/ });
    expect(video).toHaveAttribute('aria-pressed', 'true');
    video.focus(); await user.keyboard(' ');
    expect(video).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled(); expect(onSelectId).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add components' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add a component' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled(); expect(onSelectId).not.toHaveBeenCalled();
  });
});

/**
 * A ticked holiday landing on a live session is a WARNING and nothing else.
 * The row says so and is otherwise completely ordinary: same date, same week,
 * same component, still scheduled and still pushed to Teams. The Course
 * structure rail in the Module Builder passes the week's closed delivery days
 * in, so the warning on the week and the warning on its live session always
 * name the same day.
 */
describe('WeekComponentRail holiday warning', () => {
  function liveSession(sessionDate: string) {
    return {
      id: 'COMP-LIVE',
      weekId: 'WEEK-1',
      type: 'live-session' as const,
      title: 'L5:Adtech',
      description: '',
      expectedOtjh: 2,
      points: 0,
      reflectionRequired: false,
      reflectionQuestion: '',
      workplaceEvidenceRequired: false,
      tutorValidationRequired: false,
      coachValidationRequired: false,
      ksbMappings: [],
      settings: { sessionDate },
    };
  }

  function renderRail(holidayDates?: string[]) {
    return render(
      <WeekComponentRail
        weekId="WEEK-1"
        components={[liveSession('2027-05-03')]}
        selectedId={null}
        onSelectId={vi.fn()}
        onChange={vi.fn()}
        pointsByType={{}}
        holidayDates={holidayDates}
      />,
    );
  }

  it.each([
    ['2027-05-03', ['2027-05-03'], 'Holiday'],
    ['', [], 'No date'],
  ])('keeps the %s session warning visible in a compact row', (sessionDate, holidayDates, label) => {
    const onChange = vi.fn();
    render(<WeekComponentRail weekId="WEEK-1" components={[liveSession(sessionDate as string)]} selectedId={null} onSelectId={vi.fn()} onChange={onChange} pointsByType={{}} holidayDates={holidayDates as string[]} variant="nested" />);
    expect(screen.getByText(label as string)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks a live session whose day a holiday falls on', () => {
    renderRail(['2027-05-03']);

    expect(screen.getByText('Holiday')).toBeInTheDocument();
    // The session is untouched next to its warning: same date on the row.
    expect(screen.getByText(/3 May 2027/)).toBeInTheDocument();
  });

  it('stays quiet on a live session with no holiday on its day', () => {
    renderRail(['2027-05-10']);

    expect(screen.queryByText('Holiday')).not.toBeInTheDocument();
    expect(screen.getByText(/3 May 2027/)).toBeInTheDocument();
  });

  it('stays quiet for a caller that has no session plan to pass', () => {
    renderRail();

    expect(screen.queryByText('Holiday')).not.toBeInTheDocument();
  });

  it('never marks a component that is not a live session', () => {
    render(
      <WeekComponentRail
        weekId="WEEK-1"
        components={[{ ...liveSession('2027-05-03'), id: 'COMP-READ', type: 'reading' as const }]}
        selectedId={null}
        onSelectId={vi.fn()}
        onChange={vi.fn()}
        pointsByType={{}}
        holidayDates={['2027-05-03']}
      />,
    );

    expect(screen.queryByText('Holiday')).not.toBeInTheDocument();
  });
});
