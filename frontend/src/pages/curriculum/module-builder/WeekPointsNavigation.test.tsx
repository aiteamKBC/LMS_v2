import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { authoredWeekPoints, type AuthoredWeekPoints, type WebPoint } from '@/api/webWeekPoints';
import { WeekPointsNavigation } from './WeekPointsNavigation';
import { WebWeekPointsEditor } from './WebWeekPointsEditor';
import { useWeekPointDrafts } from './useWeekPointDrafts';
import { WeekComponentRail } from '../week-builder/page';
import { createEmptyComponent, type ModuleComponent } from './moduleAuthoringData';

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
function Workspace({ weekId = 'W1', editor = false, filtered = false, editable = false, readOnly = false }: { weekId?: string; editor?: boolean; filtered?: boolean; editable?: boolean; readOnly?: boolean }) {
  const drafts = useWeekPointDrafts('M1', ['W1', 'W2']);
  return <>
    <WeekPointsNavigation key={weekId} moduleId="M1" weekId={weekId} drafts={drafts}
      components={filtered ? components.filter(item => item.type === 'quiz') : components}
      selectedId="QUIZ" onSelect={onSelect}
      readOnly={readOnly}
      renderActivity={editable ? id => <button type="button" onClick={() => onSelect(id)}>{components.find(component => component.id === id)?.title}</button> : undefined} />
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
    await waitFor(() => expect(screen.queryByText('Loading Points…')).not.toBeInTheDocument());
    expect(screen.queryByText('Other components')).not.toBeInTheDocument();
    for (const point of points) {
      const header = screen.getByRole('button', { name: new RegExp(`^${point.title},`) });
      if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
      const panel = within(screen.getByRole('group', { name: `${point.title} components` }));
      expect(panel.queryByRole('button', { name: 'Delete Live workshop' }) !== null).toBe(point.componentIds.includes('LIVE'));
      expect(panel.queryByRole('button', { name: 'Delete Workshop replay' }) !== null).toBe(point.componentIds.includes('RECORDING'));
    }
    expect(screen.getByRole('button', { name: 'Delete Live workshop' })).toBeVisible();
    expect(screen.queryAllByTestId('grouped-session-recording')).toHaveLength(grouped ? 1 : 0);
    expect(screen.getAllByRole('button', { name: 'Delete Workshop replay' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Workshop replay' }));
    expect(change).toHaveBeenCalledExactlyOnceWith([live]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'replay' } });
    expect(screen.getByRole('button', { name: 'Delete Workshop replay' })).toBeVisible();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('keeps editable cards available while Points load or fail, and supports retry', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(authoredWeekPoints).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<Workspace editable />);
    expect(screen.getByRole('button', { name: 'Ungrouped video' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Points');
    reject(new Error('Points unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Points unavailable');
    expect(screen.getByRole('button', { name: 'Ungrouped video' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Points' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Explore, 2 activities' })).toHaveAttribute('aria-expanded', 'true'));
    expect(within(screen.getByRole('group', { name: 'Explore components' })).getByRole('button', { name: 'Check understanding' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Other components')).not.toBeInTheDocument();
  });

  it('reflects Point draft edits and keeps unassigned components available without saving', async () => {
    render(<Workspace editable editor />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Explore together' } });
    expect(within(screen.getByRole('group', { name: 'Explore together components' })).getByRole('button', { name: 'Updated reading title' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('group', { name: 'Point 1' })).getByRole('checkbox', { name: 'Read the case' }));
    expect(within(screen.getByRole('group', { name: 'Explore together components' })).queryByRole('button', { name: 'Updated reading title' })).not.toBeInTheDocument();
    const cards = within(screen.getByRole('region', { name: 'Week components' }));
    expect(cards.getByRole('button', { name: 'Updated reading title' })).toBeVisible();
    expect(cards.getByRole('button', { name: 'Ungrouped video' })).toBeVisible();
    expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => call.length === 2)).toBe(true);
  });

  it('shows newly created component cards directly in an empty week', async () => {
    const changed = vi.fn();
    vi.mocked(authoredWeekPoints).mockResolvedValue({ ...initial, points: [], activities: [] });
    function NewWeek() {
      const [items, setItems] = useState<ModuleComponent[]>([]);
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <WeekComponentRail weekId="W1" components={items} selectedId={null} onSelectId={onSelect}
        onChange={next => { changed(next); setItems(next); }} pointsByType={{ reading: 7 }} variant="nested"
        renderComponentList={rows => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
          components={rows.flatMap(row => row.members)} selectedId={null} onSelect={onSelect}
          renderActivity={id => rows.find(row => row.component.id === id)?.node} />} />;
    }
    render(<NewWeek />);
    await userEvent.click(screen.getByRole('button', { name: /Add the first component/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Reading material/i }));
    const reading = changed.mock.calls[0][0][0];
    expect(reading).toMatchObject({ type: 'reading', points: 7, weekId: 'W1' });
    expect(screen.getByRole('button', { name: `Delete ${reading.title}` })).toBeVisible();
    expect(onSelect).toHaveBeenLastCalledWith(reading.id);
    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await userEvent.click(screen.getByRole('button', { name: /^Quiz/i }));
    expect(changed.mock.calls[1][0]).toEqual([reading, expect.objectContaining({ type: 'quiz', weekId: 'W1' })]);
    expect(screen.getAllByRole('button', { name: 'Drag to reorder' })).toHaveLength(2);
    expect(screen.queryByText('Other components')).not.toBeInTheDocument();
  });

  it('keeps original component cards inside collapsible Points and unassigned cards directly in the week', async () => {
    const all = components.map((component, index) => ({ ...createEmptyComponent('W1', component.type, index + 1), ...component }));
    const onChange = vi.fn();
    function EditableWeek() {
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <WeekComponentRail weekId="W1" components={all} selectedId={null} onSelectId={onSelect} onChange={onChange} pointsByType={{}} variant="nested"
        renderComponentList={(items, searchTerm) => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
          components={items.map(item => item.component)} selectedId={null} onSelect={onSelect} expandAll={Boolean(searchTerm)}
          renderActivity={id => items.find(item => item.component.id === id)?.node} />} />;
    }
    const { container } = render(<EditableWeek />);
    expect(screen.getByText('Ungrouped video')).toBeVisible();
    expect(screen.queryByText('Other components')).not.toBeInTheDocument();
    const point = await screen.findByRole('button', { name: 'Explore, 2 activities' });
    expect(point).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Delete Updated reading title' })).not.toBeInTheDocument();
    fireEvent.click(point);
    const members = within(screen.getByRole('group', { name: 'Explore components' }));
    expect(members.getByRole('button', { name: 'Delete Updated reading title' })).toBeVisible();
    expect(members.getByRole('button', { name: 'Delete Check understanding' })).toBeVisible();
    expect(members.queryByRole('button', { name: 'Delete Ungrouped video' })).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[id^="node-"]')).map(node => node.id))
      .toEqual(['node-QUIZ', 'node-READ', 'node-OTHER']);
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

  it('reorders Points by their handles and keyboard buttons without changing component membership', async () => {
    render(<Workspace editable />);
    const handle = await screen.findByRole('button', { name: 'Drag Explore to reorder Points' });
    const target = screen.getByRole('button', { name: 'Practice, 0 activities' }).parentElement!.parentElement!;
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    const region = within(screen.getByRole('region', { name: 'Week components' }));
    expect(region.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded')).map(button => button.getAttribute('aria-label')))
      .toEqual(['Practice, 0 activities', 'Explore, 2 activities']);
    fireEvent.click(region.getByRole('button', { name: 'Move Explore up' }));
    expect(region.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded')).map(button => button.getAttribute('aria-label')))
      .toEqual(['Explore, 2 activities', 'Practice, 0 activities']);
    expect(within(screen.getByRole('group', { name: 'Explore components' })).getByRole('button', { name: 'Check understanding' })).toBeVisible();
    expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => !call[2])).toBe(true);
  });

  it('does not change Point structure when the module is read only', async () => {
    render(<Workspace editable readOnly />);
    expect(await screen.findByRole('button', { name: 'Drag Explore to reorder Points' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Explore down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Point' })).toBeDisabled();
    const region = within(screen.getByRole('region', { name: 'Week components' }));
    expect(region.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded')).map(button => button.getAttribute('aria-label')))
      .toEqual(['Explore, 2 activities', 'Practice, 0 activities']);
    expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => !call[2])).toBe(true);
  });
});

describe('Course structure component dragging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // jsdom has no layout. Give the real dnd-kit sensors the rail and card
  // geometry, including list-item wrappers where present. No drag handlers
  // are mocked.
  function measureRail(container: HTMLElement, ids: string[]) {
    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto')!;
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 360 },
      clientHeight: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 360 },
      scrollHeight: { configurable: true, value: 500 },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === scroller) return new DOMRect(20, 50, 360, 500);
      const card = this.id.startsWith('node-') ? this
        : this.firstElementChild?.id.startsWith('node-') ? this.firstElementChild
        : this.tagName === 'LI' ? this.querySelector('[id^="node-"]') : null;
      const index = card ? ids.indexOf(card.id.slice(5)) : -1;
      return index < 0 ? new DOMRect(20, 50, 360, 500)
        : new DOMRect(30, 100 + index * 140, 340, this.tagName === 'LI' ? 120 : 100);
    });
  }

  async function openDraggableWeek(items: ModuleComponent[], grouped = true, points: WebPoint[] = []) {
    const change = vi.fn();
    const pointsChanged = vi.fn();
    vi.mocked(authoredWeekPoints).mockImplementation(async (_module, _week, saved) => ({ ...initial, points: saved?.points || points, revision: saved ? 1 : 0 }));
    function EditableWeek() {
      const [all, setAll] = useState(items);
      const [selected, setSelected] = useState<string | null>(null);
      const drafts = useWeekPointDrafts('M1', ['W1']);
      return <><WeekComponentRail weekId="W1" components={all} selectedId={selected} onSelectId={id => { onSelect(id); setSelected(id); }}
        onChange={next => { change(next); setAll(next); }} pointsByType={{}} variant={grouped ? 'nested' : 'standalone'}
        pointStructure={grouped ? { points: drafts.get('M1', 'W1')?.points || [], onChange: next => { pointsChanged(next); drafts.update('M1', 'W1', () => next); } } : undefined}
        componentSectionKey={grouped ? id => drafts.get('M1', 'W1')?.points.find(point => point.componentIds.includes(id))?.id || null : undefined}
        renderComponentList={grouped ? (rows, searchTerm, actions) => <WeekPointsNavigation moduleId="M1" weekId="W1" drafts={drafts}
          components={rows.flatMap(row => row.members)} selectedId={selected} onSelect={onSelect} expandAll={Boolean(searchTerm)}
          onAddComponent={actions.addComponent} renderActivity={id => rows.find(row => row.component.id === id)?.node} /> : undefined} />
        <button type="button" onClick={() => { void drafts.save('M1', ['W1']); }}>Save Point drafts</button></>;
    }
    const { container } = render(<EditableWeek />);
    if (grouped) await waitFor(() => expect(screen.queryByText('Loading Points…')).not.toBeInTheDocument());
    for (const point of points) {
      const header = screen.getByRole('button', { name: new RegExp(`^${point.title},`) });
      if (header.getAttribute('aria-expanded') === 'false') fireEvent.click(header);
    }
    const primaryIds = items.filter(item => item.type !== 'recording-placeholder').map(item => item.id);
    measureRail(container, primaryIds);
    return { change, container, pointsChanged };
  }

  async function pointerDrag(handle: HTMLElement, fromY: number, toY: number, cancel = false) {
    // PointerSensor needs isPrimary, which jsdom's MouseEvent lacks.
    class TestPointerEvent extends MouseEvent {
      readonly isPrimary = true;
      readonly pointerId = 1;
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    fireEvent.pointerDown(handle, { button: 0, clientX: 60, clientY: fromY });
    fireEvent.pointerMove(document, { clientX: 60, clientY: fromY + 10 });
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.pointerMove(document, { clientX: 60, clientY: toY });
    if (cancel) fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    else fireEvent.pointerUp(document);
  }

  function readings() {
    return ['READ', 'VIDEO', 'QUIZ'].map((id, index) => ({
      ...createEmptyComponent('W1', 'reading', index + 1), id, title: `Activity ${id}`,
    }));
  }

  it.each([true, false])('reorders with the pointer and preserves component fields (grouped: %s)', async grouped => {
    const items = readings();
    const before = structuredClone(items);
    const { change, container } = await openDraggableWeek(items, grouped);
    const handle = screen.getAllByRole('button', { name: 'Drag to reorder' })[0];
    await pointerDrag(handle, 140, 280);
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith([items[1], items[0], items[2]]));
    expect(Array.from(container.querySelectorAll('[id^="node-"]')).map(node => node.id))
      .toEqual(['node-VIDEO', 'node-READ', 'node-QUIZ']);
    expect(items).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
    expect(vi.mocked(authoredWeekPoints).mock.calls.every(call => call[2] === undefined)).toBe(true);
  });

  it('reorders grouped cards with the keyboard', async () => {
    const items = readings();
    const { change } = await openDraggableWeek(items);
    const user = userEvent.setup();
    const handle = screen.getAllByRole('button', { name: 'Drag to reorder' })[1];
    handle.focus();
    await user.keyboard('[Space]');
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
    await user.keyboard('[ArrowUp][Space]');
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith([items[1], items[0], items[2]]));
  });

  it('moves a live session with its recording without changing the booking or recording settings', async () => {
    const live = { ...createEmptyComponent('W1', 'live-session', 1), id: 'LIVE', title: 'Live workshop',
      settings: { teamsLiveSessionId: 'SYNTHETIC-SERIES', teamsSessionNumber: 1, sessionDate: '2026-11-16' } };
    const recording = { ...createEmptyComponent('W1', 'recording-placeholder', 2), id: 'RECORDING', title: 'Workshop replay',
      settings: { linkedLiveSessionComponentId: 'LIVE', linkedLiveSessionModuleId: '' } };
    const reading = readings()[0];
    const items = [live, recording, reading];
    const before = structuredClone(items);
    const { change } = await openDraggableWeek(items);
    await pointerDrag(screen.getAllByRole('button', { name: 'Drag to reorder' })[0], 140, 280);
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith([reading, live, recording]));
    expect(items).toEqual(before);
  });

  it('leaves the order unchanged when dragging is cancelled', async () => {
    const { change } = await openDraggableWeek(readings());
    await pointerDrag(screen.getAllByRole('button', { name: 'Drag to reorder' })[0], 140, 280, true);
    expect(change).not.toHaveBeenCalled();
  });

  it('drags a component between Points and saves its new membership', async () => {
    const items = readings();
    const { change, pointsChanged } = await openDraggableWeek(items, true, [
      { id: 'P1', title: 'Explore', componentIds: ['READ'] }, { id: 'P2', title: 'Practice', componentIds: ['VIDEO', 'QUIZ'] },
    ]);
    await pointerDrag(document.querySelector('#node-READ button') as HTMLElement, 140, 280);
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith([items[1], items[0], items[2]]));
    expect(pointsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'P1', componentIds: [] }), expect.objectContaining({ id: 'P2', componentIds: ['VIDEO', 'READ', 'QUIZ'] }),
    ]);
    expect(within(screen.getByRole('group', { name: 'Practice components' })).getByRole('button', { name: 'Delete Activity READ' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save Point drafts' }));
    await waitFor(() => expect(vi.mocked(authoredWeekPoints).mock.calls.some(call => call[2]?.points[1].componentIds.join(',') === 'VIDEO,READ,QUIZ')).toBe(true));
  });

  it('adds a new component inside the chosen Point and retains its membership on save', async () => {
    const { change, pointsChanged } = await openDraggableWeek(readings(), true, [{ id: 'P1', title: 'Explore', componentIds: ['READ'] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add component to Explore' }));
    await userEvent.click(screen.getByRole('button', { name: /^Quiz/i }));
    const created = change.mock.calls[0][0].find((component: ModuleComponent) => !['READ', 'VIDEO', 'QUIZ'].includes(component.id));
    expect(created).toMatchObject({ type: 'quiz', weekId: 'W1' });
    expect(pointsChanged).toHaveBeenLastCalledWith([{ id: 'P1', title: 'Explore', componentIds: ['READ', created.id] }]);
    expect(within(screen.getByRole('group', { name: 'Explore components' })).getByRole('button', { name: `Delete ${created.title}` })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save Point drafts' }));
    await waitFor(() => expect(vi.mocked(authoredWeekPoints).mock.calls.some(call => call[2]?.points[0].componentIds.includes(created.id))).toBe(true));
  });

  it('keeps duplicates in their Point and removes only the deleted component reference', async () => {
    const { change, pointsChanged } = await openDraggableWeek(readings(), true, [{ id: 'P1', title: 'Explore', componentIds: ['READ'] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate Activity READ' }));
    const clone = change.mock.calls[0][0].find((component: ModuleComponent) => !['READ', 'VIDEO', 'QUIZ'].includes(component.id));
    expect(pointsChanged).toHaveBeenLastCalledWith([{ id: 'P1', title: 'Explore', componentIds: ['READ', clone.id] }]);
    await userEvent.click(within(document.getElementById('node-READ')!).getByRole('button', { name: 'Delete Activity READ' }));
    expect(change.mock.calls[1][0].map((component: ModuleComponent) => component.id)).toEqual([clone.id, 'VIDEO', 'QUIZ']);
    expect(pointsChanged).toHaveBeenLastCalledWith([{ id: 'P1', title: 'Explore', componentIds: [clone.id] }]);
  });
});
