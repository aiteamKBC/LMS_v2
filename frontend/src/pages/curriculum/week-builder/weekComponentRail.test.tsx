import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WeekComponentRail } from './page';

describe('WeekComponentRail add flow', () => {
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
