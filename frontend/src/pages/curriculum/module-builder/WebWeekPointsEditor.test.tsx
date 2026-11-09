import { useState } from 'react';
import { useWeekPointDrafts } from './useWeekPointDrafts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebWeekPointsEditor } from './WebWeekPointsEditor';
import { authoredWeekPoints, type AuthoredWeekPoints } from '@/api/webWeekPoints';

function Workspace({ weekId = 'W1' }: { moduleId?: string; weekId?: string }) {
  const drafts = useWeekPointDrafts('M1', ['W1', 'W2']);
  const [message, setMessage] = useState('');
  return <>
    <WebWeekPointsEditor key={weekId} moduleId="M1" weekId={weekId} drafts={drafts} />
    <button onClick={() => { void drafts.save('M1', ['W1', 'W2']).then(() => setMessage('Week Points saved.')).catch(error => setMessage(error.message)); }}>Save module</button>
    <p role="alert">{message}</p>
  </>;
}

vi.mock('@/api/webWeekPoints', () => ({ authoredWeekPoints: vi.fn() }));
const initial: AuthoredWeekPoints = {
  moduleId: 'M1', weekId: 'W1', editorId: 'staff-1', revision: 0, csrfToken: 'synthetic-token',
  points: [{ id: 'P1', title: 'Point 1', componentIds: [] }, { id: 'P2', title: 'Point 2', componentIds: [] }],
  activities: [{ id: 'READ', title: 'Read the case', type: 'reading' }, { id: 'QUIZ', title: 'Check understanding', type: 'quiz' }],
};
beforeEach(() => { sessionStorage.clear(); vi.mocked(authoredWeekPoints).mockReset(); vi.mocked(authoredWeekPoints).mockResolvedValue(structuredClone(initial)); });

describe('curriculum week Points', () => {
  it('does not restore discarded edits after returning to the saved values', async () => {
    const { unmount } = render(<Workspace moduleId="M1" weekId="W1" />);
    const name = await screen.findByRole('textbox', { name: 'Point 1 name' });
    fireEvent.change(name, { target: { value: 'Temporary name' } });
    fireEvent.change(name, { target: { value: 'Point 1' } });
    unmount();
    render(<Workspace moduleId="M1" weekId="W1" />);
    expect(await screen.findByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Point 1');
  });
  it('creates an optional Point from an empty week configuration and can remove it without deleting activities', async () => {
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, points: [] });
    render(<Workspace moduleId="M1" weekId="W1" />);
    await screen.findByRole('button', { name: 'Add Point' });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add Point' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Explore' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read the case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Point' }));
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add Point' }));
    expect(screen.getByRole('checkbox', { name: 'Read the case' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Check understanding' })).toBeEnabled();
  });
  it('starts empty and saves only the named Point and explicitly selected activities', async () => {
    render(<Workspace moduleId="M1" weekId="W1" />);
    const name = await screen.findByRole('textbox', { name: 'Point 1 name' });
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(name, { target: { value: 'Understand the case' } });
    const first = screen.getByRole('group', { name: 'Point 1' });
    fireEvent.click(within(first).getByRole('checkbox', { name: 'Read the case' }));
    expect(within(screen.getByRole('group', { name: 'Point 2' })).getByRole('checkbox', { name: /Read the case/ })).toBeDisabled();
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, revision: 1,
      points: [{ id: 'P1', title: 'Understand the case', componentIds: ['READ'] }, initial.points[1]] });
    fireEvent.click(screen.getByRole('button', { name: 'Save module' }));
    await screen.findByText('Week Points saved.');
    expect(authoredWeekPoints).toHaveBeenLastCalledWith('M1', 'W1', expect.objectContaining({ revision: 0,
      points: [{ id: 'P1', title: 'Understand the case', componentIds: ['READ'] }, initial.points[1]] }));
  });

  it('collapses each Point independently without clearing names or selections', async () => {
    render(<Workspace />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Explore' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Point 1' })).getByRole('checkbox', { name: 'Read the case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Point 1' }));
    expect(screen.queryByRole('textbox', { name: 'Point 1 name' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Point 2 name' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand Point 1' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand Point 1' }));
    expect(screen.getByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Explore');
    expect(within(screen.getByRole('group', { name: 'Point 1' })).getByRole('checkbox', { name: 'Read the case' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save Points' })).not.toBeInTheDocument();
  });

  it('saves drafts from previously visited weeks together', async () => {
    vi.mocked(authoredWeekPoints).mockImplementation(async (moduleId, weekId, saved) => ({
      ...structuredClone(initial), moduleId, weekId, points: saved?.points || structuredClone(initial.points), revision: saved ? 1 : 0,
    }));
    const view = render(<Workspace weekId="W1" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'First week draft' } });
    view.rerender(<Workspace weekId="W2" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Second week draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save module' }));
    await screen.findByText('Week Points saved.');
    const writes = vi.mocked(authoredWeekPoints).mock.calls.filter(call => call[2]);
    expect(writes.map(call => [call[1], call[2]?.points[0].title])).toEqual([['W1', 'First week draft'], ['W2', 'Second week draft']]);
    expect(sessionStorage.getItem('web-week-points:M1:W1:staff-1')).toBeNull();
    expect(sessionStorage.getItem('web-week-points:M1:W2:staff-1')).toBeNull();
  });

  it('retains a failed save and restores the unsaved choices after leaving the week', async () => {
    const { unmount } = render(<Workspace moduleId="M1" weekId="W1" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Draft name' } });
    vi.mocked(authoredWeekPoints).mockRejectedValueOnce(new Error('Someone else changed these Points.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save module' }));
    await screen.findByText(/Someone else changed these Points/);
    expect(screen.getByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Draft name');
    unmount();
    render(<Workspace moduleId="M1" weekId="W1" />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Draft name'));
  });
});
