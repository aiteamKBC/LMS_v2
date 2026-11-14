import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authoredWeekPoints, type AuthoredWeekPoints } from '@/api/webWeekPoints';
import { WeekPointsNavigation } from './WeekPointsNavigation';
import { WebWeekPointsEditor } from './WebWeekPointsEditor';
import { useWeekPointDrafts } from './useWeekPointDrafts';
import { WeekComponentRail } from '../week-builder/page';
import { createEmptyComponent } from './moduleAuthoringData';

vi.mock('@/api/webWeekPoints', () => ({ authoredWeekPoints: vi.fn() }));
const initial: AuthoredWeekPoints = {
  moduleId: 'M1', weekId: 'W1', editorId: 'staff-1', revision: 0, csrfToken: 'synthetic-token',
  points: [
    { id: 'P1', title: 'Explore', componentIds: ['READ', 'QUIZ', 'REMOVED'] },
    { id: 'P2', title: 'Practice', componentIds: [] },
  ],
  activities: [
    { id: 'READ', title: 'Read the case', type: 'reading' },
    { id: 'QUIZ', title: 'Check understanding', type: 'quiz' },
  ],
};
const components = [
  { id: 'QUIZ', title: 'Check understanding', type: 'quiz' as const },
  { id: 'READ', title: 'Updated reading title', type: 'reading' as const },
  { id: 'OTHER', title: 'Ungrouped video', type: 'video' as const },
];
const onSelect = vi.fn();
function Workspace({ weekId = 'W1', editor = false, filtered = false }: { weekId?: string; editor?: boolean; filtered?: boolean }) {
  const drafts = useWeekPointDrafts('M1', ['W1', 'W2']);
  return <>
    <WeekPointsNavigation key={weekId} moduleId="M1" weekId={weekId} drafts={drafts}
      components={filtered ? components.filter(item => item.type === 'quiz') : components}
      selectedId="QUIZ" onSelect={onSelect} />
    {editor && <WebWeekPointsEditor moduleId="M1" weekId={weekId} drafts={drafts} />}
  </>;
}
beforeEach(() => {
  sessionStorage.clear();
  onSelect.mockReset();
  vi.mocked(authoredWeekPoints).mockReset();
  vi.mocked(authoredWeekPoints).mockResolvedValue(structuredClone(initial));
});

describe('Course structure Week Points navigation', () => {
  it('keeps loaded activities selectable while Points are loading', () => {
    vi.mocked(authoredWeekPoints).mockReturnValue(new Promise(() => {}));
    render(<Workspace />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Points');
    expect(screen.getByRole('button', { name: /Updated reading title/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Check understanding/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('QUIZ');
    expect(authoredWeekPoints).toHaveBeenCalledExactlyOnceWith('M1', 'W1');
  });

  it.each(['You do not have permission to perform this action.', 'Week Points are unavailable.'])(
    'keeps activities visible after %s and restores saved grouping on retry', async message => {
      vi.mocked(authoredWeekPoints).mockRejectedValueOnce(new Error(message));
      render(<Workspace />);
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      for (const component of components) expect(screen.getByText(component.title)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: /Updated reading title/ }));
      expect(onSelect).toHaveBeenCalledExactlyOnceWith('READ');
      expect(sessionStorage.length).toBe(0);
      expect(screen.queryByRole('button', { name: /Other components/ })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Retry loading Points' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Explore, 2 activities' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getAllByText('Updated reading title')).toHaveLength(1);
      expect(screen.getByRole('button', { name: /Check understanding/ })).toBeVisible();
      expect(screen.queryByRole('button', { name: /Ungrouped video/ })).not.toBeInTheDocument();
      expect(authoredWeekPoints).toHaveBeenCalledTimes(2);
      expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => call.length === 2)).toBe(true);
    });

  it('retains editable cards, recording grouping and search when Points cannot load', async () => {
    const live = { ...createEmptyComponent('W1', 'live-session', 1), id: 'LIVE', title: 'Live workshop' };
    const recording = { ...createEmptyComponent('W1', 'recording-placeholder', 2), id: 'RECORDING', title: 'Workshop replay',
      settings: { linkedLiveSessionComponentId: 'LIVE', linkedLiveSessionModuleId: '' } };
    const video = { ...createEmptyComponent('W1', 'video', 3), id: 'VIDEO', title: 'Independent video' };
    const all = [live, recording, video];
    const change = vi.fn();
    vi.mocked(authoredWeekPoints).mockRejectedValue(new Error('Points unavailable'));
    function EditableWeek() {
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <>
        <WeekComponentRail weekId="W1" components={all} selectedId={null} onSelectId={onSelect} onChange={change} pointsByType={{}} variant="nested"
          renderComponentList={items => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
            components={items.flatMap(item => item.members)} selectedId={null} onSelect={onSelect}
            renderActivity={id => items.find(item => item.component.id === id)?.node} />} />
        <button onClick={() => { void drafts.save('M1', ['W1']); }}>Save Points</button>
        <output aria-label="Points draft state">{drafts.get('M1', 'W1') ? 'Points loaded' : 'Points unavailable'}</output>
      </>;
    }
    render(<EditableWeek />);
    await screen.findByRole('alert');
    expect(screen.getAllByTestId('grouped-session-recording')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete Workshop replay' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Independent video' }));
    expect(change.mock.calls[0][0].slice(0, 3)).toEqual(all);
    expect(change.mock.calls[0][0]).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Independent video' }));
    expect(change).toHaveBeenLastCalledWith([live, recording]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'replay' } });
    expect(screen.getByRole('button', { name: 'Delete Workshop replay' })).toBeVisible();
    expect(screen.queryByText('Independent video')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Points draft state')).toHaveTextContent('Points unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Save Points' }));
    await waitFor(() => expect(authoredWeekPoints).toHaveBeenCalledExactlyOnceWith('M1', 'W1'));
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    { name: 'both activities in one Point', points: [{ id: 'P', title: 'Session', componentIds: ['LIVE', 'RECORDING'] }], grouped: true },
    { name: 'both activities in Other components', points: [], grouped: true },
    { name: 'only the live session in a Point', points: [{ id: 'P', title: 'Session', componentIds: ['LIVE'] }], grouped: false },
    { name: 'only the recording in a Point', points: [{ id: 'P', title: 'Session', componentIds: ['RECORDING'] }], grouped: false },
    { name: 'activities in different Points', points: [{ id: 'P', title: 'Session', componentIds: ['LIVE'] }, { id: 'R', title: 'Review', componentIds: ['RECORDING'] }], grouped: false },
  ])('preserves session grouping and exact Point membership with $name', async ({ points, grouped }) => {
    const live = { ...createEmptyComponent('W1', 'live-session', 1), id: 'LIVE', title: 'Live workshop' };
    const recording = { ...createEmptyComponent('W1', 'recording-placeholder', 2), id: 'RECORDING', title: 'Workshop replay',
      settings: { linkedLiveSessionComponentId: 'LIVE', linkedLiveSessionModuleId: '' } };
    const all = [live, recording];
    const change = vi.fn();
    vi.mocked(authoredWeekPoints).mockResolvedValue({ ...initial, points });
    function SessionWeek() {
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <WeekComponentRail weekId="W1" components={all} selectedId="RECORDING" onSelectId={onSelect} onChange={change} pointsByType={{}} variant="nested"
        componentSectionKey={id => drafts.get('M1', 'W1')?.points.find(point => point.componentIds.includes(id))?.id || null}
        renderComponentList={(items, searchTerm) => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
          components={items.flatMap(item => item.members)} selectedId="RECORDING" onSelect={onSelect} expandAll={Boolean(searchTerm)} revealComponentId="RECORDING"
          renderActivity={id => items.find(item => item.component.id === id)?.node} />} />;
    }
    render(<SessionWeek />);
    await screen.findByRole('navigation', { name: 'Week Points navigation' });
    const assigned = new Set(points.flatMap(point => point.componentIds));
    for (const group of [...points.map(point => ({ title: point.title, count: point.componentIds.length })), { title: 'Other components', count: 2 - assigned.size }]) {
      const header = screen.getByRole('button', { name: `${group.title}, ${group.count} ${group.count === 1 ? 'activity' : 'activities'}` });
      const panel = document.getElementById(header.getAttribute('aria-controls')!)!;
      const ids = group.title === 'Other components' ? all.filter(component => !assigned.has(component.id)).map(component => component.id)
        : points.find(point => point.title === group.title)!.componentIds;
      if (ids.includes('RECORDING')) expect(header).toHaveAttribute('aria-expanded', 'true');
      if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
      expect(within(panel).queryByRole('button', { name: 'Delete Workshop replay' }) !== null).toBe(ids.includes('RECORDING'));
      expect(within(panel).queryByRole('button', { name: 'Delete Live workshop' }) !== null).toBe(ids.includes('LIVE'));
    }
    expect(screen.queryAllByTestId('grouped-session-recording')).toHaveLength(grouped ? 1 : 0);
    expect(screen.getAllByRole('button', { name: 'Delete Workshop replay' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Workshop replay' }));
    expect(change).toHaveBeenCalledExactlyOnceWith([live]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'replay' } });
    expect(screen.getByRole('button', { name: 'Delete Workshop replay' })).toBeVisible();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('groups editable cards once while copy, delete and search still use the whole week', async () => {
    const all = components.map((component, index) => ({ ...createEmptyComponent('W1', component.type, index + 1), ...component }));
    const onChange = vi.fn();
    function EditableWeek() {
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <WeekComponentRail weekId="W1" components={all} selectedId={null} onSelectId={onSelect} onChange={onChange} pointsByType={{}} variant="nested"
        renderComponentList={(items, searchTerm) => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
          components={items.map(item => item.component)} selectedId={null} onSelect={onSelect} expandAll={Boolean(searchTerm)}
          renderActivity={id => items.find(item => item.component.id === id)?.node} />} />;
    }
    render(<EditableWeek />);
    fireEvent.click(await screen.findByRole('button', { name: 'Other components, 1 activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explore, 2 activities' }));
    expect(screen.getAllByText('Updated reading title')).toHaveLength(1);
    expect(screen.getAllByText('Ungrouped video')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Ungrouped video' }));
    const copied = onChange.mock.calls[0][0];
    expect(copied).toHaveLength(4);
    expect(copied.slice(0, 3)).toEqual(all);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ungrouped video' }));
    expect(onChange).toHaveBeenLastCalledWith(all.slice(0, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Updated reading title' }));
    expect(onChange).toHaveBeenLastCalledWith([all[0], all[2]]);
    fireEvent.click(screen.getByRole('button', { name: 'Explore, 2 activities' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'updated' } });
    expect(screen.getByRole('button', { name: 'Delete Updated reading title' })).toBeVisible();
    expect(screen.queryByText('Ungrouped video')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(3);
  });
  it('expands Points in authored order and opens current activities without writing or exposing removed references', async () => {
    render(<Workspace />);
    const explore = await screen.findByRole('button', { name: 'Explore, 2 activities' });
    expect(explore).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Updated reading title/ })).not.toBeInTheDocument();
    fireEvent.click(explore);
    const nav = within(screen.getByRole('navigation', { name: 'Week Points navigation' }));
    const buttons = nav.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual([
      'Explore2', 'Updated reading titleReading Material', 'Check understandingQuiz', 'Practice0', 'Other components1',
    ]);
    fireEvent.click(nav.getByRole('button', { name: /Check understanding/ }));
    expect(onSelect).toHaveBeenCalledWith('QUIZ');
    expect(nav.getByRole('button', { name: /Check understanding/ })).toHaveAttribute('aria-current', 'true');
    expect(nav.queryByRole('button', { name: /Ungrouped video/ })).not.toBeInTheDocument();
    fireEvent.click(nav.getByRole('button', { name: 'Other components, 1 activity' }));
    expect(nav.getByRole('button', { name: /Ungrouped video/ })).toBeVisible();
    expect(nav.getAllByText('Updated reading title')).toHaveLength(1);
    expect(nav.queryByText('REMOVED')).not.toBeInTheDocument();
    fireEvent.click(nav.getByRole('button', { name: 'Practice, 0 activities' }));
    expect(nav.getByText('No activities to show.')).toBeVisible();
    expect(authoredWeekPoints).toHaveBeenCalledExactlyOnceWith('M1', 'W1');
  });

  it('reflects unsaved editor names and membership immediately and respects the component filter', async () => {
    const view = render(<Workspace editor />);
    const name = await screen.findByRole('textbox', { name: 'Point 1 name' });
    fireEvent.change(name, { target: { value: 'Explore together' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Point 1' })).getByRole('checkbox', { name: 'Read the case' }));
    const nav = within(screen.getByRole('navigation', { name: 'Week Points navigation' }));
    fireEvent.click(nav.getByRole('button', { name: 'Explore together, 1 activity' }));
    expect(nav.queryByRole('button', { name: /Updated reading title/ })).not.toBeInTheDocument();
    expect(nav.getByRole('button', { name: /Check understanding/ })).toBeVisible();
    fireEvent.click(nav.getByRole('button', { name: 'Other components, 2 activities' }));
    expect(nav.getByRole('button', { name: /Updated reading title/ })).toBeVisible();
    expect(nav.getAllByText('Updated reading title')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('group', { name: 'Point 1' })).getByRole('checkbox', { name: 'Read the case' }));
    expect(nav.getByRole('button', { name: 'Other components, 1 activity' })).toBeVisible();
    expect(nav.getAllByText('Updated reading title')).toHaveLength(1);
    view.rerender(<Workspace editor filtered />);
    expect(nav.getByRole('button', { name: 'Explore together, 1 activity' })).toHaveAttribute('aria-expanded', 'true');
    expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => call.length === 2)).toBe(true);
  });

  it('shows an error with a retry and puts every activity in Other components when there are no Points', async () => {
    vi.mocked(authoredWeekPoints).mockRejectedValueOnce(new Error('Points unavailable'));
    render(<Workspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Points unavailable');
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, points: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Points' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Other components, 3 activities' }));
    expect(screen.getByRole('button', { name: /Updated reading title/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Ungrouped video/ })).toBeVisible();
    expect(authoredWeekPoints).toHaveBeenCalledTimes(2);
  });

  it('keeps weeks separate and ignores a response after leaving its week', async () => {
    let resolveFirst!: (data: AuthoredWeekPoints) => void;
    vi.mocked(authoredWeekPoints).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const view = render(<Workspace />);
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, weekId: 'W2', points: [{ id: 'P3', title: 'Second week', componentIds: [] }] });
    view.rerender(<Workspace weekId="W2" />);
    await screen.findByRole('button', { name: 'Second week, 0 activities' });
    resolveFirst(initial);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Explore, 2 activities' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Second week, 0 activities' })).toBeVisible();
  });
});
