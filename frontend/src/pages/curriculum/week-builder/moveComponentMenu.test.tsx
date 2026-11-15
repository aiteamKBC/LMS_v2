import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekComponentRail } from './page';

afterEach(cleanup);

function setup() {
  const components = ['Assignment to move', 'Unrelated assignment'].map((title, index) => ({
    id: `C${index + 1}`, weekId: 'W1', moduleId: 'M1', type: 'assignment' as const, title,
    description: '', expectedOtjh: 1, points: 25, reflectionRequired: false, reflectionQuestion: '',
    workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: false,
    ksbMappings: [], settings: {},
  }));
  const move = vi.fn();
  const change = vi.fn();
  const select = vi.fn();
  const { container } = render(<div style={{ overflow: 'hidden', height: 200 }}>
    <WeekComponentRail weekId="W1" components={components} selectedId={null} onSelectId={select}
      onChange={change} pointsByType={{}} variant="nested"
      otherWeeks={Array.from({ length: 20 }, (_, index) => ({ id: `W${index + 2}`, label: `Week ${index + 2}` }))}
      onMoveComponentToWeek={move} />
  </div>);
  return { container, components, move, change, select,
    trigger: screen.getByRole('button', { name: 'Move Assignment to move to another week' }) };
}

describe('Move to another week menu', () => {
  it('escapes the clipping course/Point containers and bounds its own scrolling', async () => {
    const { container, trigger, move, change, select } = setup();
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(container).not.toContainElement(menu);
    expect(menu.style.position).toBe('fixed');
    expect(Number.parseFloat(menu.style.maxHeight)).toBeGreaterThan(0);
    expect(menu).toHaveClass('overflow-y-auto');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(20);
    expect(move).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('moves exactly the chosen component to the selected week once', async () => {
    const { trigger, components, move, change, select } = setup();
    const before = structuredClone(components);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Week 21' }));
    expect(move).toHaveBeenCalledExactlyOnceWith(components[0], 'W21');
    expect(components).toEqual(before);
    expect(change).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens and navigates by keyboard, then cancels without moving anything', async () => {
    const { trigger, move } = setup();
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Week 2' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Week 21' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(move).not.toHaveBeenCalled();
  });

  it('dismisses on an outside pointer press without moving the component', async () => {
    const { trigger, move } = setup();
    await userEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(move).not.toHaveBeenCalled();
  });
});
