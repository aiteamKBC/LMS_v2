import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './page';

describe('week component assigned groups', () => {
  it('keeps groups hidden until programme and cohort are selected, then filters by group', async () => {
    const user = userEvent.setup();
    const component = {
      id: 'COMP-1',
      type: 'video' as const,
      title: 'Video component',
      description: '',
      expectedOtjh: 1,
      points: 0,
      reflectionRequired: false,
      reflectionQuestion: '',
      workplaceEvidenceRequired: false,
      tutorValidationRequired: false,
      coachValidationRequired: false,
      ksbMappings: [],
      settings: {},
    } as ComponentProps<typeof ComponentEditor>['component'];
    const groupOptions = [
      { key: 'G1', name: 'Group One', programmeId: 'P1', programme: 'Programme One', cohortId: 'C1', cohort: 'Cohort One', moduleCount: 2 },
      { key: 'G2', name: 'Group Two', programmeId: 'P1', programme: 'Programme One', cohortId: 'C1', cohort: 'Cohort One', moduleCount: 0 },
      { key: 'G3', name: 'Group Three', programmeId: 'P1', programme: 'Programme One', cohortId: 'C2', cohort: 'Cohort Two', moduleCount: 1 },
    ];

    render(
      <ComponentEditor
        component={component}
        onChange={vi.fn()}
        onBack={vi.fn()}
        groupOptions={groupOptions}
        weekScope={{ programmeId: 'P1' } as ComponentProps<typeof ComponentEditor>['weekScope']}
      />,
    );

    expect(screen.queryByText('Group One')).not.toBeInTheDocument();
    expect(screen.queryByText('Group Two')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups programme' }), 'P1');
    expect(screen.queryByText('Group One')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assigned groups cohort' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Assigned groups group' })).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups cohort' }), 'C1');
    expect(screen.getByRole('button', { name: /Group One/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Group Two/ })).toBeInTheDocument();
    expect(screen.getByText('Contains modules — click to place a copy here')).toBeInTheDocument();
    expect(screen.getByText('No modules — click to place a copy here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Group Three/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups group' }), 'G2');
    expect(screen.queryByRole('button', { name: /Group One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Group Two/ })).toBeInTheDocument();
  });
});
