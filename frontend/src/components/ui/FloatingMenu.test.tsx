import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FloatingMenu } from './FloatingMenu';
import { FLOATING_GAP, FLOATING_MARGIN, placeFloating } from './floatingPanel';

const viewport = { width: 1280, height: 800 };
const anchorAt = (top: number, left = 1000, size = 36) => ({ top, bottom: top + size, left, right: left + size, width: size });

describe('placeFloating', () => {
  it('opens below the trigger when the panel fits there', () => {
    const anchor = anchorAt(200);
    const place = placeFloating(anchor, { width: 180, height: 150 }, viewport);
    expect(place.side).toBe('bottom');
    expect(place.top).toBe(anchor.bottom + FLOATING_GAP);
    expect(place.left).toBe(anchor.right - 180);
  });

  it('flips above the trigger near the bottom of the screen', () => {
    const anchor = anchorAt(700);
    const place = placeFloating(anchor, { width: 180, height: 150 }, viewport);
    expect(place.side).toBe('top');
    expect(place.top).toBe(anchor.top - FLOATING_GAP - 150);
    expect(place.top + 150).toBeLessThanOrEqual(anchor.top);
  });

  it('stays below and scrolls when below is still the roomier side', () => {
    const anchor = anchorAt(300);
    const place = placeFloating(anchor, { width: 180, height: 2000 }, viewport);
    expect(place.side).toBe('bottom');
    expect(place.maxHeight).toBe(viewport.height - anchor.bottom - FLOATING_GAP - FLOATING_MARGIN);
  });

  it('never leaves the viewport horizontally', () => {
    expect(placeFloating(anchorAt(100, 4), { width: 200, height: 50 }, viewport).left).toBe(FLOATING_MARGIN);
    const right = placeFloating(anchorAt(100, 1270), { width: 200, height: 50 }, viewport, { align: 'start' });
    expect(right.left + 200).toBeLessThanOrEqual(viewport.width - FLOATING_MARGIN);
  });

  it('caps field dropdowns and matches the trigger width', () => {
    const anchor = { top: 600, bottom: 640, left: 100, right: 400, width: 300 };
    const place = placeFloating(anchor, { width: 120, height: 900 }, viewport, { align: 'start', matchWidth: true, maxHeight: 224 });
    expect(place).toMatchObject({ side: 'top', width: 300, left: 100, maxHeight: 224 });
    expect(place.top).toBe(anchor.top - FLOATING_GAP - 224);
  });
});

function Counter() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount(value => value + 1)}>Pressed {count}</button>;
}

function Harness() {
  const [chosen, setChosen] = useState('');
  return <div style={{ overflow: 'hidden' }} data-testid="clipping-card">
    <FloatingMenu label="More actions for Example" panelLabel="Actions for Example" trigger="⋮">
      {close => <>
        <button type="button" onClick={() => { close({ restoreFocus: false }); setChosen('opened'); }}>Open record</button>
        <Counter />
      </>}
    </FloatingMenu>
    <output>{chosen}</output>
    <button type="button">Elsewhere</button>
  </div>;
}

describe('FloatingMenu', () => {
  afterEach(cleanup);

  it('renders outside the clipping card and moves focus into the panel', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'Actions for Example' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByTestId('clipping-card')).not.toContainElement(panel);
    expect(panel.style.position).toBe('fixed');
    expect(screen.getByRole('button', { name: 'Open record' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open record' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside press or focus elsewhere, but not on presses inside', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Pressed 0' }));
    expect(screen.getByRole('group', { name: 'Actions for Example' })).toBeVisible();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
  });

  it('keeps inline action state while closed, like a native details element', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Pressed 0' }));
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Pressed 1' })).toBeVisible();
  });

  it('dismisses on the first outside pointer press even when propagation is stopped', () => {
    render(<div onPointerDown={event => event.stopPropagation()}><Harness /></div>);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    fireEvent.click(trigger);
    const action = screen.getByRole('button', { name: 'Pressed 0' });
    fireEvent.pointerDown(action);
    expect(screen.getByRole('group', { name: 'Actions for Example' })).toBeVisible();
    // No blur or click follows: pointerdown alone must close the menu.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
  });

  it('lets an action close the menu before opening its own dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    expect(screen.getByText('opened')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
  });

  it('supports arrow keys and leaves the panel on Tab from the last item', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More actions for Example' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: 'Pressed 0' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pressed 0' }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Open record' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open record' }), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pressed 0' }), { key: 'Tab' });
    expect(screen.queryByRole('group', { name: 'Actions for Example' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when its trigger becomes disabled', () => {
    const { rerender } = render(<FloatingMenu label="Filter" trigger="Filter" panelLabel="Options"><button type="button">One</button></FloatingMenu>);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByRole('group', { name: 'Options' })).toBeVisible();
    rerender(<FloatingMenu label="Filter" trigger="Filter" panelLabel="Options" disabled><button type="button">One</button></FloatingMenu>);
    expect(screen.queryByRole('group', { name: 'Options' })).not.toBeInTheDocument();
  });
});
