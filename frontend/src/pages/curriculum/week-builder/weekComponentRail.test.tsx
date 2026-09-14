import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WeekComponentRail } from './page';

describe('WeekComponentRail add flow', () => {
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
