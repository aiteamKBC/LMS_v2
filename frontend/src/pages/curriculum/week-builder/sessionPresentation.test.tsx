import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WeekComponentRail, ComponentEditor } from './page';
import { createEmptyComponent } from '../module-builder/moduleAuthoringData';

vi.mock('../shared/entities/liveSessionArtifacts', () => ({
  LiveSessionArtifactsPanel: () => <p>Saved session artifacts</p>,
  ModuleLiveSessionResults: () => <p>Saved module artifacts</p>,
}));

function components() {
  const live = { ...createEmptyComponent('W', 'live-session', 1), id: 'L', moduleId: 'M', title: 'Organisational Context',
    expectedOtjh: 2.5, points: 30, settings: { teamsLiveSessionId: 'SERIES', teamsSessionNumber: 1, sessionDate: '2026-11-12' } };
  const recording = { ...createEmptyComponent('W', 'recording-placeholder', 2), id: 'R', moduleId: 'M', title: 'Session Recording',
    reflectionRequired: true, reflectionQuestion: 'What did you learn from the recording?', tutorValidationRequired: true,
    settings: { linkedLiveSessionComponentId: 'L', linkedLiveSessionModuleId: '', recordingPurpose: 'Review this session' } };
  return [live, recording];
}

describe('unified author session card', () => {
  it('shows one card and selects the canonical recording without rewriting any fields', () => {
    const items = components();
    const before = structuredClone(items);
    const select = vi.fn(), change = vi.fn();
    const { container } = render(<WeekComponentRail weekId="W" components={items} selectedId="R" onSelectId={select} onChange={change} pointsByType={{}} variant="nested" />);
    expect(screen.getAllByText('Organisational Context')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="grouped-session-recording"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Recording settings/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Recording settings/ }));
    expect(select).toHaveBeenCalledWith('R');
    expect(change).not.toHaveBeenCalled();
    expect(items).toEqual(before);
  });

  it('finds the recording through search and deletes only that record', () => {
    const items = components();
    const change = vi.fn();
    render(<WeekComponentRail weekId="W" components={items} selectedId="R" onSelectId={vi.fn()} onChange={change} pointsByType={{}} variant="nested" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'recording' } });
    expect(screen.getByText('Organisational Context')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Session Recording' }));
    expect(change).toHaveBeenCalledWith([items[0]]);
    expect(change.mock.calls[0][0][0]).toBe(items[0]);
  });

  it('retains a recording as its own row when its parent is filtered out', () => {
    const items = components();
    render(<WeekComponentRail weekId="W" components={[items[1]]} selectedId={null} onSelectId={vi.fn()} onChange={vi.fn()} pointsByType={{}} />);
    expect(screen.getByRole('button', { name: 'Delete Session Recording' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Live session settings/ })).not.toBeInTheDocument();
  });

  it('inserts after the visible session group without losing or rewriting existing records', () => {
    const [live, recording] = components();
    const reading = { ...createEmptyComponent('W', 'reading', 3), id: 'TEXT', title: 'Independent reading' };
    const change = vi.fn();
    render(<WeekComponentRail weekId="W" components={[live, reading, recording]} selectedId={null} onSelectId={vi.fn()} onChange={change} pointsByType={{}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a component here' })[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Video/ }));
    const result = change.mock.calls[0][0];
    expect(result.map((item: { id: string }) => item.id)).toEqual(['L', expect.any(String), 'TEXT', 'R']);
    expect(result[0]).toBe(live);
    expect(result[2]).toBe(reading);
    expect(result[3]).toBe(recording);
  });

  it('opens the original recording editor with its own requirements and saved settings', () => {
    const items = components();
    const select = vi.fn(), change = vi.fn();
    render(<ComponentEditor component={items[1]} onChange={change} onBack={vi.fn()} onSelectComponent={select}
      groupOptions={[]} weekScope={{ courseType: 'paid', programmeId: 'P', programmeName: 'Programme', moduleName: 'Module' }} recordingLinks={{ moduleId: 'M', weeks: [{ id: 'W', label: 'Week 1', components: items }], setLink: vi.fn() }} />);
    const navigation = screen.getByRole('navigation', { name: 'Session sections' });
    expect(within(navigation).getByRole('button', { name: 'Recording settings' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByDisplayValue('Session Recording')).toBeVisible();
    expect(screen.getByDisplayValue('What did you learn from the recording?')).toBeVisible();
    fireEvent.click(within(navigation).getByRole('button', { name: 'Live session' }));
    expect(select).toHaveBeenCalledWith('L');
    expect(change).not.toHaveBeenCalled();
  });
});
