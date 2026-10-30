import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CourseStructureActions } from '../CourseStructureActions';

function setup(hasCalendar = false, disabled = false) {
  const onMeeting = vi.fn(), onReplaceLinks = vi.fn(), onRestoreData = vi.fn();
  render(<fieldset disabled={disabled}><CourseStructureActions hasCalendar={hasCalendar} onMeeting={onMeeting} onReplaceLinks={onReplaceLinks} onRestoreData={onRestoreData} /></fieldset>);
  return { onMeeting, onReplaceLinks, onRestoreData };
}

describe('Course structure Teams actions menu', () => {
  it('shows one collapsed control without running an action on opening', async () => {
    const user = userEvent.setup(), actions = setup();
    const trigger = screen.getByRole('button', { name: 'Teams actions' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled());
  });

  it.each([
    ['Create Teams meeting', 'onMeeting'],
    ['Replace Teams links', 'onReplaceLinks'],
    ['Restore Teams data', 'onRestoreData'],
  ] as const)('runs only the selected %s action', async (label, callback) => {
    const user = userEvent.setup(), actions = setup();
    Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Teams actions' }));
    await user.click(screen.getByRole('menuitem', { name: label }));
    expect(actions[callback]).toHaveBeenCalledOnce();
    Object.entries(actions).filter(([key]) => key !== callback).forEach(([, action]) => expect(action).not.toHaveBeenCalled());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the update action when a calendar already exists', async () => {
    const user = userEvent.setup(), actions = setup(true);
    await user.click(screen.getByRole('button', { name: 'Teams actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Create Teams meeting' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Update Teams meeting' }));
    expect(actions.onMeeting).toHaveBeenCalledOnce();
  });

  it('keeps all actions disabled for an archived module', async () => {
    const user = userEvent.setup(), actions = setup(false, true);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('navigates with arrow keys, Home and End, and restores trigger focus on Escape', async () => {
    const user = userEvent.setup(); setup();
    const trigger = screen.getByRole('button', { name: 'Teams actions' }); trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Create Teams meeting' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Replace Teams links' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Restore Teams data' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Create Teams meeting' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Restore Teams data' })).toHaveFocus();
    await user.keyboard('{Home}{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Restore Teams data' })).toHaveFocus();
  });

  it('closes on an outside click without running an action', async () => {
    const user = userEvent.setup(), actions = setup();
    await user.click(screen.getByRole('button', { name: 'Teams actions' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled());
  });
});
