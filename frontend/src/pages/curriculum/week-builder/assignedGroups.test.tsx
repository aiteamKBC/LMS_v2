import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './page';

// The video's content editor is not under test here (as in quizPicker.test).
vi.mock('../module-builder/RichTextEditor', () => ({ RichTextDraft: () => <div>Content editor</div> }));

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

  it('lets the module\'s own group be unchecked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const component = {
      id: 'COMP-OWN-GROUP',
      weekId: 'W1',
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
      settings: { selectedGroupKeys: ['G1'], selectedGroupNames: ['Group One'] },
    } as ComponentProps<typeof ComponentEditor>['component'];
    const groupOptions = [{ key: 'G1', name: 'Group One', programmeId: 'P1', programme: 'Programme One', cohortId: 'C1', cohort: 'Cohort One', moduleCount: 1 }];

    render(
      <ComponentEditor
        component={component}
        onChange={onChange}
        onBack={vi.fn()}
        groupOptions={groupOptions}
        weekScope={{ programmeId: 'P1', groupName: 'Group One' } as ComponentProps<typeof ComponentEditor>['weekScope']}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups programme' }), 'P1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups cohort' }), 'C1');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).toBeEnabled();
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ selectedGroupKeys: [] }),
    }));
  });
});

describe('opening a component is read-only', () => {
  const groupOptions = [
    { key: 'G1', name: 'Group One', programmeId: 'P1', programme: 'Programme One', cohortId: 'C1', cohort: 'Cohort One', moduleCount: 1 },
  ];
  function component(type: 'live-session' | 'recording-placeholder' | 'video' | 'reading', settings = {}) {
    return {
      id: `COMP-${type}`, weekId: 'W1', type, title: 'Untouched component', description: '',
      expectedOtjh: 1, points: 0, reflectionRequired: false, reflectionQuestion: '',
      workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: true,
      ksbMappings: [], settings: { sessionDate: '2026-11-05', sessionTime: '09:00', ...settings },
    } as ComponentProps<typeof ComponentEditor>['component'];
  }
  function open(value: ComponentProps<typeof ComponentEditor>['component'], onChange = vi.fn()) {
    render(<ComponentEditor component={value} onChange={onChange} onBack={vi.fn()} groupOptions={groupOptions}
      weekScope={{ programmeId: 'P1', groupName: 'Group One' } as ComponentProps<typeof ComponentEditor>['weekScope']} />);
    return onChange;
  }
  async function showOwnGroup() {
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups programme' }), 'P1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned groups cohort' }), 'C1');
    return user;
  }

  it.each(['live-session', 'recording-placeholder', 'video', 'reading'] as const)(
    'opens and browses a %s without changing its saved data', async type => {
      const value = component(type);
      const before = JSON.stringify(value);
      const onChange = open(value);
      expect(onChange).not.toHaveBeenCalled();
      const user = await showOwnGroup();
      await user.click(screen.getByRole('textbox', { name: 'Title' }));
      await user.tab();
      expect(screen.getByRole('checkbox')).toBeChecked();
      expect(onChange).not.toHaveBeenCalled();
      expect(JSON.stringify(value)).toBe(before);
    },
  );

  it('reports a real title edit while retaining the existing schedule', async () => {
    const value = component('recording-placeholder');
    const onChange = open(value);
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    expect(onChange.mock.calls).toEqual([[{ title: 'Untouched component!' }]]);
    expect(value.settings.sessionDate).toBe('2026-11-05');
  });

  it('persists clearing an inherited group only when the author clicks it', async () => {
    const value = component('recording-placeholder');
    const onChange = open(value);
    const user = await showOwnGroup();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    expect(onChange.mock.calls).toEqual([[{ settings: {
      ...value.settings, selectedGroupKeys: [], selectedGroupNames: [],
    } }]]);
  });

  it('respects a deliberately cleared group when the component is reopened', async () => {
    const onChange = open(component('live-session', { selectedGroupKeys: [], selectedGroupNames: [] }));
    await showOwnGroup();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
});
