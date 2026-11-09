import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebWeekPointsEditor } from './WebWeekPointsEditor';
import { authoredWeekPoints, type AuthoredWeekPoints } from '@/api/webWeekPoints';

vi.mock('@/api/webWeekPoints', () => ({ authoredWeekPoints: vi.fn() }));
const initial: AuthoredWeekPoints = {
  moduleId: 'M1', weekId: 'W1', editorId: 'staff-1', revision: 0, csrfToken: 'synthetic-token',
  points: [{ id: 'P1', title: 'Point 1', componentIds: [] }, { id: 'P2', title: 'Point 2', componentIds: [] }],
  activities: [{ id: 'READ', title: 'Read the case', type: 'reading' }, { id: 'QUIZ', title: 'Check understanding', type: 'quiz' }],
};
beforeEach(() => { sessionStorage.clear(); vi.mocked(authoredWeekPoints).mockReset(); vi.mocked(authoredWeekPoints).mockResolvedValue(structuredClone(initial)); });

describe('curriculum week Points', () => {
  it('does not restore discarded edits after returning to the saved values', async () => {
    const { unmount } = render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
    const name = await screen.findByRole('textbox', { name: 'Point 1 name' });
    fireEvent.change(name, { target: { value: 'Temporary name' } });
    fireEvent.change(name, { target: { value: 'Point 1' } });
    unmount();
    render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
    expect(await screen.findByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Point 1');
  });
  it('creates an optional Point from an empty week configuration and can remove it without deleting activities', async () => {
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, points: [] });
    render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
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
    render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
    const name = await screen.findByRole('textbox', { name: 'Point 1 name' });
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(name, { target: { value: 'Understand the case' } });
    const first = screen.getByRole('group', { name: 'Point 1' });
    fireEvent.click(within(first).getByRole('checkbox', { name: 'Read the case' }));
    expect(within(screen.getByRole('group', { name: 'Point 2' })).getByRole('checkbox', { name: /Read the case/ })).toBeDisabled();
    vi.mocked(authoredWeekPoints).mockResolvedValueOnce({ ...initial, revision: 1,
      points: [{ id: 'P1', title: 'Understand the case', componentIds: ['READ'] }, initial.points[1]] });
    fireEvent.click(screen.getByRole('button', { name: 'Save Points' }));
    await screen.findByText('Week Points saved.');
    expect(authoredWeekPoints).toHaveBeenLastCalledWith('M1', 'W1', expect.objectContaining({ revision: 0,
      points: [{ id: 'P1', title: 'Understand the case', componentIds: ['READ'] }, initial.points[1]] }));
  });

  it('retains a failed save and restores the unsaved choices after leaving the week', async () => {
    const { unmount } = render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Point 1 name' }), { target: { value: 'Draft name' } });
    vi.mocked(authoredWeekPoints).mockRejectedValueOnce(new Error('Someone else changed these Points.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Points' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Draft name');
    unmount();
    render(<WebWeekPointsEditor moduleId="M1" weekId="W1" />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Point 1 name' })).toHaveValue('Draft name'));
  });
});
